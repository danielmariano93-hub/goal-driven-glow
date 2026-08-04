# Plano único e fechado — Verdade financeira na Home, Motor de Antecipação real, Participante com mídia e Categorização

## 1. Diagnóstico confirmado (com evidência lida agora)

**Parte 1 — números contraditórios na Home**

| Card | Componente | Valor exibido | Fórmula real | Período |
|---|---|---|---|---|
| "Seu ritmo … /dia" | `RitmoUnificadoCard` | R$ 223,74 | `spendingRhythm.typicalAverage` = (consumo elegível − fixas − atípicos) ÷ dias corridos | período **selecionado** (`PeriodPicker`) |
| "Ritmo atual …/dia" (subtítulo) | `PrevisaoFechamentoCard` | R$ 101,20 | `metrics.ts:529` `mtdExpense / daysElapsed` (inclui fixas) | **mês calendário** até hoje |

São duas fórmulas e dois períodos diferentes com o mesmo rótulo "ritmo". Não é bug de cache: `metrics.ts` calcula os dois no mesmo `computeFinancialSnapshot`.

| Valor | Origem | Natureza |
|---|---|---|
| −R$ 5.542,32 ("seu mês deve encerrar em") | `projectedMonthEndAvailable` (`metrics.ts:545`) = disponível hoje + entradas futuras − compromissos − **dívida total de cartão** − consumo projetado | saldo projetado |
| R$ 6.040,98 (mesma linha) | `projectedRemainingConsumption` = `mtdAvg × diasRestantes` | gasto projetado |

Dois conceitos distintos na mesma frase, sem separação. `projectedMonthEndAvailable` também subtrai a dívida **inteira** do cartão (inclui parcelas de meses futuros), o que exagera o negativo.

Motores paralelos confirmados: `src/lib/engine/*` (app) e `supabase/functions/_shared/finance-core/*` (espelho), mais `analytics/dailyAverage.ts`, `insights/detectors.ts`, `mcp` e `FinancialPlanner.ts` com médias próprias.

**Parte 2 — antecipação desligada**: `anticipation_detector_config` → 7 detectores com `active=false`; `financial_feature_flags` → **0 linhas** (default `use_anticipation_engine=false`, `dry_run=true`); `behavioral_transaction_facts/daily/cycle`, `behavioral_patterns`, `anticipation_opportunities`, `anticipation_outcomes` → **0 registros**. `Antecipacoes.tsx:86` mostra sucesso incondicional ("Padrões recalculados…") ignorando `no_active_detectors`.

**Parte 3 — participante**: em `whatsapp-webhook/index.ts` o bloco de participante externo (l. 358–392) responde e **retorna** antes do bloco de mídia (l. 429). Uma imagem de participante nunca chega ao pipeline de mídia; cai no texto genérico.

**Parte 4 — categorização**: 426 lançamentos, 409 com categoria (96%), 88 `merchant_aliases` — cobertura boa, porém sem normalização canônica de comerciante nem herança de categoria em reembolso.

## 2. Contrato financeiro canônico (`financial_snapshot_contract.v5`)

Fonte única em `src/lib/engine/snapshotContract.ts`, espelhada para `_shared/finance-core` pelo script de sync. Campos: `period_start`, `period_end`, `available_until`, `days_elapsed`, `days_remaining`, `realized_income`, `realized_expense`, `realized_consumption`, `current_daily_pace`, `typical_daily_pace`, `projected_variable_spending`, `upcoming_confirmed_commitments`, `projected_total_spending`, `projected_month_result`, `current_available_balance`, `confirmed_future_inflows`, `projected_end_balance`, `confidence`, `data_quality`, `formula_version`, `excluded_movements`, `provenance`.

