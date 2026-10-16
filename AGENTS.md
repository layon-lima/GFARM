# AGENTS.md — REGRAS OFICIAIS DO PROJETO ESTQ

> Última atualização: 07/10/2026
>
> Este arquivo é a referência permanente de trabalho do projeto **ESTQ / ESTOQUE_NOVO_HORIZONTE**.
> Antes de qualquer alteração no projeto, este arquivo deve ser lido primeiro.

---

## 0. REGRA OBRIGATÓRIA DE LEITURA

**ANTES DE FAZER QUALQUER COISA NO PROJETO:**

1. Ler este `AGENTS.md` por inteiro.
2. Buscar o estado atual da branch `main`.
3. Verificar o fluxo real do dado antes de alterar código.
4. Se a tarefa tocar estoque, custo, quantidade, movimentação, saldo, lote, reserva, transferência, estorno, inventário, abastecimento, aplicação, pesagem ou NF-e, inspecionar primeiro o **motor oficial de estoque**.
5. Nunca corrigir inconsistência de estoque apenas na interface.
6. Nunca criar uma segunda fonte da verdade.

Se uma instrução nova do usuário contrariar este arquivo, vale a **instrução explícita mais recente do usuário**. Depois disso, atualizar este arquivo para refletir a nova regra permanente.

---

# 1. IDENTIDADE DO PROJETO

- Nome de referência: **ESTQ / ESTOQUE_NOVO_HORIZONTE / app de estoque**.
- **NUNCA chamar o aplicativo de “INDEX”**. INDEX é apenas um nome histórico.
- É um sistema particular.
- Não vincular, autenticar, publicar ou criar recursos em Base44 ou em plataforma externa sem solicitação explícita.
- Não criar integrações externas desnecessárias.
- Não alterar logo, identidade visual ou assets de marca sem pedido explícito do usuário.
- A mecânica de **buscar imagem de produto na internet foi removida**. Não reintroduzir sem pedido explícito.

---

# 2. ARQUITETURA OFICIAL

Arquitetura atual:

- Frontend: React/Vite em `src/`.
- Backend: FastAPI em `backend/app/`.
- Banco real: PostgreSQL configurado exclusivamente por `backend/.env`.
- Frontend de produção: `dist/`, servido pelo próprio FastAPI.
- API: rotas relativas em `/api`.
- Uploads: `/uploads`.
- Backend de produção: `127.0.0.1:8000`.
- Domínio público existente via Cloudflare Tunnel.
- Não criar banco paralelo de desenvolvimento no fluxo oficial.
- Não usar porta 8001.
- Nunca expor, copiar ou alterar credenciais sem solicitação explícita.

---

# 3. REGRA MÁXIMA: MOTOR DE ESTOQUE = FONTE ÚNICA DA VERDADE

## 3.1 Princípio

**O MOTOR DE ESTOQUE É A FONTE DA VERDADE E ELE MANDA.**

Tudo que altera estado real de estoque deve passar pelo motor oficial.

Fonte oficial:

- motor principal: `backend/app/services/motor_estoque.py`;
- API oficial de estoque: `/api/estoque`;
- saldo físico oficial: tabela `estoque_saldos`.

Nenhum módulo, tela, cadastro, relatório ou helper pode manter uma lógica paralela que contradiga o motor.

## 3.2 Operações que DEVEM passar pelo motor

Qualquer alteração relacionada a:

- quantidade;
- saldo;
- entrada;
- saída;
- transferência;
- estorno;
- custo atual;
- reavaliação de custo;
- valor total de estoque;
- lote;
- reserva;
- inventário;
- abastecimento;
- aplicação;
- pesagem com efeito no estoque;
- NF-e com efeito no estoque;
- devolução;
- ajuste positivo ou negativo.

## 3.3 Proibições

É proibido alterar saldo diretamente por:

- frontend;
- API genérica;
- ORM genérico;
- SQL ad hoc;
- componente React;
- helper isolado;
- patch que contorne o motor.

Não escrever diretamente em estruturas de estoque legado.

A API/ORM genérica não deve comandar diretamente:

