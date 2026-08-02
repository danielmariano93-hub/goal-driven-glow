## Objetivo

Entregar, numa única rodada de implementação, os Relatórios Financeiros Inteligentes semanais e mensais do Meu Nino: cálculo determinístico, highlights, texto de IA validado, página premium, histórico, notificação in-app, cron real e envio pelo WhatsApp com deep link autenticado.

Observação: o HTML premium citado não veio anexado nesta mensagem. Vou recriar o layout a partir dos tokens listados no pedido e do design system atual. Se você anexar o HTML depois, ajusto o visual sem mexer no restante.

## 1. Banco de dados (uma migration)

- `financial_reports` (user_id, report_type semanal/mensal, period_start/end, timezone, status, generated_at/published_at/viewed_at, finance_contract_version, insight_catalog_version, template_version, health_score, health_breakdown, executive_summary, closing_text, text_source (ai/deterministic), data_quality_status, data_quality_flags, request_id, idempotency_key, timestamps). Índice único por (user_id, report_type, period_start).
- `financial_report_metrics` (report_id, metric_key, metric_value, comparison_value, comparison_percentage, unit, source, evidence jsonb, sort_order).
- `financial_report_highlights` (report_id, detector_key, detector_version, type, title, body, priority, confidence, evidence, cta_label, cta_route, dedup_key, selection_reason, sort_order).
- `financial_report_deliveries` (report_id, channel, recipient, status, provider_message_id, attempt_count, last_attempt_at, delivered_at, failed_at, error_code, error_details).
- Extensão de `notification_preferences`: `weekly_report_enabled`, `monthly_report_enabled`, `report_weekday`, `report_hour`, `report_timezone`, `report_channel`, `report_detail_level`, `report_tone`.
- Para cada tabela nova: GRANT para `authenticated`/`service_role`, RLS ativa com políticas por `auth.uid()` (leitura própria; escrita só service role), FKs `on delete cascade`, trigger de `updated_at`.
- RPC `mark_financial_report_viewed(p_report_id)` — grava `viewed_at` só do dono.

## 2. Motor de métricas (determinístico, fonte única)

Novo módulo `supabase/functions/_shared/reports/` espelhado em `src/lib/reports/` pelo `scripts/sync-finance-core.mjs`:

- `periods.ts`: janelas semana fechada (seg–dom), mês fechado, semana anterior, mesmo período relativo do mês anterior, próximos 7 dias — tudo em `America/Sao_Paulo`.
- `metricsWeekly.ts` / `metricsMonthly.ts`: montam todos os blocos pedidos (resumo, comparações, categorias, comerciantes, cartões, fluxo de caixa, dívidas, metas, investimentos/patrimônio, projeções; no mensal também composição, comportamento e previsão do mês seguinte). Todo número vem de `facts.ts` / `metrics.ts` / `finance_contract.v2` — sem recálculo paralelo, sem contar pagamento de fatura como despesa, separando gasto do período, fatura em formação, dívida atual e parcelas futuras.
- `healthScore.ts`: nota 0–10 determinística com breakdown por componente (resultado, poupança, risco de caixa, cartão, dívidas, patrimônio, metas, qualidade de registro), exibível ao usuário.
- `dataQuality.ts`: sinaliza sem categoria, fatura estimada, conciliação pendente, histórico insuficiente, comparação não confiável.
- `highlights.ts`: os ~25 detectores pedidos, cada um com tipo, título, corpo, evidências, números usados, período, prioridade, confiança, categoria, CTA/rota, dedup_key, versão e motivo de seleção. Dedup + cooldown reaproveitando a política de `tipPolicy.ts`.

## 3. IA com validação numérica

- Chamada única no gateway (`openai/gpt-5.6-sol`, `reasoning_effort: "none"`) que recebe apenas métricas e highlights já calculados e devolve introdução, explicações e conclusão.
- `numericGuard.ts`: extrai todo valor, percentual, data e quantidade do texto e exige correspondência nas evidências. Falha ⇒ texto determinístico, `text_source='deterministic'` e motivo registrado.

