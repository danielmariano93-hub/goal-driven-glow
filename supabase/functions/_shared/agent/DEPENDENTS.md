# Dependentes de `supabase/functions/_shared/agent`

Contrato de deploy atômico (`nino_analytical.v2`).

Causa-raiz: em 31/08/2026 uma run de produção registrou um truth gate
(`goal_current_consistent`) que já não existia no código-fonte. O `_shared` havia
mudado, mas só parte das Edge Functions foi redeployada — cada função embute sua
própria cópia de `_shared` no bundle. Resultado: código novo no repositório,
código antigo respondendo ao usuário.

## Regra

Toda alteração em qualquer arquivo sob `supabase/functions/_shared/agent/` (ou em
`_shared/analytics`, `_shared/finance-core`, consumidos por ele) exige redeploy
de TODAS as funções abaixo, no mesmo lote:

- `whatsapp-webhook`
- `agent-run`
- `agent-chat`
- `agent-proactive-tick`
- `anticipation-tick`
- `financial-reports-generate`
- `shared-goal-notify-invite`
- `split-reminders-dispatch-v2`
- `user-ai-preferences`

Fonte de verdade da lista: `scripts/check-agent-dependents.mjs`
(`npm run check:agent-dependents`), que varre os imports reais e falha quando
aparece uma função dependente fora desta lista.

## Verificação pós-deploy

1. Suba `AGENT_RUNTIME_VERSION` em
   `supabase/functions/_shared/agent/core/RuntimeContract.ts`.
2. Redeploy do lote inteiro.
3. Smoke test: enviar um turno analítico e conferir em
   `agent_runs.context_layers.analytical_path.runtime_version` que o valor é o
   novo. Versão antiga = drift, o deploy não chegou naquela função.