- `Movimentacao` legado;
- `SaldoEstoque` legado;
- `Lote` como quantidade oficial;
- `Produto.quantidade` como fonte de verdade;
- `Lote.quantidade` como fonte de verdade.

Campos-resumo podem existir por compatibilidade, mas são **projeções do motor**, nunca autoridade independente.

## 3.4 Custo do produto

Regra permanente:

- o custo atual deve ser determinado pelo estado do motor;
- alteração manual de custo deve ser tratada como **reavaliação oficial pelo motor**;
- `Produto.custo_unitario` é resumo/projeção compatível do valor do motor, não uma fonte separada;
- telas de Cadastro, Pesquisa, Dashboard e relatórios atuais devem enxergar o **mesmo custo atual**;
- não usar `Produto.custo_unitario` e `EstoqueSaldo.custo_medio` como duas autoridades diferentes;
- se houver divergência, o problema deve ser corrigido no motor/reconciliação, nunca mascarado na tela;
- quando estoque chegar a zero, preservar o último custo conhecido, salvo regra futura explícita em contrário.

## 3.5 Histórico não é reescrito

Documentos e movimentações passadas são históricos.

Ao mudar o custo atual:

- não reescrever custo de documento antigo;
- não reescrever movimentação antiga;
- não alterar comprovantes históricos;
- não recalcular fatos passados como se tivessem acontecido com o novo custo.

**Estado atual** e **histórico** são coisas diferentes.

## 3.6 Regras do motor já consolidadas

- Saldos reais devem ser usados para disponibilidade.
- Quando houver lote, respeitar FEFO quando aplicável.
- Reservas devem ser processadas pelo motor e manter auditoria.
- Operações idempotentes não podem gerar movimento duplicado.
- Venda baixa estoque uma única vez no momento correto.
- Conversão de operação não-venda para venda deve baixar somente no momento previsto.
- Venda que já baixou estoque não pode baixar novamente.
- Estorno deve passar pelo motor e restaurar o que a regra oficial determinar.
- Exclusão de entidade vinculada a saldo oficial deve ser bloqueada quando aplicável.

## 3.7 Entrada Manual de Saldo

Regra permanente:

- no PC, **Entrada Manual de Saldo é um módulo próprio no topo de Movimentos**;
- não deve voltar a aparecer como opção dentro do dropdown de finalidade da Entrada;
- a experiência do PC deve preservar a facilidade do fluxo mobile: setor, produto, quantidade, depósito/gaveta, validade quando aplicável e foto opcional;
- o PC pode contabilizar diretamente somente para usuário com `admin.estoque.entrada_manual`;
- o mobile continua usando solicitação + revisão;
- PC e mobile devem compartilhar a mesma rotina de contabilização aprovada;
- a contabilização final de ambos passa obrigatoriamente pelo motor oficial com `ENTRADA_SALDO_ADMIN`;
- não criar saldo, quantidade ou produto com uma lógica paralela fora desse fluxo;
- produto inexistente pode ser criado pela rotina oficial antes da contabilização, seguindo as mesmas regras do fluxo mobile.

## 3.7 Permissões e Sub Administradores

Regra permanente:

- `admin` = **Administrador Total**, com acesso irrestrito;
- `subadmin` = **Sub Administrador**, com somente as funções administrativas que o Administrador Total liberar;
- `user` = usuário padrão;
- a fonte oficial das permissões é a tabela `user_permissions`;
- campos antigos de permissão em `users` existem apenas como projeção de compatibilidade;
- somente o Administrador Total pode conceder/revogar permissões, promover para Sub Administrador ou Administrador Total;
- Sub Administrador nunca pode aumentar as próprias permissões nem promover outro usuário;
- backend deve validar a permissão real; esconder botão no frontend não é segurança suficiente;
- todas as permissões de um usuário devem ser configuradas no **painel único de Permissões** em Cadastros > Usuários;
- novas funções administrativas devem entrar no catálogo central de permissões, nunca em um novo `role == "admin"` isolado;
- permissões existentes devem ser migradas/preservadas ao evoluir o modelo.

---

# 4. ONLINE / OFFLINE

Regra geral:

- **movimentações oficiais de estoque são online** por enquanto;
- não criar modo offline que altere saldo oficial localmente.

