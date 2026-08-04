# Plano único e fechado — Antecipação real, Participante com comprovante, Categorização e evidências

## 1. Diagnóstico do estado real (verificado agora)

Preservado (não será refeito): Home/contrato financeiro v5 publicado, separação ritmo atual/típico, exclusão de fixas do variável, fatura sem dupla contagem, campos legados deprecados com teste de guarda, suíte verde, rollout de antecipação restrito ao Daniel (dry run), 7 itens do catálogo ativos, contrato `both` com duas pernas, aba Antecipações com motivos de bloqueio.

Confirmado por leitura de código e consultas ao banco:

- `supabase/functions/_shared/anticipation/patterns.ts` implementa detectores de dia/fim de semana/fase do mês/ciclo de cartão/recorrência/gastos pequenos. **Não há bloco de descoberta para `upcoming_cash_pressure`** (grep só encontra o tipo em contratos/catálogo).
- `anticipation_outcomes` existe com as colunas necessárias (predicted/actual/baseline/outcome/feedback/confidence_delta) e está **vazia**; não existe função/cron de avaliação.
- `cron.job` não é legível pelo papel do sandbox — a conferência de agendamentos será feita via RPC/admin na execução.
- `inbound_messages` tem apenas 10 colunas básicas (`provider`, `provider_message_id`, `from_phone`, `to_phone`, `body`, `received_at`, `raw_hash`, `processed_at`, `ignored_reason`): **não há persistência de mídia, contexto, intenção ou resultado**.
- `whatsapp-webhook/index.ts`: o bloco de participante externo (linhas ~358-394) responde e faz `return` **antes** do pipeline de mídia (linha ~436). Uma imagem do participante nunca é baixada/analisada; a melhoria atual é só textual (`hasAttachment`).
- `notification_preferences` já tem `anticipation_enabled`, `anticipation_whatsapp`, `anticipation_kinds`, `muted_pattern_ids`, `quiet_start/quiet_end/quiet_behavior`, `max_proactive_per_day/week`, `timezone`. Falta apenas granularidade por família de padrão e UI.
- Categorização: `_shared/categorization/pipeline.ts` já tem explícito → alias → fuzzy alias → histórico → regra, com thresholds e `shouldAutoApply`. Faltam: casos-alvo garantidos por teste, herança de categoria em reembolso, métricas de cobertura e backfill auditável. Hoje 18 de 427 transações sem categoria.
- `shared_expense_participants.status` usa hoje `pending/notified/paid`; os estados de comprovante não existem.

## 2. Causas raiz

1. Detector de pressão de caixa nunca foi escrito (só o tipo foi cadastrado).
2. Zero oportunidades porque nenhum padrão passa os gates e nenhum detector determinístico (pressão de caixa) — que não depende de amostra histórica — existe.
3. Sem avaliador de outcome, a confiança nunca evolui.
4. Participante externo tem retorno antecipado no webhook, antes de identificar e processar mídia.
5. `inbound_messages` não guarda mídia/contexto, então não há como correlacionar “já paguei” + imagem nem garantir idempotência por mensagem.

## 3. Entregas

### A. Detector `upcoming_cash_pressure` (determinístico)
Novo módulo `_shared/anticipation/cashPressure.ts` + integração em `patterns.ts`/`runner.ts`.

