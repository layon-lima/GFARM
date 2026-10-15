import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const BalancaContext = createContext(null);

const BAUD_KEY = 'balanca_baud_rate';
const DEFAULT_BAUD = 4800;
const BAUD_VERSION_KEY = 'balanca_baud_version';
const BAUD_VERSION = 2; // v1 = 9600 padrão, v2 = 4800 padrão

// Migração: se o usuário tinha o padrão antigo (9600) salvo, reseta para o novo padrão (4800)
try {
  const version = localStorage.getItem(BAUD_VERSION_KEY);
  if (!version || parseInt(version, 10) < BAUD_VERSION) {
    const savedBaud = localStorage.getItem(BAUD_KEY);
    if (!savedBaud || savedBaud === '9600') {
      localStorage.removeItem(BAUD_KEY);
    }
    localStorage.setItem(BAUD_VERSION_KEY, String(BAUD_VERSION));
  }
} catch {}
const DATABITS_KEY = 'balanca_data_bits';
const STOPBITS_KEY = 'balanca_stop_bits';
const PARITY_KEY = 'balanca_parity';
const CASAS_KEY = 'balanca_casas_decimais';
const CASAS_VERSION_KEY = 'balanca_casas_version';
const CASAS_VERSION = 2; // v1 = 3 decimais padrão (só formatação), v2 = 0 decimais padrão (define ponto decimal do frame)

// Migração: se o usuário tinha o padrão antigo (3 decimais) salvo, reseta para o novo padrão (0)
try {
  const cVersion = localStorage.getItem(CASAS_VERSION_KEY);
  if (!cVersion || parseInt(cVersion, 10) < CASAS_VERSION) {
    const savedCasas = localStorage.getItem(CASAS_KEY);
    if (!savedCasas || savedCasas === '3') {
      localStorage.removeItem(CASAS_KEY);
    }
    localStorage.setItem(CASAS_VERSION_KEY, String(CASAS_VERSION));
  }
} catch {}

function loadSetting(key, defaultValue) {
  try {
    const saved = localStorage.getItem(key);
    return saved !== null ? saved : defaultValue;
  } catch {
    return defaultValue;
  }
}

function formatarPeso(peso, casasDecimais = 3) {
  if (peso === null || peso === undefined || isNaN(peso)) return '0';
  return Number(peso).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casasDecimais,
  });
}

/**
 * Faz o parse de um frame do protocolo P03 (contínuo) da balança Toledo.
 * Formato: [STX?][SWA][SWB][SWC][6 dígitos peso][6 dígitos tara][CR][CS?]
 *   STX = 0x02 (OPCIONAL — "Transmissão do STX: Não aplicável" = não transmitido)
 *   SWA = byte de status A (bit 1=sub-zero, bit 2=sobrecarga)
 *   SWB = byte de status B (unidade, dados válidos)
 *   SWC = byte de status C
 *   6 dígitos ASCII do peso (0x30-0x39), SEM ponto decimal
 *   6 dígitos ASCII da tara
 *   CR = 0x0D (fim do frame)
 *   CS = checksum (opcional, quando CKS habilitado)
 *
 * O ponto decimal NÃO está no frame — é determinado pelo configurável casasDecimais.
 * Ex.: visor "436,3" → frame "004363" com casasDecimais=1 → 4363 / 10 = 436.3
 */
function parseFrameP03(bytes, casasDecimais = 0) {
  if (!bytes || bytes.length < 8) return null;

  const arr = Array.from(bytes);

  // Encontra CR (0x0D) — fim do frame.
  // STX é OPCIONAL no protocolo P03 contínuo — a configuração da balança
  // diz "Transmissão do STX: Não aplicável", então não podemos depender dele.
  const crIdx = arr.indexOf(0x0D);
  if (crIdx < 0) return null;

  // Frame: [STX?][SWA][SWB][SWC][6 dígitos peso][6 dígitos tara][CR]
  // Os 6 dígitos da tara estão logo antes do CR (crIdx-6 a crIdx-1).
  // Os 6 dígitos do peso estão antes da tara (crIdx-12 a crIdx-7), com ou sem STX.
  // Tenta offset 12 (sem STX) e 13 (com STX).
  for (const offset of [12, 13]) {
    if (crIdx < offset) continue;

    let valido = true;
    for (let i = 0; i < 6; i++) {
      const b = arr[crIdx - offset + i];
      if (b < 0x30 || b > 0x39) { valido = false; break; }
    }
    if (!valido) continue;

    // Extrai o peso bruto (6 dígitos)
    let pesoRaw = 0;
    for (let i = 0; i < 6; i++) {
      pesoRaw = pesoRaw * 10 + (arr[crIdx - offset + i] - 0x30);
    }

    // SWA está 3 bytes antes do peso: (crIdx - offset - 3)
    const swaIdx = crIdx - offset - 3;

    // SWA: bit 1 = sub-zero (negativo), bit 2 = sobrecarga
    let negativo = false;
    let sobrecarga = false;
    if (swaIdx >= 0) {
      const swa = arr[swaIdx];
      negativo = (swa & 0x02) !== 0;
      sobrecarga = (swa & 0x04) !== 0;
    }

    if (sobrecarga) return null;

    // O ponto decimal não está no frame — é determinado pelo configurável casasDecimais.
    // Ex.: visor "436,3" → frame "004363" com casasDecimais=1 → 4363 / 10 = 436.3
    const divisor = Math.pow(10, casasDecimais);
    let peso = pesoRaw / divisor;
    if (negativo) peso = -peso;

    return peso;
  }

  return null;
}

