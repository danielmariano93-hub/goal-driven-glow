# Nino Brain v2 — compreender, calcular, conversar

Evolução estrutural integrada do assessor (app + WhatsApp), preservando a verdade financeira já existente e reutilizando os motores determinísticos atuais.

## O que confirmei no código e nos dados antes de planejar

- `analyze_merchants` e `merchant_profile` (em `agent/engineTools.ts`) só aceitam `days` e montam a janela por `windowFor(days)` — não há `from`/`to`, nem `merchant`. É a causa direta do desalinhamento "motor 15/07–13/08 vs resposta 01/08–13/08".
- A normalização canônica de estabelecimento (`src/lib/engine/merchant.ts`, espelhada em `_shared/finance-core/merchant.ts`) descarta tokens puramente numéricos (`filter(!/^\d+$/)`) e exige `length >= 3`. Marcas como **99** desaparecem do ranking, mesmo com o gasto continuando na categoria.
- `interpretSemanticQuery` só reconhece `weekday_pattern`; qualquer outra pergunta cai no `CapabilityRouter`, que escolhe **uma** capability por mensagem — não existe planejamento de múltiplas tarefas nem herança de contexto de follow-up.
- Períodos: `analytics/periods.ts` tem apenas `todaySP`, `monthRange`, `shiftMonth`, `comparablePeriods`. Não há resolvedor semântico de "agosto", "últimos 90 dias", "mesmo período do mês passado".
- Aliases problemáticos confirmados em `merchant_aliases`: `pay` → Lazer (marcado como confirmado pelo usuário), `est` → Uber/Transporte, `celular` → Dívidas, `seguro do cartao` → **Assinaturas** (deveria ser Seguros), `pagseguro internet i p s a` → **Educação** (intermediador aprendido como verdade universal).

## Arquitetura alvo

```text
mensagem → ConversationOrchestrator → ContextResolver(FollowUp) → PeriodResolver
        → QueryPlanner(tasks) → tools/motores determinísticos
        → TruthValidator → ResponseContract → ReplyHumanizer/Persona → resposta
```

O `CapabilityRouter` continua existindo como classificador de primeira etapa, mas passa a ser consumido pelo orquestrador, não a ser o dono do significado.

## Fases da entrega (uma única entrega, sequência de implementação)

### Fase 1 — Compreensão (entender)
- `core/ConversationOrchestrator.ts`: produz um `TurnPlan` com intent, tasks[], entidades, categoria, merchant, período, comparação, formato e dependência de contexto (itens 2, 26).
- `core/FollowUpResolver.ts` + memória conversacional (`conversation_state`: current_topic, previous_intent, last_category, last_merchant, last_period, pending_action) separada dos fatos contábeis (itens 3, 35).
- `analytics/periodResolver.ts`: resolução determinística em pt-BR (hoje, ontem, semana passada, agosto, agosto inteiro, últimos 7/30/90 dias, mesmo período do mês passado, começo do mês). Tools passam a receber sempre `from`/`to` explícitos; a LLM nunca inventa datas (item 4).
- Roteamento de "evolução/tendência" deixa de ativar visualização sem pedido explícito de gráfico (item 25).

### Fase 2 — Verdade de estabelecimento e categoria
- `analyze_merchants`/`merchant_profile` passam a aceitar `from`, `to`, `category_id`, `merchant`, `limit`, mantendo `days` como atalho compatível (item 5).
- **Merchant Truth v2**: fonte canônica única com precedência alias → merchant_name → normalized_description → friendly → description → bank_description; marcas numéricas protegidas (`99`, `123`) via lista de known brands aplicada **antes** da remoção de tokens numéricos (itens 7, 8). Alteração feita em `src/lib/engine/merchant.ts` e propagada por `scripts/sync-finance-core.mjs` (sem segunda fonte de verdade).
- Consolidação de variações (`Autopass`, `Autopass S.A.`, `Autopass s.a*atm Tmob`, PIX/QRCODE) por núcleo de marca + evidência (item 9).
- **Coverage gate**: motor devolve `category_total`, `resolved_total`, `unresolved_total`, `coverage`; resposta nunca apresenta ranking parcial como completo (itens 10, 11). `share` calculado no motor.
- **Category Truth**: regra estrutural de sinal específico dominando o intermediador/prefixo genérico (resolve `PIX WHATS QRCODE 99 FOOD` → Alimentação sem regra ad-hoc), intermediadores (PagSeguro, Mercado Pago, PicPay) marcados como `pass-through` → categoria revisável em vez de aprendida (itens 13, 17).
- **Alias hygiene / governança**: score por confidence, specificity, qualidade mínima de token, origem, colisão; aliases genéricos (`pay`, `est`, `celular`) rebaixados e nunca impositivos; aprendizado permanente só com confirmação do usuário + merchant específico + classificação estável (itens 15, 16, 44). Migration corretiva idempotente: `seguro do cartao` → Seguros, `pagseguro…` desaprendido (itens 14, 17).