## 4. Geração e agendamento

- Nova Edge Function `financial-reports-generate`:
  - modos: `single` (user/tipo/período) e `cron` (lote).
  - pipeline idempotente: elegíveis → período → snapshot → métricas → comparações → candidatos → highlights → texto → validação → gravar → publicar → link → enfileirar comunicação → registrar entrega.
  - `request_id`, `idempotency_key`, `writeJobHeartbeat`, contagem processada/falhas/duração, resposta 207 em falha parcial, envelope `edge_error.v1`.
- Autenticação de cron via `x-cron-secret`, no mesmo padrão de `documents-cleanup`.
- `pg_cron` real: função `financial_reports_weekly_tick` (segunda 07:00 BRT = 10:00 UTC) e `financial_reports_monthly_tick` (dia 1, 07:00 BRT), ambas chamando a função com o secret. Jobs adicionados ao painel de Saúde operacional (`admin/operacao/Saude.tsx`) com alerta de atraso.

## 5. WhatsApp e notificação in-app

- Mensagem curta (semanal/mensal) com 1–2 highlights e CTA, tom do Nino, via `whatsapp-send` e templates em `messageTemplates.ts`; deep link `https://meunino.com.br/app/relatorios-inteligentes/<tipo>/<reportId>`.
- Entrega registrada em `financial_report_deliveries` com idempotência por `report_id+channel`, retry com backoff, `provider_message_id`, falha explícita (nunca sucesso falso), respeitando preferências e WhatsApp desconectado.
- Notificação in-app em `notifications` (novo tipo de relatório), badge de não lido no histórico, leitura registrada ao abrir.

## 6. Frontend

- Rotas autenticadas: `/app/relatorios-inteligentes` (histórico), `/app/relatorios-inteligentes/semanal/:reportId`, `/app/relatorios-inteligentes/mensal/:reportId`. Login redireciona preservando o `reportId`; relatório de outro usuário retorna “não encontrado”.
- Histórico: último relatório em destaque, listas semanal/mensal, período, status, indicadores-chave, filtros por tipo e período, marcador de não lido; acesso a partir de Relatórios e do menu Mais.
- Página do relatório: componentes novos em `src/components/relatorios-inteligentes/` (Hero, HealthScoreCard com explicação, KPIs, comparativos, categorias, highlights do Nino, cartões, compromissos, metas/patrimônio, evolução mensal, previsão, plano recomendado, rodapé de geração) usando os tokens informados, Recharts, mobile-first.
- Estados: carregando, gerando, disponível, não lido, sem dados, dados insuficientes, falha parcial, falha de geração, relatório antigo, baixa qualidade, WhatsApp não conectado — sempre com copy amigável em pt-BR.
- Impressão: botão “Salvar como PDF” + CSS `@media print` A4, sem menus, quebras controladas.

## 7. Testes e validação

- Suites novas: métricas semanais/mensais, regras de borda (semana/mês incompletos, fatura oficial vs estimada, parcelas futuras, pagamento de fatura, reembolso, estorno, duplicidade, sem categoria), health score, highlights (dedup, prioridade, confiança, CTA, cooldown), guard numérico da IA e fallback, idempotência/retry/falha parcial da geração, entrega WhatsApp (link, usuário e HTTP corretos), UI (histórico, filtros, vazios, não lido) e paridade financeira ao centavo com Home, Relatórios, Cartões, Nino app/WhatsApp, MCP e Pulso.
- Rodar `vitest`, testes de Edge Functions, typecheck, lint, build; disparar os ticks de cron manualmente para evidência; validar RLS tentando ler relatório de outro usuário.
- Ao final, apresento: arquivos alterados, migration, tabelas/funções/jobs criados, rotas, Edge Functions, nº de testes aprovados, evidência de cron ativo, de envio no WhatsApp, de link abrindo o relatório correto e limitações reais, se houver.

## 8. Fora de escopo

Nenhuma publicação em produção: implemento, testo e apresento para sua validação antes de publicar.