- Entradas: saldo disponível atual (via `finance-core/facts.ts`, fonte única), compromissos **confirmados** nos horizontes 7/14/30 dias: recorrências com ocorrência planejada, faturas com vencimento na janela, parcelas, amortizações de dívida, despesas `planned`.
- Deduplicação obrigatória: fatura x pagamento de fatura planejado x parcela do mesmo cartão contam uma vez (reusa a regra já aplicada em `computeAvailableUntil`).
- Excluídos como entrada: metas, salário presumido, receita apenas planejada sem evidência, transferências internas, resgates não realizados. Só entram entradas confirmadas (recorrência de renda com histórico ≥3 ocorrências e data na janela).
- Padrão gerado: `pattern_key = cash_pressure:<horizonte>`, `pattern_value = compromissos`, `baseline_value = disponível`, `absolute_delta = compromissos − disponível`, confiança = qualidade dos dados (cobertura de categorização + completude de contas), `hit_rate` = 1 quando a diferença é factual.
- Thresholds: `min_absolute_delta` R$ 150, `min_confidence` 0,6, `min_coverage` 0,7, janela 72 h, lead time 48 h, cooldown 7 dias por horizonte, `stale_policy = recompute_before_send`. Escalação a WhatsApp só em severidade `critical` (déficit ≥ 20% do disponível) e com todos os gates de consentimento.
- Mensagem auditável: “Nos próximos 7 dias você tem R$ X em compromissos confirmados e R$ Y disponíveis.” + evidência item a item.

### B. Oportunidades e canais ponta a ponta
- `runner.ts`: candidatos permanecem visíveis com `block_reasons`; validados geram `anticipation_opportunities` com `eligible_from`, `optimal_send_at` (quiet hours + hora habitual) e `window_end`; revalidação via `stillValid` antes do envio; expiradas aplicam `stale_policy`.
- Dry run: cria oportunidade com `dry_run = true` e entrega `app` simulada visível; nunca enfileira WhatsApp.
- `both`: duas linhas em `communication_deliveries` com o mesmo `logical_dedup_key`; falha em uma perna não remove a outra (try/catch por perna, status por perna).
- Frequência/fadiga contam uma comunicação lógica.
- Superfícies no app: card na Home (reusa `AssistantTipCard` com origem antecipação), aba Antecipações, `Notificacoes.tsx` e `ProactiveAlertDetail.tsx`.
- Teste controlado: usuário fixture (`is_test = true`) com fatos comportamentais sintéticos + faturas/recorrências sintéticas para produzir 1 oportunidade real de `upcoming_cash_pressure` e 1 de padrão semanal, sem tocar nos dados do Daniel e sem baixar thresholds.

### C. Consentimento e preferências
Migration:
- Colunas em `notification_preferences`: `anticipation_cash_pressure`, `anticipation_card_cycle`, `anticipation_weekday`, `anticipation_weekend`, `anticipation_recurring` (bool, default true) — `anticipation_kinds` continua como filtro fino.
- Função `public.anticipation_channel_allowed(user_id, kind, severity)` centralizando: vínculo WhatsApp ativo, `anticipation_enabled`, `anticipation_whatsapp`, tipo autorizado, canal do catálogo, confiança/impacto/utilidade mínimos, quiet hours, janela válida, cooldown e fadiga.
- UI: seção “Antecipações” em `Perfil.tsx`/notificações com os toggles, quiet hours, frequência, “manter só no app” e silenciar padrão específico (`muted_pattern_ids`).

### D. Outcome e aprendizado
- Novo módulo `_shared/anticipation/outcomes.ts` + estágio `outcome` na Edge Function `anticipation-tick` e cron `anticipation-outcome-hourly`.
- Avalia após `window_end`: valor real observado nos fatos, comparação com baseline e previsão, classificação (`confirmed`, `partial`, `refuted`, `inconclusive`), `confidence_delta` limitado a ±0,05 por evento (evita distorção por evento único), média móvel sobre ≥3 outcomes para promover/enfraquecer/expirar padrão; registra `interacted`/`acted`/`user_feedback`. Evidência guarda que a relação é correlacional.

### E. Participante externo: reordenação do webhook e pipeline de comprovante
Reordenar `whatsapp-webhook/index.ts` para: validar → classificar → persistir inbound (com mídia) → deduplicar → detectar mídia → identificar remetente → recuperar contexto → localizar participante e rolê ativo → processar mídia/texto → executar ações → responder com base no resultado real → marcar `processing_status`.

