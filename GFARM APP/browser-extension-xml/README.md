# Captura de XML no navegador — GFARM

Extensão experimental para Chrome e Edge (Manifest V3).

## Instalação

1. Baixe e extraia `gfarm-captura-xml-chrome.zip`.
2. No navegador, abra `chrome://extensions` ou `edge://extensions`.
3. Ative **Modo do desenvolvedor** e clique **Carregar sem compactação**.
4. Selecione a pasta extraída com o `manifest.json`.
5. No cartão da extensão **GFARM — Captura de XML da NF-e**, ative **Permitir acesso a URLs de arquivo**.
6. Reabra o GFARM, entre em Recebimentos pendentes, clique em **Consultar e importar XML**. A janela deverá mostrar **Captura automática do navegador ativada**.
7. Clique **Abrir FSist** e baixe a NF-e como XML pelo próprio navegador. Quando o download terminar, o GFARM confere a chave e importa todas as pendências compatíveis daquela nota.

## Observações de segurança

- A extensão só encaminha arquivos **.xml** recém-baixados enquanto a janela de consulta do GFARM estiver ativa, com chave e número de NF-e correspondentes.
- Downloads de outras notas são ignorados. Não envia nada diretamente ao servidor: entrega ao GFARM aberto, onde a API autentica o usuário e verifica o XML novamente.
- A leitura do arquivo local exige a permissão **Permitir acesso a URLs de arquivo**. Essa permissão é abrangente no navegador; instale apenas em navegador/computador confiável e revise o código-fonte antes de habilitar.
- O FSist pode solicitar certificado digital, captcha e a própria extensão. Esta extensão do GFARM é **separada** da extensão do FSist.
- O FSist poderá alterar a estrutura do seu formulário e impedir o preenchimento automático da chave. O XML ainda pode ser baixado manualmente e importado pela extensão GFARM.
- Se o navegador salvar o arquivo como ZIP ou se o download for feito por um aplicativo externo ao Chrome/Edge, a captura automática não cobre esse caso; use a seleção manual do XML.
- A extensão não aprova nada. O estoque só é movimentado na aprovação do administrador pelo motor GFARM.
- Se a captura não funcionar, a opção **Selecionar XML** continua disponível.

## Escopo técnico

- `manifest.json`: permissão para observar downloads e ler arquivos locais.
- `background.js`: verifica chave, número, data do download e tamanho; descarta documentos alheios.
- `bridge.js`: comunicação restrita com `https://estoque.fazendanovohorizonte.com`.
- `fsist.js`: tenta preencher somente o campo da chave no FSist; não clica nem desvia captcha.

## Nova versão 0.2.0 — sincronizar pela SEFAZ no navegador

Em **Recebimentos do Meus Controles**, clique **Sincronizar XML**. Informe o CPF/CNPJ
do titular a consultar. O GFARM abre uma pequena janela do próprio Chrome/Edge
e o navegador solicita o certificado Windows quando a SEFAZ exige TLS mútuo.
Não existe aplicativo Windows separado nem exportação do PFX.

A extensão consulta a SEFAZ por distNSU, recebe até 50 documentos por lote e
repete as consultas até alcançar o último NSU disponível. O GFARM recebe
os docZip na API autenticada, confere o destinatário e preenche notas pendentes
somente quando o XML está completo. Não há manifestação ou aprovação automática.

**Para atualizar:** baixe o ZIP atualizado em
https://github.com/layon-lima/GFARM/releases/download/gfarm-captura-xml-v0.2.0/gfarm-captura-xml-chrome.zip
e extraia. Em edge://extensions ou chrome://extensions, atualize a extensão
carregada sem compactação apontando para a pasta com o manifest.json novo.
A extensão descompactada não atualiza sozinha.

**Limites:** o Chrome/Edge pode memorizar o certificado para o domínio SEFAZ;
para trocar de CPF pode ser necessário reiniciar o navegador ou usar outro
perfil. É preciso manter o computador ligado durante as consultas. O
cUFAutor padrão é MA=21. A SEFAZ pode fornecer apenas resNFe (resumo, sem itens
e preço) e observa janela de distribuição e períodos de espera obrigatórios.

Os testes da extensão são locais e não acessam a SEFAZ nem certificados reais.


## Versão 0.3.0 — selecionar o certificado do Windows sem digitar CPF

A extensão 0.2.0 não conseguia identificar automaticamente o CPF/CNPJ do
certificado e podia deixar de ser detectada em abas abertas antes da ativação.
Na versão 0.3.0, a ponte é injetada em abas GFARM existentes quando possível,
e a seleção de certificado passa a ser explícita na tela.

**São duas instalações no computador Windows (uma única vez):**

1. Baixe o [ZIP da extensão 0.3.0](https://github.com/layon-lima/GFARM/releases/download/gfarm-captura-xml-v0.3.0/gfarm-captura-xml-chrome.zip), extraia, abra \`edge://extensions\` ou \`chrome://extensions\`, remova a versão antiga e **Carregar sem compactação** com a pasta nova. Deixe a extensão ativa e permita acesso ao site \`estoque.fazendanovohorizonte.com\`.
2. Baixe o [ZIP da ponte Windows](https://github.com/layon-lima/GFARM/releases/download/gfarm-captura-xml-v0.3.0/gfarm-ponte-certificados-windows.zip), extraia e execute \`INSTALAR_PONTE_WINDOWS.ps1\` no Windows PowerShell. O instalador baixa \`NativeHost.cs\` do repositório, compila \`GFARM-Certificados.exe\` no seu PC e registra a ponte no HKCU (sem administrador).
3. Feche e abra o navegador. No GFARM, em **Recebimentos do Meus Controles**, clique **Sincronizar XML**: aparecem os certificados com chave privada instalados e válidos. Clique no certificado desejado.
4. O CPF/CNPJ vem do **CN público** do certificado ICP-Brasil (por exemplo, \`NOME:00000000000\`). Se o certificado não tiver essa identificação verificável, ele não aparece na seleção automática. A chave privada não é exportada, copiada nem transmitida ao GFARM.
5. A ponte faz a requisição HTTPS à SEFAZ **do seu próprio Windows**, com o certificado escolhido, e envia somente a resposta fiscal pela extensão ao GFARM autenticado. O cursor NSU e os bloqueios 137/656 continuam administrados no servidor e no navegador. Não há aprovação nem movimentação automática de estoque.

**Se a extensão parecer ausente:** confira se ela está ativada, em **Detalhes → Acesso ao site** permita execução em \`estoque.fazendanovohorizonte.com\`, recarregue o GFARM com Ctrl+F5 e tente novamente. Se a extensão responder mas a ponte não existir, a tela mostrará o link para instalar a ponte.

**Limites:** o instalador identifica os IDs das extensões nos perfis padrão Edge e Chrome; se não encontrar, pedirá apenas o **ID da extensão**, nunca o CPF. O helper requer Windows com .NET Framework e certificados ICP-Brasil acessíveis. Certificados com CPF/CNPJ ocultos ou outros formatos exigem adaptação específica; não inferimos a identidade pela OU da autoridade certificadora.

**Segurança:** o host nativo só recebe comandos da extensão autorizada pelo ID exato no manifesto do Windows. TLS é fixo para o endpoint da SEFAZ; a chave privada é usada apenas pelo provedor criptográfico do Windows. O servidor não recebe \`.pfx\`, senha, PIN ou chave privada. Todo o fluxo foi preparado para testes offline; somente o clique do usuário faz consulta real à SEFAZ.
