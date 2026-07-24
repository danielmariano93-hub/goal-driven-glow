# Plano — Templates Zod-validados + Correção contábil canônica

Duas frentes na mesma execução. Foco em paridade estrita entre a fórmula SQL `financial_daily.v2` (fonte da verdade) e o motor TS usado por `analyze_spending`, `generate_chart_artifact` e `generate_report_from_template`.

## Diagnóstico contábil (verificado por leitura)

Fatos observados nesta rodada, com a linha de origem:

1. **SQL canônico** (`20260724023000_..._hardening.sql`): estornos entram como `type=income AND movement_kind=refund AND transfer_group_id IS NULL`, abatendo `behavioral_consumption` via `THEN -t.amount`. Transferências internas saem por `transfer_group_id IS NULL` e `movement_kind <> 'internal_transfer'`. Fatura de cartão sai por `settles_card_id IS NULL`.
2. **TS `engine/facts.ts:106` (`behavioralMetricAmount`)** trata `movement_kind = 'refund'` **independentemente de `t.type`**. Se um refund vier lançado como `expense` (ou vier com `transfer_group_id` preenchido em cenário de estorno-espelho), a função retorna `-amount` e o TS diverge do SQL. Estas duas condições não replicam o gate do SQL (`type='income' AND transfer_group_id IS NULL`).
3. **TS `isRealMonthlyMovement`** não checa `transfer_group_id`. Uma linha com `movement_kind='transaction'` mas `transfer_group_id != NULL` seria contada no TS e ignorada no SQL.
4. **`analytics/timeseries.ts:52`** faz `Math.max(0, byDay.get(d))` — o dia com estorno líquido negativo é apresentado como zero. Para contabilidade honesta, o `daily` deve preservar o sinal (o clamp cai só na renderização, não no fato). O `total` já é `sum(daily)`, hoje inflado.
5. **Templates**: `financial_report_templates` tem os três `active=true`. `generate_report_from_template` valida `active` no banco, mas os `params` só são validados por JSON Schema com `additionalProperties: true` — sem Zod, sem coerção, sem mensagens úteis.
6. **Cobertura de testes**: existe `report-templates.test.ts` (matching regex) e `canonical-financial-foundation.test.ts` (grep na migration). **Não existe** teste que exercite `generate_report_from_template` fim-a-fim, nem paridade "TS × SQL" com cenários de estorno/transferência.

## O que será entregue

### A) Fórmulas canônicas — paridade TS ↔ SQL

Arquivo: `supabase/functions/_shared/engine/facts.ts` (mesmo motor consumido por `analytics/*` e pelo `useCanonicalMonthly` no cliente via `src/lib/engine/facts.ts` — vamos alinhar os dois).

- **Refund estrito**: só abate consumo comportamental quando `t.type === 'income' && (t.transfer_group_id ?? null) === null`. Refund lançado como `expense` volta a somar como despesa comum (fica visível como erro de dado, não como abatimento silencioso).
- **`isRealMonthlyMovement`**: passa a exigir `transfer_group_id == null`, alinhando a SQL.
- **Sinal preservado em `timeseries`**: `daily` guarda o valor com sinal (positivo=consumo, negativo=estorno líquido do dia); `total` continua correto; a renderização (`ChartArtifactRenderer.tsx`) exibe negativos como chip "Estorno líquido" no dia e a curva monótona não é clampada. Nenhuma UI hoje depende de `daily >= 0`.
- Espelho da versão: exportar `FORMULA_VERSION = "financial_daily.v2"` de `facts.ts` e usar em `provenance` dos artefatos para casar com o `formula_version` dos templates cadastrados.

### B) Templates com validação Zod

Arquivo novo: `supabase/functions/_shared/agent/templates/templateSchemas.ts`

