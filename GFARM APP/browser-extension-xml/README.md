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