/** Converte array de bytes para representação hexadecimal para diagnóstico de protocolo. */
function bytesToHex(bytes) {
  if (!bytes || bytes.length === 0) return '';
  return Array.from(bytes).map(b => '0x' + (b & 0xFF).toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Verifica se um erro indica que o dispositivo físico foi removido. */
function isDeviceLostError(e) {
  const errName = e.name || '';
  const errMsg = (e.message || String(e)).toLowerCase();
  return (
    errName === 'NetworkError' ||
    errMsg.includes('device has been lost') ||
    errMsg.includes('port is not open') ||
    errMsg.includes('the port is no longer') ||
    errMsg.includes('usb device')
  );
}

const MAX_RETRIES = 5;

export function BalancaProvider({ children }) {
  const [suportado, setSuportado] = useState(true);
  const [status, setStatus] = useState('desconectado'); // desconectado | conectando | conectado | erro | nao_suportado
  const [portaInfo, setPortaInfo] = useState(null);
  const [baudRate, setBaudRate] = useState(() => {
    try {
      const saved = localStorage.getItem(BAUD_KEY);
      return saved ? parseInt(saved, 10) : DEFAULT_BAUD;
    } catch {
      return DEFAULT_BAUD;
    }
  });
  const [ultimaLeitura, setUltimaLeitura] = useState(null);
  const [erro, setErro] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [rawData, setRawData] = useState('');
  const [dataBits, setDataBits] = useState(() => parseInt(loadSetting(DATABITS_KEY, '8'), 10));
  const [stopBits, setStopBits] = useState(() => parseInt(loadSetting(STOPBITS_KEY, '1'), 10));
  const [parity, setParity] = useState(() => loadSetting(PARITY_KEY, 'none'));
  const [casasDecimais, setCasasDecimais] = useState(() => parseInt(loadSetting(CASAS_KEY, '0'), 10));

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const shouldStopRef = useRef(false);
  const ultimaLeituraRef = useRef(null);
  const dadosRecebidosRef = useRef(false);
  const rawDataRef = useRef('');
  const loopRunningRef = useRef(false);
  const lastRawUpdateRef = useRef(0);
  const casasDecimaisRef = useRef(casasDecimais);
  const baudRateRef = useRef(baudRate);
  const dataBitsRef = useRef(dataBits);
  const stopBitsRef = useRef(stopBits);
  const parityRef = useRef(parity);

  useEffect(() => {
    casasDecimaisRef.current = casasDecimais;
    baudRateRef.current = baudRate;
    dataBitsRef.current = dataBits;
    stopBitsRef.current = stopBits;
    parityRef.current = parity;
  }, [casasDecimais, baudRate, dataBits, stopBits, parity]);

  /**
   * Inicia o loop de leitura contínua do protocolo P03 com WATCHDOG.
   * Se o loop morrer por qualquer motivo (sem shouldStop), reinicia automaticamente
   * com backoff exponencial até MAX_RETRIES tentativas.
   * A balança envia frames continuamente — não é necessário enviar comandos.
   * Cada frame é delimitado por CR (0x0D) no fim. STX é opcional e pode não ser transmitido.
   */
  const iniciarLeituraContinua = useCallback(async () => {
    const port = portRef.current;
    if (!port) return;

    // Guarda: não inicia loop duplicado
    if (loopRunningRef.current) return;
    loopRunningRef.current = true;

    shouldStopRef.current = false;
    let tentativas = 0;

    try {
      while (!shouldStopRef.current && tentativas < MAX_RETRIES) {
        // Se a porta não é mais legível, o dispositivo foi removido fisicamente
        if (!port.readable) {
          if (!shouldStopRef.current) {
            setStatus('desconectado');
            portRef.current = null;
            setPortaInfo(null);
            ultimaLeituraRef.current = null;
          }
          return;
        }

        let reader;
        try {
          reader = port.readable.getReader();
          readerRef.current = reader;
          // Acumula bytes CRUS (Uint8Array) — NÃO usa TextDecoder UTF-8, que corrompe
          // bytes de status com bit 7 ligado (paridade) e quebra o alinhamento do frame.
          let buffer = [];
          tentativas = 0; // Resetou — leitura está funcionando

          while (!shouldStopRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            dadosRecebidosRef.current = true;

            // Acumula bytes crus no buffer
            for (let i = 0; i < value.length; i++) buffer.push(value[i]);

            // Mantém os últimos 100 bytes em hex para diagnóstico
            const recentBytes = buffer.length > 100 ? buffer.slice(-100) : buffer;
            rawDataRef.current = bytesToHex(recentBytes);

            // Throttle: atualiza estado de rawData no máximo 2x por segundo
            const now = Date.now();
            if (now - lastRawUpdateRef.current > 500) {
              lastRawUpdateRef.current = now;
              setRawData(rawDataRef.current);
            }

            // Processa frames P03 completos delimitados por CR (0x0D).
            // STX é OPCIONAL neste protocolo — não depende dele para sincronizar.
            while (true) {
              const crIdx = buffer.indexOf(0x0D);
              if (crIdx < 0) {
                // Frame incompleto — aguarda mais dados
                if (buffer.length > 256) buffer = buffer.slice(-20);
                break;
              }

              // Frame completo: bytes[0..crIdx] (dados até CR inclusive)
              const frame = buffer.slice(0, crIdx + 1);
              buffer = buffer.slice(crIdx + 1);

              const peso = parseFrameP03(frame, casasDecimaisRef.current);
              if (peso !== null) {
                const anterior = ultimaLeituraRef.current;
                // Só atualiza a tela quando o peso muda — espelha o visor físico da balança
                if (!anterior || anterior.peso !== peso) {
                  const leitura = { peso, timestamp: new Date().toISOString() };
                  ultimaLeituraRef.current = leitura;
                  setUltimaLeitura(leitura);
                } else {
                  // Atualiza só o timestamp para que lerPeso saiba que a leitura é fresca
                  ultimaLeituraRef.current = { ...anterior, timestamp: new Date().toISOString() };
                }
              }
            }

            if (buffer.length > 256) buffer = buffer.slice(-20);
          }
        } catch (e) {
          if (shouldStopRef.current) break;

          // Erro fatal: dispositivo foi removido fisicamente
          if (isDeviceLostError(e) || !port.readable) {
            setStatus('desconectado');
            portRef.current = null;
            setPortaInfo(null);
            ultimaLeituraRef.current = null;
            return;
          }

          // Erro recuperável: incrementa tentativas e tenta novamente
          tentativas++;
          console.warn(`[Balanca] Loop reiniciando após erro (tentativa ${tentativas}/${MAX_RETRIES}):`, e);
          if (tentativas < MAX_RETRIES) {
            // Backoff exponencial: 1s, 2s, 3s, 4s...
            await new Promise(r => setTimeout(r, 1000 * tentativas));
          }
        } finally {
          if (reader) {
            try { reader.releaseLock(); } catch {}
          }
          readerRef.current = null;
        }
      }

      // Esgotou as tentativas sem shouldStop — sinaliza erro ao usuário
      if (!shouldStopRef.current && tentativas >= MAX_RETRIES) {
        setStatus('erro');
        const raw = rawDataRef.current || '';
        setErro('A balança parou de responder. Verifique o cabo USB, o driver do conversor serial e se a balança está ligada.');
      }
    } finally {
      loopRunningRef.current = false;
    }
  }, []);

  /** Para o loop de leitura contínua e libera o reader (com timeout para não travar). */
  const pararLeitura = useCallback(async () => {
    shouldStopRef.current = true;
    const reader = readerRef.current;
    if (reader) {
      try {
        // Timeout de 2s para não travar indefinidamente se o reader travou
        await Promise.race([
          reader.cancel(),
          new Promise(r => setTimeout(r, 2000)),
        ]);
      } catch {}
    }
    // Aguarda o loop terminar (máx 2s)
    let attempts = 0;
    while (loopRunningRef.current && attempts < 40) {
      await new Promise((r) => setTimeout(r, 50));
      attempts++;
    }
  }, []);

  // Tenta abrir uma porta já autorizada e iniciar a leitura contínua
  const tentarAutoConectar = useCallback(async (port) => {
    if (!port || portRef.current) return;
    try {
      await port.open({
        baudRate: baudRateRef.current,
        dataBits: dataBitsRef.current,
        stopBits: stopBitsRef.current,
        parity: parityRef.current,
      });
      portRef.current = port;
      setPortaInfo(port.getInfo());
      setStatus('conectado');
      shouldStopRef.current = false;
      iniciarLeituraContinua();
    } catch (e) {
      // Porta não autorizada ou em uso — ignora silenciosamente na auto-conexão
      // mas se for InvalidStateError (já aberta), reutiliza a porta
      if (e.name === 'InvalidStateError') {
        portRef.current = port;
        setPortaInfo(port.getInfo());
        setStatus('conectado');
        shouldStopRef.current = false;
        if (!loopRunningRef.current) iniciarLeituraContinua();
      }
    }
  }, [iniciarLeituraContinua]);

  // Feature detection + auto-conexão ao plugar o cabo (porta já autorizada)
  useEffect(() => {
    if (!('serial' in navigator)) {
      setSuportado(false);
      setStatus('nao_suportado');
      return;
    }

    // Conecta portas já autorizadas que existem no momento da montagem
    let cancelled = false;
    (async () => {
      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length > 0 && !cancelled) {
          await tentarAutoConectar(ports[0]);
        }
      } catch {
        // Silencioso
      }
    })();

    // Quando um cabo é plugado fisicamente, tenta conectar automaticamente
    const handleConnect = (event) => {
      if (cancelled || portRef.current) return;
      tentarAutoConectar(event.target);
    };

    // Quando o cabo é desconectado fisicamente, atualiza o status
    const handleDisconnect = (event) => {
      if (portRef.current === event.target) {
        shouldStopRef.current = true;
        const reader = readerRef.current;
        if (reader) { try { reader.cancel(); } catch {} }
        portRef.current = null;
        setPortaInfo(null);
        setStatus('desconectado');
        ultimaLeituraRef.current = null;
      }
    };

    navigator.serial.addEventListener('connect', handleConnect);
    navigator.serial.addEventListener('disconnect', handleDisconnect);

    return () => {
      cancelled = true;
      shouldStopRef.current = true;
      navigator.serial.removeEventListener('connect', handleConnect);
      navigator.serial.removeEventListener('disconnect', handleDisconnect);
      const reader = readerRef.current;
      if (reader) { try { reader.cancel(); } catch {} }
      const port = portRef.current;
      if (port) { try { port.close(); } catch {} }
      portRef.current = null;
      loopRunningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conectar = useCallback(async () => {
    if (!('serial' in navigator)) {
      setSuportado(false);
      return false;
    }
    setErro(null);
    setStatus('conectando');
    try {
      const port = await navigator.serial.requestPort();
      await pararLeitura();
      const oldPort = portRef.current;
      if (oldPort) {
        try { await oldPort.close(); } catch {}
        portRef.current = null;
      }
      await port.open({ baudRate, dataBits, stopBits, parity });
      portRef.current = port;
      setPortaInfo(port.getInfo());
      setStatus('conectado');
      shouldStopRef.current = false;
      iniciarLeituraContinua();
      return true;
    } catch (e) {
      if (e.name === 'NotFoundError' || e.name === 'AbortError') {
        setStatus('desconectado');
      } else if (e.name === 'InvalidStateError') {
        // Porta já aberta — reutiliza
        portRef.current = portRef.current;
        setStatus('conectado');
        if (!loopRunningRef.current) {
          shouldStopRef.current = false;
          iniciarLeituraContinua();
        }
        return true;
      } else if (e.name === 'SecurityError') {
        setStatus('erro');
        setErro('Acesso negado pelo navegador. Use Chrome ou Edge em desktop via HTTPS.');
      } else {
        setStatus('erro');
        setErro(`Erro ao abrir porta: ${e.message || e}`);
      }
      return false;
    }
  }, [baudRate, dataBits, stopBits, parity, pararLeitura, iniciarLeituraContinua]);

  const desconectar = useCallback(async () => {
    await pararLeitura();
    const port = portRef.current;
    if (port) {
      try { await port.close(); } catch {}
      portRef.current = null;
    }
    setPortaInfo(null);
    setErro(null);
    setStatus('desconectado');
    ultimaLeituraRef.current = null;
    setRawData('');
  }, [pararLeitura]);

  /**
   * Retorna o peso atual da balança.
   * No modo contínuo P03, a balança envia leituras continuamente,
   * então este método retorna a leitura mais recente (se tiver < 4s) ou
   * aguarda até 8s por uma nova leitura.
   */
  const lerPeso = useCallback(async () => {
    let port = portRef.current;
    if (!port) return null;

    // Se a porta morreu (dispositivo removido), limpa e falha
    if (!port.readable) {
      setStatus('desconectado');
      portRef.current = null;
      setPortaInfo(null);
      ultimaLeituraRef.current = null;
      setErro('A balança foi desconectada. Conecte novamente.');
      return null;
    }

    // Se o loop não está rodando (morreu por erro), reinicia
    if (!loopRunningRef.current && !readerRef.current) {
      shouldStopRef.current = false;
      iniciarLeituraContinua();
    }

    setLendo(true);
    setErro(null);
    try {
      // Se há leitura recente (< 4s), retorna imediatamente
      const atual = ultimaLeituraRef.current;
      if (atual && Date.now() - new Date(atual.timestamp).getTime() < 4000) {
        return atual.peso;
      }
      // Aguarda até 8s por uma nova leitura do stream contínuo
      const startTime = Date.now();
      while (Date.now() - startTime < 8000) {
        await new Promise((r) => setTimeout(r, 150));
        const leitura = ultimaLeituraRef.current;
        if (leitura && Date.now() - new Date(leitura.timestamp).getTime() < 4000) {
          return leitura.peso;
        }
      }
      throw new Error('timeout');
    } catch (e) {
      const msg = e.message || String(e);
      if (msg === 'timeout') {
        const raw = rawDataRef.current || '';
        if (dadosRecebidosRef.current && raw) {
          setErro('A balança está enviando dados mas não foi possível ler o peso. Verifique na página Balança se o baud rate é 4800 e se o número de decimais corresponde ao visor.');
        } else {
          setErro('Tempo esgotado: a balança não enviou dados em 8 segundos. Verifique se está ligada, se o cabo está conectado e se o driver USB do conversor serial está instalado neste PC.');
        }
      } else if (msg === 'porta_perdida') {
        setErro('A conexão com a balança foi perdida. Reconecte na página Balança.');
        setStatus('desconectado');
        portRef.current = null;
        setPortaInfo(null);
      } else {
        setErro(`Erro na leitura: ${msg}`);
      }
      return null;
    } finally {
      setLendo(false);
    }
  }, [iniciarLeituraContinua]);

  /** Tenta reconectar usando a última porta autorizada (sem pedir seleção ao usuário). */
  const reconectar = useCallback(async () => {
    if (!('serial' in navigator)) {
      setSuportado(false);
      return false;
    }
    setErro(null);
    setStatus('conectando');

    // Tenta usar portas já autorizadas
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        const port = ports[0];
        await pararLeitura();
        const oldPort = portRef.current;
        if (oldPort) {
          try { await oldPort.close(); } catch {}
          portRef.current = null;
        }
        try {
          await port.open({
            baudRate: baudRateRef.current,
            dataBits: dataBitsRef.current,
            stopBits: stopBitsRef.current,
            parity: parityRef.current,
          });
          portRef.current = port;
          setPortaInfo(port.getInfo());
          shouldStopRef.current = false;
          ultimaLeituraRef.current = null;
          dadosRecebidosRef.current = false;
          rawDataRef.current = '';
          setUltimaLeitura(null);
          setRawData('');
          setStatus('conectado');
          iniciarLeituraContinua();
          return true;
        } catch (e) {
          if (e.name === 'InvalidStateError') {
            portRef.current = port;
            setPortaInfo(port.getInfo());
            setStatus('conectado');
            shouldStopRef.current = false;
            if (!loopRunningRef.current) iniciarLeituraContinua();
            return true;
          }
          throw e;
        }
      }
    } catch (e) {
      // Continua para requestPort
    }

    // Sem portas autorizadas — pede seleção ao usuário
    return conectar();
  }, [pararLeitura, iniciarLeituraContinua, conectar]);

  const trocarBaudRate = useCallback((novoBaud) => {
    setBaudRate(novoBaud);
    try { localStorage.setItem(BAUD_KEY, String(novoBaud)); } catch {}
  }, []);

  const trocarDataBits = useCallback((v) => {
    setDataBits(v);
    try { localStorage.setItem(DATABITS_KEY, String(v)); } catch {}
  }, []);

  const trocarStopBits = useCallback((v) => {
    setStopBits(v);
    try { localStorage.setItem(STOPBITS_KEY, String(v)); } catch {}
  }, []);

  const trocarParity = useCallback((v) => {
    setParity(v);
    try { localStorage.setItem(PARITY_KEY, v); } catch {}
  }, []);

  const trocarCasasDecimais = useCallback((v) => {
    setCasasDecimais(v);
    try { localStorage.setItem(CASAS_KEY, String(v)); } catch {}
  }, []);

  /**
   * Conecta a balança abrindo a porta UMA ÚNICA VEZ na taxa salva.
   * NÃO faz ciclo de baud rates — fechar/reabrir a porta interrompe o fluxo de dados
   * do adaptador USB-serial (a luz do adaptador para de piscar).
   * Se a porta já está aberta (auto-conexão), apenas reutiliza — nunca fecha.
   */
  const conectarComAutoDeteccao = useCallback(async () => {
    if (!('serial' in navigator)) {
      setSuportado(false);
      setStatus('nao_suportado');
      return false;
    }
    setErro(null);

    // Se a porta já está aberta e conectada, NÃO fecha — apenas garante leitura ativa
    if (portRef.current && portRef.current.readable) {
      if (!loopRunningRef.current && !readerRef.current) {
        shouldStopRef.current = false;
        iniciarLeituraContinua();
      }
      setStatus('conectado');
      return true;
    }

    setStatus('conectando');
    try {
      const port = await navigator.serial.requestPort();

      // Abre UMA VEZ na taxa salva — sem ciclar entre baud rates
      await port.open({
        baudRate: baudRateRef.current,
        dataBits: dataBitsRef.current,
        stopBits: stopBitsRef.current,
        parity: parityRef.current,
      });
      portRef.current = port;
      setPortaInfo(port.getInfo());
      shouldStopRef.current = false;
      ultimaLeituraRef.current = null;
      dadosRecebidosRef.current = false;
      rawDataRef.current = '';
      setUltimaLeitura(null);
      setRawData('');
      setStatus('conectado');
      iniciarLeituraContinua();
      return true;
    } catch (e) {
      if (e.name === 'NotFoundError' || e.name === 'AbortError') {
        // Usuário cancelou a seleção de porta
        setStatus('desconectado');
      } else if (e.name === 'InvalidStateError') {
        // A porta já estava aberta — usa ela
        setStatus('conectado');
        if (!loopRunningRef.current) {
          shouldStopRef.current = false;
          iniciarLeituraContinua();
        }
        return true;
      } else if (e.name === 'SecurityError') {
        setStatus('erro');
        setErro('Acesso negado pelo navegador. Use Chrome ou Edge em desktop via HTTPS.');
      } else if (e.name === 'NotSupportedError') {
        setStatus('erro');
        setErro('Combinação de parâmetros não suportada pelo adaptador. Tente 8 data bits, 1 stop bit, parity none.');
      } else if (e.name === 'NetworkError') {
        setStatus('erro');
        setErro('A porta está ocupada por outro programa. Feche qualquer outro software de balança e tente novamente.');
      } else {
        setStatus('erro');
        setErro(`Erro ao abrir porta: ${e.message || e}`);
      }
      return false;
    }
  }, [iniciarLeituraContinua]);

  const value = {
    suportado,
    status,
    portaInfo,
    baudRate,
    dataBits,
    stopBits,
    parity,
    casasDecimais,
    ultimaLeitura,
    rawData,
    erro,
    lendo,
    conectar,
    conectarComAutoDeteccao,
    reconectar,
    desconectar,
    lerPeso,
    trocarBaudRate,
    trocarDataBits,
    trocarStopBits,
    trocarParity,
    trocarCasasDecimais,
    formatarPeso: (peso) => formatarPeso(peso, casasDecimais),
  };

  return <BalancaContext.Provider value={value}>{children}</BalancaContext.Provider>;
}

export function useBalanca() {
  const ctx = useContext(BalancaContext);
  if (!ctx) throw new Error('useBalanca deve ser usado dentro de BalancaProvider');
  return ctx;
}

// HMR: módulos de Context não suportam hot-reload granular quando o Provider
// vive num módulo pai (App.jsx). Força recarga completa para evitar mismatch
// Provider/Consumer após edição deste arquivo.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}