### Fase 3 — Verdade financeira e comportamento
- **Response Truth Validator** obrigatório antes de qualquer resposta financeira: período da tool = período citado, totais reconciliados, share conferido, cobertura declarada, nenhum número sem provenance no result (itens 6, 45, 51). Sobre o `ResponseValidator.ts` existente, sem novo motor.
- **Weekday engine** único (reutiliza `analytics/weekdayTruth.ts`/`weekdayPattern.ts`): retorno completo por dia (total, occurrences, active_weeks, média por ocorrência, mediana, share, outliers, confidence) e threshold progressivo insufficient/low/medium/high — confiança baixa passa a gerar resposta observacional, nunca recusa (itens 22, 23, 24, 31).
- **Movement kind truth** e **behavioral date** revisados/reforçados sobre `finance-core/facts.ts` (itens 20, 21). Refund Matcher v2 com score multi-sinal e `needs_review` quando ambíguo — nunca adivinha (item 18).

### Fase 4 — Conversar
- `NINO_PERSONA` separado das regras financeiras; camada conversacional que responde primeiro exatamente o que foi perguntado e só aprofunda quando útil (itens 12, 28, 29, 30).
- **Response Contracts** por intenção (merchant_distribution, category_distribution, transactions_list, period_comparison, financial_overview, weekday_behavior, merchant_profile) em vez de um formatter único (item 27).
- **Helpful fallback** e **acknowledgement contextual** por tipo de tarefa, com política de latência (<1,5s sem ack; >3s ack contextual) e garantia de **1 inbound → 1 resposta final**, sem erro genérico após sucesso (itens 31, 32, 33, 34).
- Zero vazamento de implementação interna fora de admin/debug (item 46).

### Fase 5 — Entrada multiformato
- Orquestrador de entrada oficial: texto único, texto em lote, JSON com array, imagem/print, PDF, CSV, OFX → extração estruturada → normalize → categorize → movement_kind → dedupe → review em lote (itens 36–41). N itens geram N drafts, nunca resumo financeiro nem 1 lançamento consolidado.
- Revisão em lote mostra novos/duplicados/ambíguos/ignorados com confirmar todos, confirmar só novos, editar, excluir, cancelar.
- UX do assessor no app: deixar visíveis as formas de envio e atalhos ("Registrar vários", "Enviar extrato", "Analisar gastos") sem poluir a interface (item 42).

### Fase 6 — Observabilidade, reprocessamento e testes
- Log por run: intent_detected/final, context_used, period_resolved, tasks_planned, tools_used, response_contract, truth_validation, fallback_reason, confidence, latency (item 47).
- Reprocessamento seguro/auditável após Merchant e Category Truth: não sobrescreve decisão explícita do usuário sem evidência, preserva histórico, sem duplicatas nem alteração de movimento financeiro (item 19).
- Suíte E2E com os 15 testes especificados + regressão dos fluxos atuais (lançamento, cartão, fatura, metas, divisão do rolê, investimentos, insights, Home, forecast, WhatsApp) (itens 48, 49).
- Limpeza de código morto das versões substituídas, sem criar `weekday_v2/v3` (itens 53, 54).

## Notas técnicas

- Motores permanecem em `src/lib/engine/*` com espelho gerado para `_shared/finance-core/*`; nenhum cálculo financeiro na LLM.
- Migrations novas, idempotentes, sem editar migrations antigas: correção de aliases, campos de governança de alias, estado conversacional.
- Performance: o planner escolhe apenas as tools necessárias por tarefa; nenhuma chamada em bloco.

## Entrega final
Relatório objetivo com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / RISCOS / ARQUIVOS / MIGRATIONS / TESTES EXECUTADOS, sem declarar conclusão parcial como concluída.
