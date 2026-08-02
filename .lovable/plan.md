
# Plano único — Confiabilidade Financeira Definitiva do Meu Nino

Tudo abaixo entra em UMA implantação (1 migration + código app/edge + testes + documentação). Nada será publicado em produção sem sua autorização explícita.

## Diagnóstico verificado agora (somente leitura)

Consultei o banco e o código publicado. Estes são fatos confirmados, não hipóteses:

1. **Existe uma única fatura no banco**: competência `2026-08-01`, `stated_total = reconciled_total = paid_amount = 4.636,08`, `outstanding = 0`, status `paid`.
2. **Todas as 41 transações de cartão estão com `competence_date = 2026-08-01`**, inclusive compras de junho e a compra de **26/07 (541,23)** que, pelo ciclo real (fechamento 25), pertence à competência de setembro. Ou seja: o campo de competência foi carimbado em bloco na importação e não segue `cycleFor()`.
3. **Existem três verdades paralelas de cartão convivendo**:
   - `transactions` (cartão): 5.689,71 na competência 08
   - `credit_card_installments`: 94 linhas, 13.927,52 no total; **2026-09: 1.297,07 · 2026-10: 668,25 · 2026-11: 551,29 · 2026-07 scheduled: 271,88**
   - `credit_card_statement_items`: 4.639,00 (contra `stated_total` 4.636,08)
4. **Origem provável do valor "em aberto" que aparece na Home e não aparece em Cartões**: as parcelas `scheduled` em competências **sem statement** entram no número agregado, enquanto a tela de Cartões lê apenas os statements (todos pagos → zero). O valor não vem de lançamento novo: vem de parcelas antigas de meses futuros nunca absorvidas por fatura. A conferência final do número exato (2.593,49) é o primeiro passo de execução.
5. **Ritmo típico vs gráfico**: os dias 30/07 (27,07) e 31/07 (4.934,06) **existem** no banco. O ritmo típico usa `typicalAmount` (sem fixas, parceladas e outliers de Tukey) e o gráfico da Home hoje plota essa série — por isso um dia com 4.934,06 desaparece visualmente. Precisa ser confirmado com um teste com os dados reais antes de mexer, mas a causa está na série exibida, não nos dados.
6. **Pendências de confiabilidade confirmadas no código**: `whatsapp-webhook` ainda responde `{ok:true, soft_error:"conversation_error"}` com HTTP 200; `whatsapp-ack-watchdog` só grava heartbeat no caminho felizardo; `queryKeys.ts` não tem `categories`, `credit_card_statements`, `credit_card_installments`, `debt_payments`, `recurring_occurrences`; `Cartoes.tsx`, `finance.ts` e `Recorrencias.tsx` ainda invalidam chaves à mão; a tela de Cartões mantém o botão "Fechar conciliação com ajuste" chamando `force_reconcile_credit_card_statement`.

**Resposta direta à sua pergunta**: sim — a falta de conciliação real é causa direta dos números não baterem. Enquanto a mesma dívida existe em três tabelas com regras diferentes, cada tela mostra um recorte distinto do mesmo fato.

---

## Bloco 1 — Fim do plug e reconciliação real (P0)

- **Migration única** `20260803_financial_truth_reconciliation.sql`:
  - Tabela `financial_reconciliation_audit` (statement, tipo de evento, motivo padronizado, evidência JSON, autor, timestamps) com GRANTs, RLS por `auth.uid()` e trigger de `updated_at`.
  - Colunas em `credit_card_statements`: `adjustment_reason_code`, `adjustment_evidence jsonb`, `requires_manual_review boolean default false`.
  - `force_reconcile_credit_card_statement` passa a **exigir** motivo do enum (`missing_document`, `duplicate_item`, `fx_rounding`, `previous_balance`, `refund_pending`) + evidência não vazia; sem isso retorna `manual_reconciliation_required`. Ajuste sem motivo deixa de ser possível.
  - Novo RPC `reconcile_card_competence(p_card_id, p_competence)` que: recalcula `competence_date` das transações de cartão pelo ciclo real do cartão, absorve `credit_card_installments` na fatura correspondente (`absorbed_by_statement_id`), reprocessa a diferença e grava a trilha.
  - **Correção de dados**: o ajuste de −1.052,17 da fatura 08/2026 é substituído pela reconciliação real (reclassificação de competência + absorção de parcelas). Se sobrar diferença legítima, ela fica visível como `requires_manual_review = true` — nunca zerada artificialmente.
- **Tela de Cartões**: o botão de "fechar com ajuste" passa a exigir motivo estruturado + evidência e exibe faixa de "revisão manual pendente". Fatura com diferença aberta mostra o número real, não zero.

## Bloco 2 — Fonte única de dívida de cartão em todas as telas