Exceção já aprovada:

- o fluxo mobile de Abastecimento pode ter captura offline-first;
- captura offline não significa alteração oficial de estoque;
- o saldo oficial só muda quando o backend/motor processar e confirmar a operação online.

Nunca armazenar uma “verdade paralela” de saldo no dispositivo.

---

# 5. MOBILE

## 5.1 Setores

A navegação mobile deve ser dinâmica conforme permissões do usuário.

- Setores reais autorizados aparecem diretamente.
- Exemplos: ADUBO, ALMOXARIFADO, DEFENSIVOS, SEMENTES etc.
- Não usar aba genérica **“Meu Setor”**.
- Não criar tela intermediária desnecessária para escolher setor.
- Setores liberados devem aparecer nos cards da Home e na navegação mobile conforme o desenho aprovado.
- “Abastecedor” permanece conforme regra específica já implementada.
- Home/Mais devem respeitar a ordem e estrutura já aprovadas.

## 5.2 PWA

- Mobile deve permanecer PWA instalável.
- HTTPS é necessário.
- Service worker/cache pode guardar **interface estática**.
- Nunca cachear como verdade:
  - API;
  - login;
  - sessão;
  - saldo;
  - dados operacionais;
  - respostas de estoque.

---

# 6. UI / UX

Regra global:

**priorizar ao máximo a área útil de trabalho.**

Nas páginas do app:

- cabeçalhos compactos;
- hero mínimo;
- títulos e descrições enxutos;
- cards/KPIs compactos;
- margens e espaçamentos verticais reduzidos;
- evitar grandes áreas vazias;
- dar prioridade a tabela, formulário e operação;
- pode reorganizar layout se isso aumentar área útil sem perder clareza.

Não alterar a linguagem visual inteira sem pedido do usuário.

### Layout desktop — largura útil

- Nas páginas principais de PC, usar praticamente toda a largura disponível da janela, com margens laterais pequenas e consistentes.
- Não impor limites fixos de `max-width` a páginas operacionais completas (Pesquisa, Movimentos, Pesagem, Cadastros, Aplicação, Relatórios e Inventário).
- Tabelas e listas devem distribuir colunas conforme a largura realmente disponível, sem scroll horizontal desnecessário.

### Pesagem rodoviária — registro imediato e recaptura

- No desktop, a primeira faixa mantém três cartões **alinhados em altura**: Dados do Ticket, Resumo do Ticket e Pesagem/Balança. A tabela de tickets ocupa toda a largura logo abaixo.
- Na Balança existe **um único botão principal de captura**, sem confirmação intermediária: **Capturar 1ª Pesagem** grava a primeira e abre o ticket; depois **Capturar 2ª Pesagem** registra a segunda e habilita o fechamento.
- Se uma pesagem estiver incorreta, o usuário **clica no próprio campo da 1ª ou 2ª pesagem** para selecioná-la e usa o mesmo botão para capturar novamente. Não criar botões separados para corrigir.
- A recaptura da 1ª pesagem atualiza apenas o peso do ticket **em aberto** no backend, sem alterar o estoque nem criar outro ticket; a 2ª continua editável antes do fechamento.
- A área da Balança mostra o **Peso Líquido** calculado pelas duas pesagens. Não há campo nem mecanismo ativo de correção manual de peso.
- O botão **Fechar e Salvar Ticket** permanece exclusivamente no Resumo e somente é liberado após as duas pesagens, mantendo a baixa de vendas pelo motor oficial.
- Dados e correções de tickets históricos não devem ser apagados ou migrados destrutivamente; permissões de entrada manual de peso permanecem obrigatórias.
- **Tipo de ticket é pré-requisito para qualquer preenchimento**: todos os demais campos do formulário e a captura de peso devem ficar desabilitados até a seleção do tipo (ao carregar ticket já aberto, o tipo do próprio ticket autoriza o fluxo).
- **Trocar o tipo não deve zerar o formulário**: preservar motorista, placa, transportadora, cliente/fornecedor, produto, origem, destino e observações já informados. Limpar apenas o vínculo de pedido de venda quando o novo tipo não for venda, para não carregar uma associação indevida.
- Os números de peso em tempo real, 1ª Pesagem, 2ª Pesagem e Peso Líquido devem ter fonte maior e legível, sem criar overflow na coluna da balança.


