# GFARM — Migração para VPS (procedimento controlado)

Objetivo: hospedar API FastAPI e PostgreSQL na VPS Ubuntu, mantendo as interfaces PWA desktop e mobile.

## Estado atual
- O servidor Windows continua sendo a fonte de dados até o corte definitivo.
- `deploy/cloud/Dockerfile` e `deploy/cloud/compose.yml` já existem; não presumir que estão validados em produção.
- `ops/migrar_servidor.py` exporta banco PostgreSQL, uploads e XMLs pendentes com verificação SHA-256.
- Não versionar dumps, uploads, credenciais ou arquivos .env.

## Preparação (sem interromper produção)
1. Confirmar acesso SSH à VPS, capacidade de disco/memória e serviços já existentes (inclusive PLUV).
2. Definir domínio/subdomínio para GFARM, proxy reverso HTTPS e política de CORS.
3. Conferir variáveis de ambiente, persistência de volumes e isolamento de portas/redes Docker.
4. Conferir compatibilidade da versão do PostgreSQL origem com o destino e migrations.
5. Testar implantação em ambiente isolado e configurar backup automatizado com cópia externa.
6. Verificar que o PWA desktop/mobile utiliza endpoint configurável e que o modo offline existente permanece íntegro.

## Migração de dados e corte
1. Registrar contagens de usuários, produtos, saldos, movimentações, pesagens, pedidos e anexos no servidor antigo.
2. Pausar operações de escrita e parar a API antiga; manter PostgreSQL acessível para exportação.
3. Exportar banco + uploads + XMLs pelo script existente para pasta fora do Git, verificar ZIP e SHA-256.
4. Transferir o backup por canal privado seguro, sem expô-lo via HTTP ou GitHub.
5. Restaurar **somente em banco vazio** na VPS; não sobrescrever banco existente.
6. Validar dados, permissões, anexos, motor do estoque, fluxos de pesagem e aprovação.
7. Atualizar endpoint da PWA, HTTPS e configuração de origem; executar testes desktop/mobile.
8. Liberar escrita exclusivamente na VPS e manter servidor antigo parado, disponível apenas para rollback controlado.

## Critérios para concluir
- Integridade do backup confirmada.
- Contagens e saldos conferidos, incluindo anexos e XMLs.
- API responde pelo domínio HTTPS e reinicia automaticamente.
- Backup restaurável testado e alertas/monitoramento ativos.
- PWA desktop e mobile validadas; comportamento offline preservado.
- Nenhum cliente continua escrevendo no servidor Windows.

**Não executar o corte antes de validar a VPS e concluir a transferência dos dados reais.**