Novo `_shared/split/participantPipeline.ts`:
- baixa mídia via `wahaMedia.ts`, grava no bucket `documents` (path por participante), hash para idempotência;
- classifica documento e extrai valor/data/pagador/recebedor via `assistant-ingest-document` (modo comprovante);
- compara com valor pendente e rolê em contexto, atribui confiança;
- registra `shared_expense_events` `payment_reported` + evidência;
- pausa lembretes futuros (`reminder_jobs` → `skipped` com motivo);
- cria notificação real para o dono (app + WhatsApp conforme preferência) e só então afirma “avisei o dono”;
- resposta ao participante: alta confiança → “comprovante recebido e encaminhado para confirmação”; baixa confiança → pede confirmação honestamente. Nunca marca como pago por imagem.
- Imagem sem legenda nunca vira body vazio: `body` fica nulo e o roteamento usa `message_type`.

### F. Contexto conversacional do participante
Migration: tabela `participant_contexts` (`phone_e164`, `participant_id`, `shared_expense_id`, `conversation_id`, `last_intent`, `pending_action`, `expected_input`, `last_user_message_at`, `context_expires_at` default now()+24h, `metadata`, `last_action_result`), única por telefone+rolê, RLS service-role + dono do rolê. Encerrado após confirmação/rejeição; expira por tempo; nunca mistura participantes ou rolês; funciona nas duas ordens (texto→mídia e mídia→texto).

### G. Persistência de mídia e correlação
Migration em `inbound_messages`: `message_type`, `media_type`, `mime_type`, `filename`, `provider_media_id`, `storage_path`, `media_hash`, `caption`, `download_status`, `analysis_status`, `extraction_result` (jsonb), `extraction_confidence`, `participant_id`, `shared_expense_id`, `conversation_id`, `intent`, `context_type`, `context_id`, `action_result` (jsonb), `processing_status`, `processed_at`, `failure_reason`.
Em `outbound_messages`: `inbound_message_id`, `participant_id`, `shared_expense_id`, `intent`, garantindo `idempotency_key = split-support:<inbound_message_id>` com índice único — reentrega do WAHA não gera nova resposta, evento, notificação ou pause.

### H. Estados de pagamento e fluxo do dono
- Novos valores no status de participante: `payment_reported`, `awaiting_owner_confirmation`, `paid_confirmed`, `payment_rejected`, `disputed` (mantendo `pending/notified/paid` existentes; mapeamento de exibição em `src/lib/copy`).
- RPCs `split_confirm_reported_payment(participant_id)` e `split_reject_reported_payment(participant_id, reason)` — atualizam participante/rolê só após decisão do dono, retomam lembretes na rejeição conforme política e mantêm trilha em `shared_expense_events` + `split_link_audit`.
- UI em `DivisaoDoRoleDetalhe.tsx`: bloco “Comprovante recebido” com evidência, valor extraído, confiança e botões Confirmar/Rejeitar; notificação clicável em `Notificacoes.tsx`.

### I. Categorização
- Ordem final garantida: regra pessoal > histórico individual > alias canônico > regra global segura > semântica > IA só em ambiguidade > revisão em baixa confiança.
- Reembolso herda categoria da transação de origem (`refund_of` / correlação por merchant+valor).
- Normalização canônica de comerciante consolidando aliases duplicados (`merchant_aliases`).
- Backfill auditável: só preenche `category_id` nulo ou `category_source = 'legacy'`, nunca altera valor/data/conta; grava antes/depois em auditoria; verificação de invariância de saldos antes/depois.
- Métricas diárias de cobertura/precisão em `categorization_metrics_daily` e exposição no Admin.
- Gate de qualidade: antecipação usa só categorias acima do mínimo e a UI mostra quando a qualidade está abaixo.

