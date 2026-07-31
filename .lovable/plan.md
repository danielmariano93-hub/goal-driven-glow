## Situação verificada agora (leitura, nenhuma alteração feita)

Código da main já está no projeto: `src/pages/NinoHub.tsx`, `src/pages/admin/NinoIA.tsx`, `src/components/admin/SplitReminderJourney.tsx`, `src/pages/Cartoes.tsx` e as duas migrations do patch existem em `supabase/migrations/`.

Banco de dados (consultado):
- `confirm_invoice_import_atomic` e `settle_credit_card_statement`: **presentes** (financeiro anterior intacto).
- `ai_model_routes`: tabela **já existe**.
- **Não aplicado ainda:** `agent_knowledge_entries`, `admin_configuration_audit`, `split_reminder_policy`, `credit_card_payment_reversals`, e as RPCs `admin_ai_model_routes`, `admin_ai_model_route_update`, `admin_agent_knowledge_list`, `admin_agent_knowledge_upsert`, `admin_split_reminder_policy`, `admin_split_reminder_policy_update`, `update_credit_card_statement_item`, `reverse_credit_card_statement_payment`.

Conclusão: **as duas migrations do patch estão pendentes**; o frontend já publicado/mainline chama RPCs que ainda não existem (Nino & IA e edição/reversão de fatura falham hoje).

## Migrations pendentes (nesta ordem, sem duplicar nem regerar)

1. `20260731013000_nino_admin_knowledge_communication.sql` — cria as 3 tabelas (RLS ligada, `anon`/`authenticated` revogados, `service_role` com ALL), substitui `schedule_split_due_reminders` pela versão que lê a política editável, cria as 6 RPCs admin com `security definer` + `search_path` fixo, revoga `anon`/`PUBLIC` e concede a `authenticated`/`service_role`.
2. `20260731213000_statement_detail_edit_and_payment_reversal.sql` — cria `credit_card_payment_reversals` (RLS por `auth.uid()`, SELECT para `authenticated`), `update_credit_card_statement_item` e `reverse_credit_card_statement_payment` (reversão atômica com `FOR UPDATE` e snapshot auditável).

Ambas já vêm com `search_path` fixo e grants corretos — compatíveis com o hardening de segurança recém-aplicado.

## Funções que precisam de deploy

- `assistant-ingest-document` (passa a respeitar o roteamento de modelos `vision` / `semantic_classification`).
- `whatsapp-webhook` (resposta contextual ao participante do rolê não vinculado).
- **Não tocar:** função `mcp` (7 ferramentas preservadas, manifest inalterado), `assistant-review-actions`, demais functions.

## Sequência exata de implantação (após sua autorização)

1. Migration `20260731013000_...` (aprovação no diálogo de migration).
2. Migration `20260731213000_...`.
3. Regenerar tipos do backend, se o pipeline exigir.
4. `tsgo` (typecheck) + suíte integral de testes (vitest) + `npm run build`.
5. Confirmar que o build **não** alterou `supabase/functions/mcp/index.ts` além do banner (7 ferramentas mantidas) — se alterar, não fazer deploy de `mcp`.
6. Deploy de `assistant-ingest-document` e `whatsapp-webhook`.
7. Verificação pós-migration: existência das RPCs, `pg_proc.proconfig` com `search_path`, grants/`anon` revogado, RLS ligada nas 4 tabelas novas; linter do banco + scan de segurança restrito às alterações.
8. Smoke tests autenticados (abaixo). **Sem publicar o frontend.**

## Resultado previsto dos testes

- Typecheck: sem erros.
- Vitest: ~794+ testes aprovados, incluindo `nino-admin-journey-contract`, `product-complete-journeys-contract` e `invoice-atomic-payment-mcp-contract` (este último garante que as 7 ferramentas MCP e os contratos financeiros seguem intactos).
- Build de produção: aprovado.

## Riscos encontrados

| Risco | Mitigação |
| --- | --- |
| `schedule_split_due_reminders` é substituída (CREATE OR REPLACE) pela versão orientada a política | Assinatura idêntica; `split_reminder_policy` recebe linha default equivalente à régua atual; validar fila de `reminder_jobs` após aplicar |
| `credit_card_payment_reversals` faz `DELETE FROM public.transactions` na reversão | Somente da transação do pagamento, sob `FOR UPDATE`, com snapshot; nenhum recálculo financeiro alterado |
| Frontend já em produção chama RPCs inexistentes | As migrations resolvem; enquanto não aplicadas, telas permanecem com erro (estado atual) |
| Edge Functions passam a depender de `ai_model_routes` | Tabela já existe; fallback de modelo mantido |
| Fatura Itaú em revisão (`invoice_total_mismatch`) | **Não** será aprovada, alterada ou feito backfill; permanece para correção manual |

## Smoke tests (executar após implantação, ambiente autenticado)

Fatura: abrir Cartões → Histórico → “Ver e editar fatura”; conferir itens; editar categoria e descrição e recarregar (persistência no item e na transação); registrar pagamento parcial e conferir saldo da conta, valor em aberto e histórico; desfazer o pagamento e conferir restauração de saldo/status; repetir a reversão para confirmar idempotência.

Nino: em Mais, existir apenas “Meu Nino”; alternar “Meu plano” / “O que aprendeu”; `/app/nino-contexto` redirecionar.

Admin: abrir “Nino & IA”, editar e salvar uma rota de modelo e um item de conhecimento, recarregar; em Comunicações → Jornadas, editar a régua do rolê, salvar e confirmar reagendamento; em Mensagens, editar template e simular **sem envio real**.

## Rollback

- Frontend/Functions: redeploy do commit anterior de `assistant-ingest-document` e `whatsapp-webhook`; frontend não é publicado, logo nada a reverter.
- Banco: as migrations são aditivas. Reversão cirúrgica se necessário — `DROP FUNCTION public.reverse_credit_card_statement_payment(uuid);`, `DROP FUNCTION public.update_credit_card_statement_item(uuid,text,uuid);`, `DROP` das 6 RPCs admin novas, e restaurar `schedule_split_due_reminders` a partir de `20260728230000_product_quality_hardening.sql`.
- **Não** apagar `credit_card_payment_reversals`, `admin_configuration_audit` nem qualquer tabela de auditoria em rollback.
- Jornadas novas podem ser desativadas pelo próprio admin sem rollback de banco.

Nada será executado até sua autorização explícita.