# PAINEL ESTQ — ATUALIZAR O SERVIDOR PELO SEU PC

Este recurso é **opcional**. Quem não configurar acesso remoto continua usando e
atualizando o estoque localmente como antes. Não foram criadas rotas /api de
administração remota, não foram alterados o banco, o controle de saldos ou o
Cloudflare Tunnel. O servidor não precisa ser migrado para usar o novo recurso.

## Arquitetura de segurança

- Comunicação somente pela **rede privada Tailscale** (IP 100.64.0.0/10).
  Não abra a porta 22 no roteador nem publique SSH no Cloudflare.
- OpenSSH no servidor, autenticação exclusiva por chave ed25519. A chave privada
  permanece no seu PC em %LOCALAPPDATA%\ESTQ-Painel.
- A chave autorizada no servidor tem ForceCommand + restrict, portanto só pode
  pedir status ou update; não permite shell livre nem tunelamento SSH por ela.
- Antes da primeira conexão é obrigatório comparar e confirmar a impressão
  digital SHA256 do servidor, exibida no painel do servidor.
- Nunca envie a chave privada pelo WhatsApp, GitHub, e-mail ou backup do ERP.
- O Tailscale requer login nos DOIS PCs e controle dos dispositivos autorizados
  na conta da organização (ACLs/grants e aprovação de novos dispositivos).

## Configuração inicial — uma única vez

1. Atualize o repositório pelo procedimento **local** já utilizado no servidor.
   Isso NÃO faz migração nem restauração de banco de dados.
2. No **seu PC**, baixe o PAINEL_ESTQ.exe da página Releases do GitHub.
   Instale/abra Tailscale e faça login na mesma rede privada do servidor.
3. No painel do seu PC, clique **Gerar/copiar chave deste PC**. Copie só a chave
   PÚBLICA.
4. No **servidor**, instale/abra Tailscale, faça login e confira que tem IP 100.x.
   Instale o início automático GitHub e confirme que o backend foi iniciado e
   é mantido pelo monitor de ops/monitor_backend.py. A atualização que altera o
   backend exige esse monitor e bloqueia quando outro programa controla o processo.
5. Abra o PAINEL_ESTQ.exe **como Administrador no servidor**, indique a pasta
   real que contém backend/ e ops/ e clique **Autorizar no servidor (local)**.
   Cole a chave pública do passo 3. O painel habilita OpenSSH e restringe a
   regra de firewall gerenciada pelo Windows ao bloco de IPs do Tailscale.
   Se houver regras de firewall de terceiros que liberem SSH, remova-as.
6. Copie do LOG do painel do servidor os 4 dados: IP Tailscale, usuário Windows,
   pasta do projeto e FINGERPRINT_HOST (SHA256).
7. No seu PC, preencha IP, usuário e pasta do servidor; clique em **Confiar na
   identidade** e digite a impressão digital SHA256 que você acabou de ler no
   servidor. O painel recusa identidade diferente. Clique **Testar conexão**.
8. Depois, clique **ATUALIZAR SERVIDOR REMOTO**. O painel mostrará as etapas
   e os erros, sem precisar de acesso físico ao PC servidor.

### Atualização segura

O script ops/remote_update.py, executado no servidor via SSH autorizado:
- Confere projeto oficial, branch main, diretório íntegro, backend saudável e
  ausência de alterações manuais rastreadas.
- Baixa a versão main e só aceita avanço de commits (fast-forward).
- **Bloqueia** alterações de migrations ou requirements do backend; nesses casos
  é necessária atualização local supervisionada com backup. Nunca executa
  migrações manualmente durante a atualização remota.
- Compila frontend em diretório separado e troca dist/ somente após compilação.
- Mantém uma cópia do dist/ anterior em .estq-dist-anterior.
- Caso haja mudança no código do backend, exige monitor atualizado controlando
  a instância e solicita reinício controlado; valida retorno do /api/health.
- Não encerra processos pertencentes a outro painel e nunca tenta um reset de
  banco ou de repositório. Se não puder garantir isso, mostra falha e bloqueia.

### Observações importantes

- Haverá possível interrupção breve quando for necessário atualizar o backend.
  Execute fora de operações ativas no estoque e confira o log após a atualização.
- A atualização que falha após publicação pode exigir reparo local supervisionado.
  Não é correto garantir risco zero sem testar no Windows com os dados reais.
- O painel é uma aplicação Windows local, não um botão dentro do site.
- O computador servidor precisa estar ligado e o Tailscale conectado.
- O recurso remoto não substitui backup periódico nem o roteiro de migração.
- Se o Windows usa uma conta Microsoft e o nome do usuário é diferente do nome
  exibido no login, use o nome local retornado no log do painel.
- A porta do ERP (8000) continua local, acessada pelo Cloudflare Tunnel atual.
- Configuração do OpenSSH exige privilégio Administrador apenas uma vez.
- Testar de ponta a ponta o setup e a atualização num Windows real antes de
  depender do recurso para produção.