### Pré-cadastro rápido na Pesagem (16/10/2026)

- A primeira aba da página Pesagem é **Pré-cadastro**: localizar antes de incluir motoristas, transportadoras, fornecedores e veículos.
- **Pessoa** é a fonte oficial para motorista, transportadora e fornecedor, com os perfis `is_motorista`, `is_transportadora` e `is_fornecedor`. **Veiculo** é a fonte oficial para placas e vínculos habituais.
- Usar os endpoints oficiais de `Pessoa` e `Veiculo`. Nunca criar banco, migration, tabela, fila, entidade, pendência ou cadastrador paralelo para esta função.
- Usuário com `page.pesagem` sem acesso à área de Cadastros pode **criar somente os campos mínimos** de Pessoa/Veículo e habilitar uma flag de perfil de Pessoa por vez. O backend nega edição geral, alteração de outros campos, exclusão e operações em lote. Quem possui acesso a Cadastros mantém suas permissões anteriores.
- Havendo pessoa existente, habilitar somente o perfil necessário sem sobrescrever nome, documento, outros perfis ou vínculos. Verificar possíveis duplicados por documento e nome; homônimos com documentos distintos não devem ser tratados como a mesma pessoa.
- Havendo veículo cadastrado com a mesma placa normalizada, reutilizar o cadastro e não recriar nem alterar seus vínculos automaticamente.
- O pré-cadastro **não abre ticket, não captura peso e não movimenta estoque**. Tickets, Pedidos e Pagamentos mantêm os fluxos oficiais.
- A operação deve ser compacta, com busca inicial, campos essenciais e acesso direto a Tickets. Cadastro completo continua em Cadastros > Pessoas e Veículos.
- Dados novos só ficam disponíveis para tickets depois que a API oficial confirma o salvamento. As mutações devem invalidar o cache oficial das entidades.

### Movimentos no PC — layout compacto aprovado

- Preservar a largura integral já alcançada na página **Movimentos**.
- Para **Entrada / Compra / Nota Fiscal**, manter na primeira linha **Tipo e finalidade (à esquerda)** e **Documento fiscal (à direita)**, incluindo Número da NF, Fornecedor e Chave de acesso.
- Na segunda linha, manter **Produto (à esquerda, largo)** e **Quantidade (à direita, compacto)** como cartões lado a lado.
- Logo abaixo, **Localização** com Depósito e Gaveta lado a lado, usando a largura principal.
- **Observações** e ações de registro devem ocupar o menor espaço vertical adequado; manter o **Resumo da movimentação** na lateral direita.
- Não voltar a exibir a lista **Movimentações recentes** abaixo do formulário; o histórico dos documentos permanece preservado no backend.
- A reorganização é visual e também deve preservar os campos e validações necessários a Saída, Transferência, Estorno e Entrada Manual; nunca contornar o motor oficial.
- Priorizar o formulário inteiro visível no desktop quando a altura da janela permitir, sem esconder conteúdo ou prejudicar acessibilidade.

- Não ocultar colunas, dados, filtros ou ações só para reduzir a largura; scroll interno somente quando os dados realmente excederem o espaço.
- Não afetar o shell mobile/PWA, formulários modais ou telas que justificadamente exijam leitura estreita.
- Corrigir preferencialmente o contêiner compartilhado e as tabelas, evitando remendos isolados por tela.

Não remover funcionalidades existentes só para “simplificar” UI.

---

# 7. DADOS, MIGRATIONS E INTEGRIDADE

- Migrations devem ser preferencialmente **aditivas e não destrutivas**.
- Não rodar reset, limpeza destrutiva ou recriação do banco real.
- Não apagar histórico para “corrigir” inconsistência.
- Reconciliações devem preservar rastreabilidade e regras do motor.
- Tabelas legadas arquivadas não devem voltar a comandar o fluxo.
- Preservar autenticação, JWT, uploads, permissões e regras de negócio.
- Não criar coluna/tabela duplicada para resolver problema que já tem fonte oficial.
- Antes de migrar dados, identificar claramente qual campo é autoridade e qual é projeção.
- Não inventar dados faltantes.

