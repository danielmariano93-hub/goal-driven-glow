# Corrigir erro ao aplicar categoria em lote

## O que está acontecendo

Ao selecionar vários lançamentos e aplicar a mesma categoria, a atualização dos lançamentos até começa, mas uma rotina automática que roda em seguida é bloqueada e todo o lote falha com a mensagem de erro técnico que você viu.

Causa confirmada: quando um lançamento sem categoria recebe categoria, o sistema tenta marcar como "resolvida" a dica/insight relacionada àquele lançamento. A regra de acesso da tabela de insights só permite que o próprio usuário deixe um insight nos estados "ativo" ou "descartado" — o estado "resolvido" é recusado. Resultado: erro de permissão e lote inteiro cancelado.

## Correção

1. Passar a rotina automática de resolução de insights a rodar com privilégio de sistema (função de gatilho `SECURITY DEFINER`, com escopo restrito ao próprio usuário do lançamento). Assim ela consegue marcar "resolvido" sem afrouxar as regras de acesso do usuário.
2. Manter a política de acesso do usuário como está hoje (usuário continua só podendo ativar/descartar), sem abrir escrita nova para o cliente.
3. Validar depois da correção: aplicar categoria em lote em vários lançamentos sem categoria e confirmar sucesso, insights relacionados marcados como resolvidos e nenhum erro de permissão.

## Detalhes técnicos

- Migration única: `CREATE OR REPLACE FUNCTION public.tg_transactions_resolve_tips()` com `SECURITY DEFINER` e `SET search_path = public`, preservando o corpo atual (só atualiza linhas de `public.user_insights` do mesmo `user_id` do lançamento e com `evidence->>'transaction_id'` igual ao id da transação). Nenhuma alteração de schema, nenhuma nova tabela, nenhuma política nova.
- Não haverá mudança em `src/pages/Lancamentos.tsx`: o `update` em lote já é correto; ele apenas herdava a falha do gatilho.
- Sem segunda fonte de verdade; sem alteração de fatos financeiros.
- Teste de regressão: verificação de que a função de gatilho está marcada como `security definer` (guarda em suíte SQL/teste de contrato) + validação manual do fluxo em lote.

## Fora deste escopo (posso fazer depois, se quiser)

Os 228 lançamentos ainda sem categoria: dá para rodar um preenchimento automático apenas onde houver evidência forte (mesmo estabelecimento já categorizado por você). Prefiro tratar isso numa rodada separada, após o lote voltar a funcionar.
