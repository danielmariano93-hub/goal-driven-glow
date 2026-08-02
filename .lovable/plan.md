## Diagnóstico (verificado agora no código e no banco)

1. **Feedback de dica quebra por constraint** — `public.my_tip_feedback` grava `feedback='acted'|'dismissed'` e `status='resolved'`, mas o banco tem `user_insights_feedback_check CHECK (feedback IN ('useful','not_useful'))` e `user_insights_status_check CHECK (status IN ('active','dismissed','expired'))`. Qualquer clique em "útil" viola a constraint → erro. Causa raiz confirmada.
2. **Dois motores rodando juntos** — em `insights-generate/index.ts` o pool final é `[...deterministic, ...buildCandidates(facts)]` (motor antigo) e o front (`AssistantTipCard.tsx`) ainda tem um terceiro motor local (`pickFallback` / `buildLocalCandidates` de `src/lib/insights/fallbacks.ts`), exibido sempre que não há insight do servidor.
3. **Detectores sem dados** — `cashflow_forecast` exige `projected_balance` e `availableToday`, que não são passados no call site (linhas 358-382); os demais campos chegam.
4. **Cron/heartbeats** — `cron.job` tem `documents-cleanup-6h`, mas o comando envia apenas `apikey` anon, enquanto a função exige `Bearer service_role` ou `x-internal-secret` → 401, e por isso `job_heartbeats` não tem nenhuma linha `documents-cleanup`. **`whatsapp-ack-watchdog` não tem job algum agendado.** Heartbeats existentes hoje: `split-reminders-dispatch`, `whatsapp-send`, `insights-generate`, agregados de produto.
5. **Ajuste de fatura** — `Cartoes.tsx` expõe "Fechar conciliação com ajuste" com justificativa livre de 3 caracteres, sem motivo estruturado nem evidência.

## O que será implementado (uma única entrega)

### A. Ajuste de fatura sob prova contábil
- Migration: `force_reconcile_credit_card_statement` passa a exigir `p_reason_code` (`pagamento_nao_extraido`, `credito_nao_extraido`, `encargo_nao_extraido`, `arredondamento_operadora`, `divergencia_operadora`), justificativa de 20+ caracteres e `p_evidence` (referência do documento/linha da fatura). Recusa (a) diferença acima de 2% do total oficial sem `divergencia_operadora`, (b) faturas já pagas, (c) uso repetido no mesmo cartão em 90 dias sem novo `document_import_id`. Trilha completa em auditoria.
- UI (`Cartoes.tsx`): o botão deixa de ser primário — fica atrás de "Não consegui fechar" com o caminho recomendado ("Adicionar pagamento/crédito") em destaque. O formulário passa a pedir motivo (select), evidência e justificativa longa, com contador e bloqueio até tudo preenchido. Mensagem clara de que ajuste é exceção auditada.

### B. Motor único de insights + card em carrossel
- Migration: alinhar as constraints de `user_insights` (`feedback` aceita `useful|not_useful|dismissed|acted`; `status` aceita `active|dismissed|expired|resolved`) e ampliar `user_insights_type_check` para os tipos do `insights_catalog.v1`. Corrige o erro do botão "útil".
- `insights-generate`: remover `buildCandidates(facts)` do pool (motor antigo desligado), passar `availableToday` e `projectedBalance` aos detectores e devolver **lote** de insights (até 5) em vez de um só, cada um com `detector`, `family`, `dedup_key` e `evidence`.
- Front: `src/lib/insights/fallbacks.ts` deixa de gerar dicas (mantém apenas `CTA_ROUTE_RX` e tipos); `AssistantTipCard.tsx` passa a ler exclusivamente `user_insights`.
- Novo card em **carrossel** (swipe horizontal com scroll-snap, setas no desktop, indicadores de posição), micro-destaque discreto: faixa de cor por família, ícone Phosphor, badge "Novo" e animação suave de entrada. Cada slide tem "Útil" / "Não agora" e CTA. Ao esgotar os slides, estado final: "Você já viu todas as dicas de hoje" com data de próxima checagem, reaparecendo apenas quando surgirem novos dados/insights.

### C. Cron e heartbeats comprovados
- Recriar `documents-cleanup-6h` enviando `x-internal-secret` a partir do Vault (mesmo padrão já usado por `agent-proactive-hourly`) e criar `whatsapp-ack-watchdog-10m` (`*/10 * * * *`).
- Garantir heartbeat de sucesso **e** falha: as duas funções já têm `writeJobHeartbeat` no caminho de erro; adicionar heartbeat também quando a autorização falha e semear as linhas `documents-cleanup` e `whatsapp-ack-watchdog` em `job_heartbeats` para o painel de Saúde mostrar "Sem execução comprovada" enquanto não rodarem.
- Após aplicar, disparar cada função uma vez e comprovar as linhas em `job_heartbeats` (evidência no fechamento).

### D. Validação ponta a ponta
- Novo teste `src/test/finance-single-source-e2e.test.ts`: mesma base sintética alimentando Home, Relatórios, Cartões, snapshot do Nino, MCP (`monthly-summary`, `financial-position`) e Pulso, exigindo igualdade de dívida de cartão, disponível, receita/despesa do mês e projeção.
- Novo teste `src/test/journeys-e2e.test.ts`: pagamento de dívida, ocorrência de recorrência, Divisão do Rolê (criação → lembrete → quitação), meta conjunta (convite → aceite → contribuição), gamificação (XP/desafio) e documento pelo Assessor (ingestão → revisão → contabilização), validando invalidação de cache e efeito no snapshot.
- Teste de catálogo estendido: todo detector com `requires` precisa receber os campos correspondentes no call site (falha se algum sinal ficar sem alimentação).

## Detalhes técnicos
- Migrations: 1) constraints de `user_insights`; 2) `force_reconcile_credit_card_statement` com motivo/evidência + limites; 3) recriação dos jobs de cron (com segredo do Vault, sem chave em código).
- Edge Functions a implantar: `insights-generate`, `documents-cleanup`, `whatsapp-ack-watchdog`.
- Frontend: `AssistantTipCard.tsx` (carrossel), `src/lib/insights/fallbacks.ts` (poda), `Cartoes.tsx` (ajuste restrito), `src/lib/nino/client.ts` (feedback em lote).
- Publicação em produção somente com sua autorização explícita, após os testes verdes.