---

# 8. FRONTEND NÃO É FONTE DE VERDADE

O frontend deve:

- consultar;
- exibir;
- validar entrada básica;
- enviar intenção da operação.

O frontend **não deve**:

- recalcular uma verdade própria de estoque;
- alterar saldo por conta própria;
- manter custo paralelo;
- compensar erro do backend com fórmula diferente;
- sobrescrever o resultado do motor;
- assumir que cache/localStorage é estado oficial.

Se duas telas exibirem valores diferentes para o mesmo estado atual, considerar **bug arquitetural** e rastrear a fonte do dado.

---

# 9. PESQUISA, CADASTRO, DASHBOARD E RELATÓRIOS

Todos devem refletir o mesmo estado oficial.

Para dados atuais de estoque:

- quantidade: motor;
- disponibilidade: motor;
- custo atual: motor;
- valor atual: motor;
- reservas: motor.

Cadastro não cria uma verdade diferente da Pesquisa.

Pesquisa não substitui custo do motor por cálculo local diferente.

Dashboard não soma dados de uma fonte paralela.

Relatórios históricos podem usar valores históricos de documentos, porque representam fatos passados.

---

# 10. MÓDULOS E ESTRUTURAS LEGADAS

- Não existe módulo “Compras” oficial no projeto atual.
- Não reativar estruturas antigas só porque um componente legado ainda existe.
- Componentes mantidos por compatibilidade não significam que suas tabelas antigas são fonte oficial.
- Antes de usar qualquer estrutura antiga, confirmar se ela faz parte do motor ERP atual.
- Se houver dúvida, o fluxo novo do motor prevalece.

---

# 11. GITHUB E CONTROLE DE VERSÃO

Regra atual:

- **GitHub / branch `main` é a fonte oficial do código publicado.**
- Antes de editar, buscar novamente o HEAD atual da `main`.
- Não partir de SHA antigo sem conferir a `main`.
- Não usar force push.
- Não apagar histórico.
- Não fazer reset destrutivo.
- Não restaurar uma árvore antiga inteira para corrigir um arquivo isolado.
- Não reverter mudanças não relacionadas.
- Alterações devem ser mínimas e focadas.

Fluxo preferido:

1. buscar `main`;
2. criar branch;
3. alterar somente arquivos necessários;
4. conferir diff;
5. abrir PR;
6. rodar validações;
7. corrigir falhas;
8. mergear na `main`.

---

# 12. VALIDAÇÃO OBRIGATÓRIA ANTES DO MERGE

Antes de concluir uma alteração relevante:

- compilar backend;
- rodar testes do backend;
- rodar build do frontend;
- rodar lint;
- rodar typecheck se fizer parte do fluxo configurado;
- conferir diff completo;
- conferir que não houve alteração colateral.

Para bugs graves, criar teste de regressão que reproduza o bug real sempre que possível.

Não considerar “passou a função isolada” suficiente quando o bug acontece no fluxo real.

Testar o endpoint/fluxo que a UI realmente usa.

---

## 12.1 Portabilidade e infraestrutura segura

- TODA alteracao permanente de inicializacao, migracao, instalacao e hospedagem do ESTQ deve ser feita primeiro no GitHub; nao depender de scripts avulsos gerados fora do repositorio.
- O caminho local nao pode ficar fixo em C:\\Users\\User; usar pasta do proprio projeto e configuracao apropriada quando o servidor for transferido.
- Migração deve preservar PostgreSQL oficial, arquivos de backend/uploads, XMLs pendentes e segredos por canal privado — nunca colocar senhas, dumps ou tokens no Git.
- Nunca permitir restore sobre banco com tabelas; exigir verificacao SHA-256 e validacao de destino vazio antes da restauração.
- Antes de trocar de PC/VPS: parar novas movimentacoes na origem, produzir backup final consistente, validar motor e arquivos no destino e garantir somente uma fonte de estoque com escrita.
- O Windows pode reiniciar o backend apos login via monitor versionado; Tunnel tem supervisao independente. Se o PC estiver desligado, so um servidor externo pode manter o app online.
- Hospedagem externa deve manter PostgreSQL e uploads persistentes, rede de banco privada, HTTPS, healthchecks, backups EXTERNOS e nenhum segredo no GitHub.
- Balanca Web Serial depende do navegador/USB do PC operador; pasta local XML requer transferencia segura para VPS.

