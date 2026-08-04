# Home publicada + Motor de Antecipação operacional

## Diagnóstico verificado (evidências desta investigação)

### 1. Por que meunino.com.br mostra a versão antiga

Não é cache de navegador. O build publicado é anterior ao commit `feb30ef`.

- HEAD local: `feb30ef Aplicou projeção canônica v5`.
- HTML servido por `meunino.com.br` referencia `assets/index-BVDGKYI1.js`.
- `goal-driven-glow.lovable.app` (site publicado) referencia **o mesmo** `index-BVDGKYI1.js` → domínio e publicação estão no mesmo build; o domínio não está atrasado em relação à publicação.
- O chunk da Home servido em produção é `assets/Index-BOtQO31V.js`. Nele existem as strings **antigas**:
  - `Seu ritmo` (2 ocorrências)
  - `deve encerrar com` (1)
  - e **não** existem as strings novas do HEAD: `Já gastei até hoje` (0), `Gasto variável ainda esperado` (0), `Total esperado do mês` (0).

Conclusão: o publish nunca rodou depois do commit v5. Fingerprint, CDN, service worker e DNS estão corretos — o artefato publicado simplesmente contém o código antigo. Correção: republicar o HEAD e comprovar por diff de strings no bundle servido pelo domínio.

### 2. Fonte única de verdade na Home

Já está correta no HEAD: `RitmoUnificadoCard` e `PrevisaoFechamentoCard` leem exclusivamente `projection.*`. Os campos legados (`monthToDateAverageConsumption`, `projectedRemainingConsumption`, `projectedMonthEndAvailable`, `currentAverageDailyConsumption`) só existem dentro de `src/lib/engine/metrics.ts` como saída de compatibilidade — nenhum componente os consome. Serão marcados como deprecados e cobertos por teste que proíbe uso em `src/components` e `src/pages`.

### 3. Matemática com dados reais (usuário Daniel `088920ce-…`)

Agosto/2026 confirmado no banco: despesas brutas `R$ 1.030,26`, entradas `R$ 869,18`, transferências `R$ 0,00`, 13 lançamentos. O reembolso de `R$ 135,31` está entre as linhas de agosto; o consumo líquido `894,95` e o ritmo `894,95 / 4 = 223,74/dia` serão validados por teste com os lançamentos reais e por leitura do snapshot.

### 4. Estado do Motor de Antecipação

- Fatos: `behavioral_transaction_facts` 376, `behavioral_daily_facts` 51, `behavioral_cycle_facts` 30.
- `behavioral_patterns`: 5, **todos** `status = candidate`.
- `anticipation_opportunities`: 0, `anticipation_outcomes`: 0.
- `anticipation_detector_config`: 7 detectores `active = true`.
- `agent_settings`: `anticipation_enabled = false`, `dry_run = true`, `rollout_pct = 0`, `rollout_user_ids = []`.
- `communication_catalog` family `anticipation`: 7 itens, **todos** `active = false`.

Motivo real de 0 oportunidades: `runner.ts:356` só constrói oportunidade para padrão `validated`/`active`, e nenhum padrão passa dos thresholds. Caso a caso:

| Padrão | valor | baseline | uplift | delta | conf. | bloqueio exato |
|---|---|---|---|---|---|---|
| month_phase `meio` | 173,50 | 57,73 | 200,5% | 115,77 | 0,76 | delta 115,77 < mínimo 120,00 (único critério faltando) |
| month_phase `fim` | 79,86 | 58,00 | 37,7% | 21,86 | 0,63 | delta < 120 e confiança < 0,65 |
| small_spend | 192,49 | 65,12 | 195,6% | 127,37 | 0,37 | confiança 0,37 < 0,60 e amostra 4 < 8 |
| weekend | 58,00 | 80,89 | −28,3% | −22,89 | 0,26 | gasta menos no fim de semana — não é risco |
| month_phase `inicio` | 3,45 | 80,96 | −95,7% | −77,51 | 0,41 | não é risco |

### 5. Riscos de dupla contagem na projeção

O gasto variável projetado usa ritmo típico histórico. Se o histórico contiver despesas fixas/recorrentes e a projeção somar `upcomingConfirmedCommitments`, a mesma despesa entra duas vezes. Idem para fatura de cartão contada em `cardDueThisMonth` e novamente como recorrência/planejada, e para compras de cartão contadas como consumo e novamente como saída de caixa.

## O que será implementado

### A. Publicação correta da Home (bloqueante)

1. Publicar o HEAD (`feb30ef` + ajustes desta rodada).
2. Baixar o HTML de `meunino.com.br`, extrair o novo `index-*.js` e o novo chunk `Index-*.js`.
3. Provar por grep no bundle servido pelo domínio: presença de `Já gastei até hoje`, `Gasto variável ainda esperado`, `Total esperado do mês`, `Ritmo típico`; ausência de `Seu ritmo` e `deve encerrar com`.
4. Comparar hashes antes/depois e confirmar `cache-control` do HTML.
5. Screenshot da Home renderizada no domínio como evidência.

### B. Blindagem da verdade financeira