Fórmulas finais:
- `realized_consumption`: consumo líquido do período; exclui transferências, aplicação, resgate, pagamento de fatura, principal de dívida, saldo inicial, ajuste de conciliação, planejado não realizado; considera estorno/reembolso e compra de cartão por competência (sem duplicar com o pagamento).
- `current_daily_pace` = `realized_consumption ÷ dias corridos do período até hoje` (dias sem gasto contam). Único rótulo "ritmo atual".
- `typical_daily_pace` = mediana aparada dos gastos diários da janela móvel de 90 dias, sem fixas e sem outliers. Rótulo "ritmo típico".
- `projected_variable_spending` = `blend(current_daily_pace, typical_daily_pace) × days_remaining`, com peso do ritmo atual crescendo com `days_elapsed` (mín. 7 dias para peso pleno).
- `projected_total_spending` = realizado + variável projetado + compromissos confirmados.
- `projected_end_balance` = saldo disponível + entradas futuras confirmadas − saídas futuras confirmadas − variável projetado − **apenas a fatura com vencimento dentro do mês** (não a dívida total).
- `projected_month_result` = receitas econômicas − despesas econômicas (nunca igual ao saldo).
- `confidence`: `insufficient` (<4 dias), `low` (<7), `medium` (<14), `high`.

## 3. Alterações por área

**Frontend**
- Novo `snapshotContract.ts` + `useFinancialSnapshot` passa a devolver o contrato; nenhum componente recalcula fórmula.
- `RitmoUnificadoCard`: título "Ritmo atual" com `current_daily_pace`; linha secundária "Ritmo típico" com `typical_daily_pace`; detalhes com fórmula, período, componentes, confiança e data de cálculo.
- `PrevisaoFechamentoCard`: dividido em quatro linhas explícitas — gasto realizado, gasto variável projetado, compromissos confirmados, **gasto projetado total** — e, em bloco separado, **saldo projetado no fim do mês**. Selo "Projeção preliminar: apenas N dias de dados" quando `confidence` for `insufficient`/`low`.
- `HeroDisponivelCard`, `DisponivelCard`, `AssistantTipCard`, Relatórios, Relatórios Inteligentes e Pulso passam a ler os mesmos campos.
- `Antecipacoes.tsx`: toast derivado do payload (`facts_created`, `patterns`, `blocked_reason`, `no_active_detectors`, erro de gravação) + seção "Por que ainda não há padrões" com fatos gerados, cobertura de categorização, detectores elegíveis/bloqueados e motivo.
- `invalidation.ts`: chaves de fatos comportamentais e do contrato adicionadas; invalidação após criar/editar/excluir/recategorizar/importar/conciliar/estornar/pagar fatura/dívida/aplicação/resgate.

**Backend / Edge Functions** (todas republicadas): `insights-generate`, `pulse-compute`, `financial-reports-generate`, `agent-chat`, `agent-run`, `mcp`, `anticipation-tick`, `whatsapp-webhook`, `assistant-ingest-document`, `assistant-review-actions`, `split-reminders-dispatch-v2`.
- `finance-core` sincronizado com o app (`scripts/sync-finance-core.mjs`); `analytics/dailyAverage`, `insights/detectors`, `FinancialPlanner`, `mcp/financial-position` e `monthly-summary` passam a consumir o contrato, sem média própria.
- `upcoming_cash_pressure` implementado de fato: saldo disponível × compromissos confirmados de 7 dias (fatura no vencimento, recorrências, parcelas, dívidas), descontando duplicidades, pagamentos já feitos e transferências internas; entradas só contam com evidência confirmada.
- Contrato de canais corrigido: `channel_target=both` gera `channel_ready=both`, com uma única comunicação lógica (`logical_dedup_key`) para frequência e dedup; fonte = catálogo + preferência + consentimento.
- Avaliador de outcome: novo estágio `outcome` no `anticipation-tick` compara valor real vs baseline após a janela, grava `anticipation_outcomes`, ajusta confiança e enfraquece padrões ruins.
- **Webhook reordenado**: validar evento → classificar tipo → persistir payload → deduplicar → **identificar mídia** → identificar remetente/contexto → só então rotear texto. Novo pipeline de participante externo com mídia: identifica participante → rolê ativo → conversa recente → baixa e armazena mídia → classifica → extrai → compara com valor pendente → grava `payment_reported` → pausa lembretes → notifica dono → responde. Respostas geradas a partir do resultado real das ações (nunca "avisei" sem entrega criada). Idempotência `split-support:<inbound_message_id>`.
- Categorização: pipeline canônico único (regra pessoal → histórico → regra global segura → semântica → IA só em ambiguidade → revisão em baixa confiança), normalização de comerciante, resolução de conflito, reembolso herda categoria da origem, métricas de precisão.

