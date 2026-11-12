#!/usr/bin/env bash
# Resiliencia do acesso ao terminal da VPS: SSH + qemu-guest-agent + swap.
# NAO altera Docker, containers, aplicativos, firewall nem bancos.
set -Eeuo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: execute como root." >&2
  exit 1
fi

exec 9>/run/lock/fnh-proteger-terminal.lock
flock -n 9 || { echo "ERRO: protecao ja em andamento." >&2; exit 1; }

# Preflight: nunca aplicar um watchdog sobre um daemon SSH com configuracao invalida.
command -v systemctl >/dev/null || { echo "ERRO: sem systemd." >&2; exit 1; }
command -v ss >/dev/null || { echo "ERRO: sem comando ss." >&2; exit 1; }
SSHD="$(command -v sshd || true)"
if [ -z "$SSHD" ] && [ -x /usr/sbin/sshd ]; then SSHD=/usr/sbin/sshd; fi
if [ -z "$SSHD" ] || ! "$SSHD" -t; then
  echo "ERRO: sshd ausente ou configuracao invalida; nenhuma alteracao realizada." >&2
  exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/root/backup-acesso-vps-$TS"
install -d -m 0700 "$BACKUP"
for p in /etc/systemd/system/fnh-terminal-recuperacao.service \
         /etc/systemd/system/fnh-terminal-recuperacao.timer \
         /usr/local/sbin/fnh-terminal-recuperacao \
         /etc/fstab; do
  if [ -e "$p" ]; then
    install -m 0600 "$p" "$BACKUP/$(basename "$p")"
  fi
done

echo "[1/4] Garantindo que o SSH e o agente da virtualizacao estao disponiveis..."
# ssh.socket pode manter a porta aberta mesmo quando ssh.service esta inativo.
if systemctl list-unit-files ssh.socket --no-legend 2>/dev/null | grep -q '^ssh.socket'; then
  if ! systemctl is-active --quiet ssh.socket && ! systemctl is-active --quiet ssh.service; then
    systemctl start ssh.socket || systemctl start ssh.service
  fi
elif ! systemctl is-active --quiet ssh.service; then
  systemctl start ssh.service
fi
if systemctl list-unit-files qemu-guest-agent.service --no-legend 2>/dev/null | grep -q '^qemu-guest-agent.service'; then
  systemctl is-active --quiet qemu-guest-agent.service || systemctl start qemu-guest-agent.service || true
fi

echo "[2/4] Instalando recuperacao automatica do acesso (somente se falhar)..."
cat >/usr/local/sbin/fnh-terminal-recuperacao <<'RECOVERY'
#!/usr/bin/env bash
set -u
# Recupera apenas a porta SSH caso nao exista nenhum listener na(s) porta(s)
# configurada(s). Nao reinicia servico SSH se ele esta escutando.
SSHD=/usr/sbin/sshd
if [ ! -x "$SSHD" ] || ! "$SSHD" -t >/dev/null 2>&1; then
  logger -t fnh-terminal "Configuracao SSH invalida: recuperacao nao executada."
  exit 1
fi
PORTAS="$("$SSHD" -T 2>/dev/null | awk '$1=="port" {print $2}')"
[ -n "$PORTAS" ] || PORTAS=22
encontrado=0
for p in $PORTAS; do
  if ss -H -ltn "( sport = :$p )" 2>/dev/null | grep -q .; then
    encontrado=1
    break
  fi
done
if [ "$encontrado" -eq 0 ]; then
  logger -t fnh-terminal "SSH sem listener; tentando recuperar sem reiniciar VPS ou Docker."
  systemctl start ssh.socket >/dev/null 2>&1 || true
  systemctl start ssh.service >/dev/null 2>&1 || true
  sleep 1
  for p in $PORTAS; do
    if ss -H -ltn "( sport = :$p )" 2>/dev/null | grep -q .; then
      encontrado=1
      break
    fi
  done
  if [ "$encontrado" -eq 0 ]; then
    logger -t fnh-terminal "SSH ainda sem listener apos tentativa de start."
    exit 1
  fi
fi
if systemctl list-unit-files qemu-guest-agent.service --no-legend 2>/dev/null | grep -q '^qemu-guest-agent.service'; then
  if ! systemctl is-active --quiet qemu-guest-agent.service; then
    logger -t fnh-terminal "Agente da virtualizacao parado; tentando iniciar."
    systemctl start qemu-guest-agent.service || true
  fi
fi
exit 0
RECOVERY
chmod 0700 /usr/local/sbin/fnh-terminal-recuperacao

cat >/etc/systemd/system/fnh-terminal-recuperacao.service <<'UNIT'
[Unit]
Description=Recuperacao automatica do SSH/Hostinger sem reiniciar a VPS
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/fnh-terminal-recuperacao
TimeoutStartSec=20
UNIT

cat >/etc/systemd/system/fnh-terminal-recuperacao.timer <<'TIMER'
[Unit]
Description=Verificar SSH e agente da VPS a cada 2 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=30s

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now fnh-terminal-recuperacao.timer >/dev/null
# Checagem imediata; continua sem alterar aplicativos caso a porta esteja aberta.
systemctl start fnh-terminal-recuperacao.service

echo "[3/4] Criando reserva de memoria para picos de compilacao se nao houver swap..."
if ! swapon --noheadings --show=NAME 2>/dev/null | grep -q .; then
  FSTYPE="$(findmnt -n -o FSTYPE -T / 2>/dev/null || true)"
  FREE_MB="$(df -Pm / | awk 'NR==2 {print $4+0}')"
  if [[ "$FSTYPE" == ext4 || "$FSTYPE" == xfs ]] && [ "$FREE_MB" -gt 4096 ] && [ ! -e /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 0600 /swapfile
    if mkswap /swapfile >/dev/null 2>&1 && swapon /swapfile; then
      grep -Fqx '/swapfile none swap sw 0 0' /etc/fstab || printf '%s\n' '/swapfile none swap sw 0 0' >>/etc/fstab
      echo "Swap de 2 GB ativada para amortecer picos de RAM."
    else
      echo "AVISO: nao foi possivel ativar swap; arquivo nao sera mantido."
      swapoff /swapfile >/dev/null 2>&1 || true
      rm -f /swapfile
    fi
  else
    echo "Swap nao criada: sistema de arquivos ou espaco nao elegivel, ou /swapfile existente."
  fi
else
  echo "Swap ja estava ativa, nenhuma modificacao necessaria."
fi

echo "[4/4] Verificando recuperacao..."
systemctl --no-pager --full status fnh-terminal-recuperacao.timer | head -n 13 || true
echo "Portas SSH:"
ss -ltnp | grep -E 'sshd|:22[[:space:]]' | head -n 8 || true
echo "Memoria e swap:"
free -h
echo
echo "PROTECAO INSTALADA. Nao foi necessario reiniciar VPS, SSH, Docker ou aplicativos."
echo "Backup das configuracoes: $BACKUP"
echo "IMPORTANTE: se a tela da Hostinger continuar falhando mesmo com SSH ativo,"
echo "o defeito pode estar no painel/provedor, e nao no Linux."