- Anti-dupla-contagem no motor: o ritmo típico usado para projetar dias restantes passa a excluir explicitamente consumo fixo/recorrente, pagamento de fatura, parcelas e movimentos atípicos; `projectedVariableSpending` cobre somente a parcela variável. `upcomingConfirmedCommitments` exclui qualquer compromisso cuja competência já esteja em `cardDueThisMonth`.
- `cardDueThisMonth` restrito à fatura com vencimento no mês corrente.
- Campos legados marcados `@deprecated` + teste de guarda que falha se algum componente/página voltar a usá-los.
- Blocos da Home com nomes próprios: “Ritmo atual” / “Ritmo típico” / “Gasto projetado no mês” / “Saldo projetado no fim do mês”, com composição, janela, exclusões, confiança e versão da fórmula nos detalhes; aviso “Projeção preliminar” com menos de 7 dias de dados.

### C. Motor de Antecipação operacional (rollout controlado)

Migration:
- `agent_settings`: `anticipation_enabled = true`, `anticipation_dry_run = true`, `rollout_pct = 0`, `rollout_user_ids = ['088920ce-…']`.
- `communication_catalog` (family `anticipation`): novas colunas de contrato — `escalation_channels`, `whatsapp_eligibility`, `whatsapp_min_confidence`, `whatsapp_min_absolute_impact`, `whatsapp_min_utility`, `same_pattern_cooldown_days` — e ativação apenas dos tipos do rollout.
- `notification_preferences`: preferências por tipo de antecipação (pressão de caixa, cartão, dia da semana, recorrência), frequência e horário silencioso, reaproveitando `anticipation_kinds`.

Matriz de canais (implementada como dado, não como `severity` isolado):

| Tipo | default | escalável a WhatsApp | cooldown |
|---|---|---|---|
| upcoming_cash_pressure | app | sim | 48h |
| card_cycle_acceleration | app | sim (attention/critical) | 72h |
| weekday_spending_risk | app | sim (confiança + impacto altos) | mesmo padrão 14 dias |
| weekend_spending_risk | app | sim (confiança + impacto altos) | mesmo padrão 14 dias |
| month_phase_spending_risk | app | só combinado com pressão de caixa | 120h |
| small_spend_acceleration | app | nunca | 120h |
| expected_recurring_payment | app | só com valor/urgência/pressão | 72h |

Decisão de canal passa a considerar tipo, impacto absoluto, confiança, utilidade, urgência, janela, fadiga, preferência e consentimento.

Correção do contrato `both` (`runner.ts:534`): hoje `channel_target = "both"` vira `channel_ready = "whatsapp"` e o card do app é perdido. Passa a gerar **duas entregas** ligadas ao mesmo `logical_dedup_key`: uma app, uma WhatsApp; frequência conta uma comunicação lógica; falha de um canal não apaga o outro; status por entrega.

WhatsApp exige: vínculo ativo, `anticipation_whatsapp = true`, tipo autorizado, quiet hours, janela válida, revalidação antes do envio.

### D. Aba Antecipações honesta

- Painel de diagnóstico: fatos analisados, dias, período, cobertura/qualidade, detectores elegíveis, padrões em observação, validados, oportunidades agendadas, erros.
- Cada candidato mostra valor encontrado, baseline, uplift, threshold exigido, **motivo exato** de não validação e próximo passo. Ex.: “Encontramos um possível aumento de gastos no meio do mês. A diferença observada foi de R$ 115,77; o critério atual exige pelo menos R$ 120,00. O padrão continuará em observação.”
- Botão Atualizar sem sucesso genérico: “376 lançamentos e 51 dias analisados. 5 padrões em observação; nenhum atingiu todos os critérios para comunicação.” ou “1 padrão validado; próxima antecipação agendada para sexta às 8h.”
- Oportunidades simuladas (dry run) aparecem marcadas como simulação, com card na Home, notificação e página de detalhe.

### E. Testes

Financeiro: ritmo atual único; ritmo típico separado; `1.030,26 − 135,31 = 894,95`; `894,95 / 4 = 223,74`; 4 dias → confiança preliminar; reembolso deduzido; fatura não duplicada; recorrência não duplicada pelo ritmo variável; transferências/aplicações/resgates/pagamento de fatura excluídos; guarda contra campos legados.

Antecipação: candidato exibido com motivo; padrão validado gera oportunidade; dry run não envia; `both` gera app + WhatsApp; app-only permanece no app; escalation por elegibilidade; consentimento; quiet hours; cooldown de 14 dias no mesmo padrão; janela expirada; revalidação; sem duplicidade.

## Detalhes técnicos

- **Migrations**: rollout em `agent_settings`; contrato de canais em `communication_catalog` (com GRANTs preservados); preferências de antecipação em `notification_preferences`; RPC de diagnóstico de antecipação para a aba.
- **Edge Functions a implantar**: `anticipation-tick`, e as compartilhadas afetadas (`_shared/anticipation/runner.ts`, `opportunities.ts`, `patterns.ts`, `_shared/agent/core/CommunicationDispatcherV3.ts`, `NotificationDispatcher.ts`), além de `insights-generate` para consumir `snapshot.projection` v5. Espelho `_shared/finance-core` re-sincronizado por `scripts/sync-finance-core.mjs`.
- **Componentes**: `RitmoUnificadoCard`, `PrevisaoFechamentoCard`, `Antecipacoes` (diagnóstico + candidatos), card de antecipação na Home, detalhe da antecipação.
- **Validação final**: execução do tick real para Daniel em dry run, leitura das tabelas `behavioral_patterns` / `anticipation_opportunities` após a execução, e verificação do bundle servido por `meunino.com.br`.

## Fora de escopo

Liberar WhatsApp para toda a base, alterar identidade visual/marca, e ativar entrega real de WhatsApp sem consentimento explícito.
