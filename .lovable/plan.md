Auditoria completa salva em `.lovable/plan.md`. Destaques verificados no banco e no código:

## Achados críticos (evidência real)

1. **Todos os RPCs `admin_*` gateiam por `is_platform_admin()` uniforme** — a matriz por papel em `src/lib/admin/permissions.ts` é cosmética. Analyst passa em qualquer RPC admin. (Confirmado via `pg_get_functiondef` de 12 RPCs.)
2. **PII vaza no servidor**:
   - `admin_message_activity` devolve `preview` (200 chars do `outbound_messages.body`), `to_phone` mascarado só nos últimos 4, `user_id`, e faz `ILIKE` no body.
   - `admin_conversation_activity` retorna `contact` + `preview`.
   - `admin_users_list` retorna `email` e `display_name`.
   - `Mensagens.tsx:218,276` já renderiza esses previews hoje.
3. **Não existe pipeline de eventos de produto** (`rg product_events|posthog|mixpanel` vazio). WVU, funis de feature, retenção coorte e "entrega de valor" não são calculáveis sem instrumentação nova.
4. **Base analítica útil existe**: `agent_runs` tem `intent_requested/served`, `tools_used`, `formula_versions`, `latency_ms`; `outbound_messages` tem `sent_at/delivered_at/read_at/accepted_at`, `surface`, `feature`. Permite entrega WhatsApp e p50/p95 hoje.
5. **Enum `platform_role` = `owner|admin|support|analyst`** — `support_lead` não existe. Decisão registrada: criar enum value + matriz `platform_permissions`.
6. **`admin_ops_health.imports_recent` lê `import_batches` (legado)** — o Pipeline Documental v2 usa `document_imports`. Métrica desalinhada.

## O plano em `.lovable/plan.md` contém as 17 seções obrigatórias

Incluindo:
- **§5**: Matriz fonte-atual × fonte-canônica para 13 métricas (WVU, ativação, W1/W4/W8, DAU/WAU/MAU, entrega WhatsApp, p50/p95, custo por sucesso, custo por WVU, receita/margem).
- **§6**: 20 eventos avaliados; decisão por eventos específicos (não genéricos). 4 eventos de valor canônicos: `goal_progress_explained`, `split_result_delivered`, `split_reminder_prepared`, `personalized_response_delivered`.
- **§7**: `product_events` append-only com allowlist, `user_pseudonyms` (UUID surrogate, não hash), agregados em tabelas físicas (não MV), timezone `America/Sao_Paulo`, retenção 90d raw + agregados perpétuos.
- **§8**: 14 contratos de RPCs futuros com params, retorno, roles, cache, comportamento denominador-zero e amostra <10.
- **§9**: Mapa completo de rotas → nova hierarquia `/admin/cockpit`, `/admin/crescimento`, `/admin/clientes`, `/admin/inteligencia-produto`, `/admin/operacao/{saude,mensageria,ia-ocr,whatsapp,assistente}`, `/admin/receita`, `/admin/governanca/{configuracoes,seguranca,auditoria}`. Recomendação: criar `Cockpit.tsx` novo e deprecar `VisaoGeral.tsx` (não reconstruir in-place).
- **§10**: RBAC + break-glass (TTL 15 min, reauth ≤5 min, auditoria em `platform_admin_audit`, testes negativos exigidos). Timeout `/admin` reduzido para 20 min via override em `SessionInactivityGuard`.
- **§11**: 9 migrations futuras, sem SQL, com aceite e rollback cada.
- **§12**: Rollout Fase 0 (auditoria) → 1 (privacidade emergencial, bloqueadora) → 2 (instrumentação) → 3 (Cockpit) → 4 (Crescimento/Retenção/Inteligência) → 5 (Operação/Receita/Governança).
- **§13-14**: 22 critérios de aceite mensuráveis + checklist de testes por categoria.
- **§15**: 6 decisões pendentes de aprovação humana.

## Recomendação

**Fase 1 (privacidade emergencial) é bloqueadora**: qualquer role platform hoje consegue puxar preview de mensagens e emails via RPC direto. Corrigir antes de qualquer redesign visual.

Aguardando autorização explícita para executar as fases.
