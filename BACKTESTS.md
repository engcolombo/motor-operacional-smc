# Backtests manuais do Diário Pro

Abra `diario-pro-plus.html` e entre na aba **Backtests**. Dê um nome à estratégia e clique em **Iniciar novo backtest**. Marque **Alvo** (1R, 2R ou 3R) ou **Stop** (-1R), depois **Registrar trade**. O histórico, saldo, acerto, drawdown e curva são recalculados a cada registro. **Continuar** reabre qualquer teste salvo. Excluir um trade recalcula o histórico; excluir um teste remove-o da lista após confirmação.

## Ativar a nuvem

1. No projeto Supabase já utilizado pelo diário, abra **SQL Editor**.
2. Execute o conteúdo de `supabase-backtests.sql` uma vez.
3. Entre no diário com seu login habitual e clique em **Sincronizar / buscar** na aba Backtests.

A migração cria somente a tabela de backtests, seu índice, políticas de acesso por usuário e proteção dos marcadores de exclusão. Não modifica as tabelas do diário nem as configurações. A aplicação usa a chave pública existente e as políticas RLS; não coloque chaves administrativas no HTML.

O login carrega os testes da conta. Registros feitos sem login ficam em uma área local separada: após entrar, use **Trazer testes locais** para copiá-los para a conta. A sincronização ocorre após alterações, ao entrar e quando a conexão volta; o botão permite buscar alterações feitas em outro dispositivo. Sem conexão ou sem a tabela, os registros permanecem locais e a mensagem informa a pendência. Não limpe os dados do navegador antes de sincronizar. **Exportar backup** baixa um JSON dos registros do contexto atual (conta ou visitante), incluindo marcadores de exclusão; esse arquivo serve para recuperação técnica, não é o importador dos trades reais.

Cada resultado é um registro pequeno; não são enviados gráficos, imagens nem consultas em tempo real. O plano Free inclui 500 MB de banco por projeto e 5 GB de egress, segundo https://supabase.com/docs/guides/platform/billing-on-supabase (consulta em 03/10/2026). O uso manual tende a caber, mas o espaço é compartilhado com os dados existentes. Confira o consumo em Usage no Supabase; o código não consegue verificar sua cota administrativa.

Exclusões usam marcadores persistentes para impedir que cópias offline ressuscitem registros. Por isso, excluir na interface não libera integralmente o espaço do banco. Os testes são brutos em R, sem taxas, parciais ou simulação automática de preços.

Validação automatizada: `node test-diario-backtests.cjs`.