## 12.2 PAINEL ÚNICO E TRANSFERÊNCIA PARA OUTRO WINDOWS

- Entrega para novo PC: **um unico GFARM_Instalador_Definitivo.exe**, compilado pelo build_windows.ps1 versionado. GFARM e GFARM Control sao aplicativos web executados por Python; nao gerar PAINEL_ESTQ.exe, GFARM.exe ou GFARM-Control.exe.
- No novo PC, o instalador prepara dependencias e codigo privado. O Control web configura a conexao com o PostgreSQL existente e oferece restauracao verificada somente em destino vazio, com confirmacao explicita; nao criar/reinicializar banco automaticamente.
- Toda a operação de instalação, atualização, início, diagnóstico, exportação e restauração deve estar acessível pelo painel.
- Banco, uploads, XMLs e chaves privadas NÃO estão no GitHub ou no EXE; transferir dados reais em pacote ZIP + SHA256 via meio privado criptografado e exigir confirmação da fonte antes do corte.
- Preservar identidade, contas, históricos, custos, saldos oficiais do motor, tickets e arquivos; não reinicializar banco antigo, não criar um banco paralelo, não reescrever registros.
- Nunca abrir backend no destino com banco vazio. Não permitir restore sobre tabelas ou uploads existentes; não iniciar o túnel público novo antes de parar o antigo para escrita.
- Cloudflare Tunnel precisa de autorização pelo próprio dono no novo PC; não gravar token no GitHub, painel ou logs. Dispositivos Web Serial necessitam de nova permissão no navegador.
- O painel deve operar com duplo clique no Windows e exibir erro/progresso, sem exigir git pull, Python ou scripts manuais ao usuário como fluxo principal.

# 13. DEPLOY

- O usuario quer validar a instalacao no proprio PC e corrigir erros concretos conforme aparecerem; nao exigir outro computador ou maquina virtual como pre-requisito.
- Para esta entrega solicitada, a publicacao pode substituir o instalador da Release oficial apos os testes e a compilacao Windows. O marcador de commit `[instalar-no-pc]` solicita essa entrega; commits comuns nao publicam instaladores.

## Atualizacao incremental (regra de 16/10/2026)

- O botao **Atualizar GitHub** atualiza GFARM e GFARM Control na MESMA pasta instalada, mantendo `app_path`.
- Usar cache Git de metadados/objetos e baixar somente os blobs alterados; nao clonar o aplicativo inteiro nem criar uma instalacao por versao em atualizacoes normais.
- Adicionar, substituir e remover somente arquivos de programa identificados pelo diff de commits. Preservar os arquivos sem alteracao e bloquear conflitos locais.
- Staging temporario dos arquivos alterados, compilacao temporaria de `dist` e backup dos arquivos substituidos sao permitidos para validacao/rollback; nao sao instalacoes paralelas.
- Preservar integralmente PostgreSQL, `.env`, anexos, XMLs, backups, chaves e senha do Control. Migrations diferentes exigem procedimento supervisionado; iniciar o servico nao aplica migrations.
- Os dois aplicativos rodam como servicos/web por Python. O unico EXE proprio distribuido e `GFARM_Instalador_Definitivo.exe`; preservar suporte de migracao das instalacoes antigas.
- Preparar branch e PR; nao integrar a `main` nem substituir o instalador da Release sem aprovacao explicita do usuario.

O usuário possui painel local com a ação:

**“Atualizar do GitHub e publicar”**

Depois de colocar a alteração na `main`, orientar o usuário a usar esse botão.

Não mandar o usuário fazer `git pull` manual como fluxo normal.

Não assumir acesso ao computador local do usuário.

Não afirmar que o deploy local ocorreu só porque o GitHub foi atualizado.

---

# 14. PROCEDIMENTO OBRIGATÓRIO PARA CORRIGIR BUGS

