# Central Fiscal silenciosa — distribuição de NF-e por NSU

## Estado inicial: desligada e sem ações fiscais

A Central Fiscal roda dentro do GFARM, **sem formulário, sem nova tela, sem novo
botão e sem autorizar/aprovar estoque ou manifestações fiscais**. Por padrão,
\`GFARM_DFE_ENABLED\` não existe (ou é \`0\`), portanto não consulta SEFAZ,
não altera pendências, não cria tabelas e não acessa certificados.

Quando ativada e configurada, o agendador roda a cada cinco minutos e efetua
**no máximo uma chamada de distNSU por CNPJ e por rodada**. O serviço persiste
\`ultNSU\` e só consulta o próximo lote na sequência. Se não houver documentos
(\`cStat=137\`) ou \`ultNSU=maxNSU\`, espera 65 minutos. Se receber
\`cStat=656\`, suspende 125 minutos. Se houver erro, espera 35 minutos.
**Não consulte o mesmo CNPJ/NSU simultaneamente em outro sistema.**

## Pré-requisitos técnicos para ativação (somente uma vez)

- Certificado **A1** válido (.pfx/.p12), com chave privada e senha.
- O PFX precisa estar montado no **container da VPS** e acessível pelo usuário
  \`estq\`. Um certificado instalado apenas no Windows não está disponível no
  servidor; certificados A3 de token/cartão não são suportados neste conector.
- O CNPJ destinatário e o código IBGE da UF do estabelecimento (ex.: MA=21).
- Segredos e arquivos de certificado não podem entrar no GitHub.

O volume privado **app_data** existente já é montado dentro do container como
\`/home/estq/Documents/INDEX ERP DATA\`; não é necessário criar volume novo.
Crie no volume uma pasta privada para o PFX e proteja a leitura do arquivo.
**Não copie o PFX para \`uploads\` público** ou para o frontend.

Adicionar à configuração privada \`GFARM APP/backend/.env\` da VPS:

\`\`\`dotenv
GFARM_DFE_ENABLED=1
GFARM_DFE_CNPJ=00000000000000
GFARM_DFE_CUF=21
GFARM_DFE_CERT_PFX=/home/estq/Documents/INDEX ERP DATA/certificados/empresa.pfx
GFARM_DFE_CERT_PASSWORD=senha_privada_do_pfx
\`\`\`

Substituir os exemplos pelo CNPJ, UF, caminho real e segredo verdadeiro.
O arquivo \`.env\` não pode ser versionado e deve ter permissões restritas.
**Não compartilhar a senha nem o certificado no chat.**

Para múltiplos CNPJs/certificados, definir \`GFARM_DFE_PROFILES\` como um
array JSON privado no ambiente, com cada item:

\`\`\`json
{
  "cnpj": "00000000000000",
  "cuf": "21",
  "cert_path": "/home/estq/Documents/INDEX ERP DATA/certificados/empresa.pfx",
  "password_env": "GFARM_CERT_EMPRESA_1"
}
\`\`\`

A senha de cada perfil fica na variável de ambiente indicada por
\`password_env\`, nunca no JSON. Não duplicar CNPJs no mesmo conjunto.

Depois de configurar, usar o processo normal de atualização da VPS. A Central
Fiscal só tentará se ativar quando um A1 válido estiver acessível. Se não
estiver, o GFARM continua operando normalmente com os recebimentos e a
captura antiga por FSist.

## O que ela faz, automaticamente

1. Busca **distNSU**, sempre a partir do último NSU salvo no PostgreSQL.
2. Armazena \`docZip\` descompactados em \`gfarm_dfe_documentos\` (tabela
   privada, com SHA-256), identificando documentos \`resumo\` ou \`completo\`.
3. Só usa \`nfeProc/NFe\` completas, cuja chave e CNPJ destinatário conferem,
   para preencher os campos fiscais das pendências do Meus Controles.
4. Se o XML chegou antes da pendência, a integração consulta o cache local na
   chegada do lançamento, **sem nova consulta à SEFAZ**.
5. Não altera produtos cadastrados, saldos, custos já aprovados, manifestações
   do destinatário nem movimentações do estoque. A aprovação é manual.

**Nota importante:** em muitas operações o Ambiente Nacional disponibiliza
primeiro somente \`resNFe\` (resumo). O resumo não tem itens/quantidades/custos
e NÃO pode ser tratado como XML completo. Para obter o \`procNFe\` pode ser
necessária uma manifestação fiscal apropriada, que esta automação deliberadamente
**não emite**. A NF-e é de responsabilidade legal do estabelecimento.

A distribuição não disponibiliza um histórico ilimitado. O cache passa a
preservar os documentos recebidos daí em diante. A inicialização de um
CNPJ sem uso prévio do serviço pode não recuperar notas antigas.

## Sem testes na SEFAZ

A validação do código é feita unicamente com XMLs fictícios e compactados
em memória nos GitHub Actions; nenhuma NF real, CNPJ real, PFX real, ou
requisição externa à SEFAZ é usada nesses testes. A automação continua
desligada na VPS até configurar o certificado A1.