- `cardExposure.ts` ganha regra explícita e testada: parcela em competência **sem** statement conta como compromisso futuro; parcela absorvida por fatura fechada/paga nunca conta; nenhuma superfície soma `transactions` + `installments` do mesmo período.
- `HeroDisponivelCard`/`ParaPagarResumo` e `Cartoes.tsx` passam a consumir o **mesmo** `cardExposure` do snapshot `finance_contract.v2`, com rótulo `oficial` ou `estimado`.
- Teste com o dataset real reproduzindo o caso: Home e Cartões devem imprimir o mesmo número, e o total de parcelas futuras precisa ser rastreável linha a linha.

## Bloco 3 — Ritmo e gráfico coerentes

- A série da Home passa a expor as duas curvas com legenda explícita: **gasto do dia** (bruto) e **ritmo típico**, com marcação visual dos dias excluídos (fixa, parcelada, atípico) e tooltip explicando o motivo.
- Nenhum dia com movimento pode aparecer vazio: dias excluídos aparecem como barra hachurada com valor real.
- Teste de regressão com os dias 30 e 31/07 reais.

## Bloco 4 — Invalidação central de cache (P0)

- `queryKeys.ts` completo (`categories`, `credit_card_statements`, `credit_card_installments`, `credit_card_payments`, `debt_payments`, `recurring_rules`, `recurring_occurrences`, `statement-detail`, `home`).
- `invalidateFinancialQueries` vira **await único** (`Promise.all` de `invalidateQueries`) e única porta de entrada.
- Remoção de todas as invalidações manuais em `finance.ts`, `creditCards.ts`, `Cartoes.tsx`, `Recorrencias.tsx`, `commitMovement.ts` e `ReviewSheet.tsx`.
- Teste garantindo que toda mutação financeira chama a função central.

## Bloco 5 — Confiabilidade operacional (P0)

- `whatsapp-webhook`: falha parcial deixa de retornar sucesso. Passa a devolver HTTP 207 com `{ok:false, partial_success:true, queued_fallback:true, failed:[...]}` no envelope `edge_error.v1`, e registra incidente.
- `whatsapp-ack-watchdog`: `try/catch` externo gravando heartbeat com `last_ok=false` e `last_error_code` em qualquer exceção.
- Heartbeat garantido também para `product-events-prune`, e painel de Operações passa a marcar job **sem heartbeat** como "sem execução comprovada" em vez de silêncio.

## Bloco 6 — Insights: um único motor

- Divisão em `insights/contracts.ts`, `insights/catalog.ts`, `insights/detectors.ts`.
- Novos detectores: crescimento de categoria, anomalia de valor, ritmo financeiro, comerciante recorrente, assinaturas, dias sem registro, previsão de caixa, qualidade de dado, oportunidade de economia, próxima melhor ação, risco financeiro.
- Remoção do caminho legado de candidatos/fallbacks — passa a existir uma arquitetura só.
- `ResponseValidator`: todo número presente no texto da IA precisa existir na evidência; se não existir, a dica é descartada e o motivo registrado.

## Bloco 7 — Prova de paridade multicanal

- Teste E2E determinístico com um dataset fixo (o do caso real) comparando, para o mesmo usuário e período, os números de **Home, Relatórios, Nino no app, Nino no WhatsApp, MCP e Pulso**. Divergência de centavo quebra o build.
- Testes adicionais: reconciliação sem plug, erro parcial do webhook, heartbeat de falha, invalidação após mutação, catálogo completo de insights.

## Bloco 8 — Fechamento das jornadas pendentes

Revalidação E2E e correção do que aparecer: pagamento de dívida, recorrência, Divisão do Rolê, metas conjuntas, gamificação, documentos pelo Assessor.

---

## Detalhes técnicos

- Migration: 1 arquivo, idempotente, com GRANTs e RLS por tabela nova, sem `ALTER DATABASE`.
- Correção de dados de cartão feita via RPC auditada (não `UPDATE` solto), com registro em `financial_reconciliation_audit`.
- Paridade app × edge mantida por `scripts/sync-finance-core.mjs` (já em `prebuild`/`pretest`).
- Edge functions afetadas: `pulse-compute`, `insights-generate`, `whatsapp-webhook`, `whatsapp-ack-watchdog`, `mcp`.
- Validação antes de qualquer publicação: suíte completa, typecheck, build e conferência dos números da fatura 08/2026 no banco.

## Ordem de execução

1. Confirmar a origem exata do valor "em aberto" da Home (query de rastreio linha a linha).
2. Migration + RPC de reconciliação + correção auditada dos dados de cartão.
3. Fonte única de exposição de cartão nas telas + ritmo/gráfico.
4. Invalidação central + confiabilidade WhatsApp/jobs.
5. Motor único de insights.
6. Testes de paridade e jornadas.
7. Relatório final. **Publicação apenas com sua autorização.**