- `SpendingTrendParams`, `MonthlyComparisonParams`, `WeeklyOnePageParams` como `z.object` com `additionalProperties: false` (via `.strict()`), coerção de datas (`z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`) e defaults.
- `parseTemplateArgs(template_key, params)` retorna `{ ok, data | error }`.

Alteração em `supabase/functions/_shared/agent/tools.ts` (`generate_report_from_template`):

- Antes de chamar `generate_chart_artifact`, roda `parseTemplateArgs`. Falha → `{ ok: false, error: "invalid_template_params", details }`.
- Atualiza o JSON Schema no registro para refletir as chaves canônicas por template (`from/to` em `spending_trend`, `metric` em `monthly_comparison`, `weeks_back` em `weekly_one_page`) e `additionalProperties: false`.
- `templateToArtifactArgs` respeita os params validados (hoje ignora `from/to` e `weeks_back`).

### C) Testes de integração determinísticos

Todos rodam em vitest puro (sem Deno), com `sb` stubado e `ToolContext` mínimo.

- `src/test/tools-report-template.integration.test.ts` — cobre 6 casos:
  1. `spending_trend` sem params → chama `generate_chart_artifact` com `kind='average_daily_trend'`, salva artifact, `formula_version === 'financial_daily.v2'`.
  2. `monthly_comparison` com `metric='income'` → propaga metric.
  3. `weekly_one_page` com `weeks_back=1` → traduz para `days=7` na semana anterior.
  4. `template_key` inexistente → `unknown_template`.
  5. Template com `active=false` (stub) → `template_inactive`.
  6. Params inválidos (ex.: `metric='foo'`) → `invalid_template_params`.

- `src/test/facts-refund-parity.test.ts` — paridade contábil TS ↔ SQL:
  1. Refund lançado como `income + refund + transfer_group_id=null` **abate** consumo comportamental.
  2. Refund lançado como `expense + refund` **não** abate (regra estrita) e é ignorado como movimento real (dado inconsistente).
  3. Linha `movement_kind='transaction'` com `transfer_group_id` preenchido **não** entra no consumo.
  4. Transferência interna (`internal_transfer`) e fatura (`settles_card_id`) permanecem fora.
  5. Cenário composto (renda + gasto + refund + aplicação + rendimento + fatura + transferência) confere `income`, `expense`, `net` exatos.

- `src/test/timeseries-refund-signed.test.ts` — o dia com estorno líquido negativo é preservado; `total = sum(daily)`; `daily_avg` usa dias com dados (incluindo negativos).

- Atualiza `canonical-financial-foundation.test.ts` para exigir `FORMULA_VERSION === "financial_daily.v2"` exportado por `facts.ts`.

### D) Validação e deploy

- `bunx vitest run` completo — meta: 545+/545+ verdes (10 novos casos, ajuste dos existentes conforme regra estrita).
- Deploy de `agent-chat` (usa `tools.ts` alterado). `finance-backfill-runner` **não** muda.

## Detalhes técnicos

**Compat com dados legados**: a mudança em `behavioralMetricAmount` é mais restritiva; o número absoluto pode variar em usuários cujo dado tinha refund como `expense`. Isso é o comportamento correto — o SQL já era assim. Registrar diferença esperada em `.lovable/migration-reconciliation.md` (nota de 3 linhas) para o runner de backfill classificar como "TS parity fix, non-regression".

**Sem migration nesta rodada**: a SQL canônica já está em produção e correta. Todas as mudanças são TS + testes + registro da tool.

**Escopo negativo**: não muda `analyze_spending`, não mexe em rotas HTTP, não altera `AppAdapter` regexes, não toca `ChartArtifactRenderer` além de aceitar `daily` negativo (verificação já existe para números; ajustaremos só o label do chip).

## Riscos

- Componentes de UI que assumam `daily >= 0` — checar `ChartArtifactRenderer` antes da entrega.
- Se algum usuário em produção tem estorno lançado como `expense`, ele verá o total de despesa subir. É correção contábil, não regressão; documentar no changelog interno.