Antes de alterar código:

1. reproduzir mentalmente o fluxo real;
2. identificar de onde o dado nasce;
3. identificar qual endpoint é realmente chamado;
4. identificar qual tabela/serviço é fonte oficial;
5. verificar caches e projeções;
6. verificar se existe duplicidade de regra;
7. corrigir na origem;
8. só depois ajustar UI;
9. adicionar teste de regressão;
10. validar no CI.

Nunca repetir o erro de corrigir apenas um helper/tela quando o fluxo real passa por outro endpoint.

---

# 15. PROTEÇÃO CONTRA INCONSISTÊNCIA

Sempre que um dado aparece em vários módulos:

- definir uma única fonte oficial;
- demais camadas devem consumir essa fonte;
- não duplicar cálculo de negócio;
- não “sincronizar manualmente” várias verdades independentes;
- preferir projeções derivadas da fonte oficial.

Se houver divergência:

**não escolher arbitrariamente qual tela está certa. Rastrear a fonte oficial e reconciliar os dados.**

---

# 16. ALTERAÇÕES SENSÍVEIS

Exigem cuidado extra:

- saldo;
- custo;
- valor de estoque;
- reservas;
- inventário;
- migrações;
- autenticação;
- permissões;
- banco;
- service worker;
- deploy;
- Cloudflare;
- exclusão de registros;
- alterações em lote.

Nesses casos:

- não patchar às cegas;
- inspecionar o código real;
- validar comportamento atual;
- evitar atalhos de frontend.

---

# 17. REGRAS DE PRESERVAÇÃO

- Não quebrar funcionalidades existentes.
- Não remover vínculo com mobile.
- Não alterar dados históricos sem necessidade explícita.
- Não mudar formato de API sem revisar consumidores.
- Não trocar tecnologia/arquitetura por conveniência sem necessidade.
- Não recriar módulos já existentes.
- Não criar versões paralelas do mesmo fluxo.
- Não criar pastas/arquivos temporários no repositório sem necessidade.
- Não deixar código morto de uma tentativa fracassada quando a mecânica for removida.

---

# 18. REGRA PARA NOVAS DECISÕES PERMANENTES

Sempre que o usuário disser algo como:

- “daqui para frente…”;
- “sempre…”;
- “nunca…”;
- “isso é regra…”;
- “lembra disso…”;
- “tudo tem que passar por…”;

a decisão deve ser tratada como regra permanente do projeto.

Se ela afetar arquitetura, fluxo, UI ou operação:

**atualizar este `AGENTS.md` na mesma alteração ou imediatamente depois.**

---

# 19. CHECKLIST RÁPIDO ANTES DE QUALQUER COMMIT

Perguntas obrigatórias:

- Li o `AGENTS.md`?
- Busquei a `main` atual?
- Estou mexendo na fonte correta?
- Se envolve estoque, passou pelo motor?
- Criei alguma verdade paralela?
- Estou alterando histórico indevidamente?
- Estou usando estrutura legada como se fosse oficial?
- Quebrei mobile?
- Quebrei permissões?
- Quebrei PWA?
- Mudei algo não solicitado?
- Existe teste para o bug?
- Build e lint passaram?
- Backend e testes passaram?
- O diff está limitado ao necessário?

Se alguma resposta for problemática, **não fazer merge** até corrigir.

---

# 20. FRASE-GUIA DO PROJETO

> **O motor de estoque é a fonte única da verdade.**
>
> **As telas não mandam no estoque. Os cadastros não criam uma verdade paralela. O histórico não é reescrito. Todo estado atual de estoque passa pelo motor.**

---

# 21. ORGANIZAÇÃO GFARM (15/10/2026)

- Código, instalador, painel, backend, frontend e testes ficam em **GFARM APP/**.
- **BACKUPS/** permanece separado na raiz.
- **.github/workflows/** permanece na raiz, com builds executados em **GFARM APP/**.
- Caminhos relativos descritos nas regras anteriores são interpretados a partir de **GFARM APP/**.
- A instalação antiga do servidor não deve ser atualizada automaticamente para este layout sem plano de migração seguro.