## 4. Migrations (ordem)
1. `inbound_messages`/`outbound_messages` — colunas de mídia, correlação, idempotência (+ índices).
2. `participant_contexts` — tabela, GRANTs, RLS, trigger `updated_at`.
3. Estados de pagamento do participante + RPCs de confirmação/rejeição.
4. `notification_preferences` — toggles por família + `anticipation_channel_allowed`.
5. Config do detector `upcoming_cash_pressure` em `anticipation_detector_config` (ativo, thresholds acima).
6. Crons: `anticipation-outcome-hourly` (novo) + revisão dos existentes de fatos e dispatch.
7. Backfill de categorização (script auditável, transacional).

## 5. Edge Functions a publicar
`whatsapp-webhook` (reordenação + mídia do participante), `anticipation-tick` (estágio outcome), `assistant-ingest-document` (modo comprovante), `split-reminders-dispatch-v2` (pausa por `payment_reported`), `whatsapp-send` se necessário para notificação do dono. Compartilhados afetados: `_shared/anticipation/*`, `_shared/split/participantPipeline.ts`, `_shared/messaging/wahaMedia.ts`, `_shared/categorization/*`, `_shared/finance-core` (sincronizado por `scripts/sync-finance-core.mjs`).

## 6. Testes
Antecipação: pressão de caixa em cenário real; fora do rollout não gera; dry run não envia WhatsApp; candidato mostra motivo; validado cria oportunidade; app-only fica no app; `both` cria duas pernas; sem consentimento bloqueia WhatsApp; quiet hours bloqueia/reagenda; cooldown; janela expirada; revalidação; falha de canal isolada; dedup lógico; outcome confirma/enfraquece.
Participante: “já paguei” + imagem; imagem sem legenda; mídia antes do texto; imagem não relacionada; PDF; comprovante ilegível; valor compatível/divergente; pagador divergente; reentrega do webhook; contexto expirado; múltiplos rolês; dono notificado; lembretes pausados; confirmação; rejeição; retomada; correlação inbound/outbound; nenhuma afirmação sem execução.
Categorização: Autopass→Transporte, farmácia→Saúde, mercado→Mercado, restaurante→Alimentação, festival→Lazer, alias antigo, comerciante duplicado, reembolso herdando, baixa confiança em revisão, backfill sem alterar totais.
Regressão: contrato v5 na Home, nenhum uso de campos legados, fatura sem duplicar compromisso, compra no cartão sem duplicar despesa, aplicação/resgate fora de consumo/receita, suíte existente (989+) verde.

## 7. Ordem exata de execução (uma rodada)
1. Código (shared, Edge Functions, UI). 2. Migrations 1→6. 3. Backfill de categorização. 4. Suíte completa + novos testes. 5. Deploy das Edge Functions. 6. Criação/correção dos crons. 7. Cenário controlado no usuário fixture para gerar oportunidade e outcome. 8. Publicação do app. 9. Validação no domínio real. 10. Validação de banco (contagens antes/depois). 11. Validação de WhatsApp (bloqueio sem consentimento, duas pernas em `both`). 12. Relatório final com evidências.

## 8. Rollout e rollback
Rollout mantém Daniel em dry run; fixture isolado para validação; WhatsApp real só depois das evidências e com sua autorização. Rollback: `anticipation_enabled = false` desliga o motor sem afetar finanças; toggles de preferência desligam canais; migrations são aditivas (colunas novas e tabela nova), portanto reversíveis por `DROP`/default sem perda de dados financeiros; o webhook mantém o caminho textual antigo atrás de flag `participant_media_pipeline`.

## 9. Evidências finais
Commit final; lista de migrations aplicadas; versões publicadas das Edge Functions; crons ativos; contagens de fatos/padrões/oportunidades/outcomes antes e depois; oportunidade simulada no fixture; duas pernas de `both`; bloqueio de WhatsApp sem consentimento; teste ponta a ponta de participante com texto + comprovante (mídia registrada, contexto recuperado, `payment_reported`, lembretes pausados, notificação do dono criada, confirmação/rejeição processada, sem duplicidade); casos de categorização validados; suíte completa; app publicado; domínio servindo o novo build.