**Banco (migrations novas)**
1. `anticipation_rollout.sql` — colunas `anticipation_rollout_pct`, `anticipation_rollout_user_ids`, `anticipation_app_enabled` em `financial_feature_flags`; linha de rollout para o usuário de teste (`use_anticipation_engine=true`, `anticipation_dry_run=true`, WhatsApp **desligado**); ativação dos 7 detectores restrita ao rollout.
2. `anticipation_outcomes_engine.sql` — RPCs de outcome, índices e RLS; RPC `anticipation_diagnostics(user_id)` para a aba Antecipações.
3. `split_participant_context.sql` — estado conversacional de participante externo (`phone_e164`, `participant_id`, `shared_expense_id`, `last_intent`, `pending_action`, `expected_input`, `last_user_message_at`, `context_expires_at`, `metadata`), campos de mídia em `inbound_messages` (`message_type`, `media_type`, `mime`, `filename`, `provider_media_id`, `storage_path`, `media_hash`, `caption`, `download_status`, `analysis_status`, `extraction_result`, `extraction_confidence`), estados de pagamento (`pending`, `payment_reported`, `awaiting_owner_confirmation`, `paid_confirmed`, `payment_rejected`, `disputed`).
4. `categorization_canonical.sql` — normalização de aliases, unicidade de comerciante, herança de reembolso, métricas diárias.
5. `communication_channel_contract.sql` — correção de `channel_ready` e templates distintos app/WhatsApp para os 7 tipos, ativos só para rollout.

**Backfills** (idempotentes, paginados, retomáveis, auditáveis, sem enviar mensagem e sem tocar em saldo): fatos comportamentais de 13 meses do usuário de rollout; normalização de aliases; herança de categoria em reembolsos; recomputo de relatórios/Pulso para `formula_version` v5. Rollback por checkpoint em `financial_backfill_checkpoints`.

**Crons**: recálculo noturno de fatos/padrões; dispatch a cada 15 min; **novo** cron de outcome 1×/dia; reconciliação de lembretes mantida.

**Admin/observabilidade**: painel financeiro com `formula_version`, fonte por card, período, componentes, divergência entre superfícies, idade de cache e erro; painel de antecipação com fatos/qualidade/elegíveis/candidatos/validados/oportunidades/dispatch/outcome; painel WhatsApp com inbound, mídia, contexto, ação, outbound, ACK, duplicidade; painel de categorização com cobertura, confiança, aliases, correções, conflitos e sem categoria.

## 4. Testes
Ritmo e projeção (20 casos: mês de 4 dias, mês completo, dia sem gasto, aluguel no início, pagamento de fatura, compra no cartão, estorno, reembolso, aplicação, resgate, transferência, dívida, parcela futura, receita confirmada vs planejada, compromisso futuro, múltiplas contas e cartões, timezone, edição retroativa) + invariantes (mesmo conceito = mesmo valor em todas as telas; gasto ≠ saldo; resultado ≠ caixa; fatura não duplica; resgate não é receita; aplicação não é consumo; principal de dívida não é despesa). Antecipação (14 casos). Participante e mídia (12 casos). Categorização (9 casos, incluindo Autopass → Transporte e backfill sem alterar saldo).

## 5. Ordem de execução e validação
1. Contrato + motor + testes unitários. 2. Sync `finance-core`. 3. Migrations 1–5. 4. Backfills com checkpoint. 5. Frontend (Home, Relatórios, Pulso, Antecipações, Admin). 6. Edge Functions publicadas. 7. Crons. 8. Publicação do app. 9. Validação em produção: contagens antes/depois das tabelas comportamentais, valor de ritmo idêntico nas telas, composição das projeções abertas, teste real de participante com "já paguei" + imagem, WhatsApp de antecipação permanecendo bloqueado. Rollback: flags de rollout desligadas + reversão por checkpoint, sem tocar em transações.
