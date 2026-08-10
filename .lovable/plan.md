# Verdade de Caixa Bancária — Saneamento auditável + Arquitetura anti-divergência

## 1. VEREDITO (validado contra main + produção)

Confirmado:
- Conta única ativa: `6c1cf814…5e0` "Banco Itau" / checking (usuário `088920ce…214`). Nenhuma outra conta ativa.
- `a1481e01…c7`: `statement`, `statement_closing_balance = 52.63`, `statement_balance_date = 2026-08-09`, `source_account_id = NULL`, `source_context_method = none`, `reason = ambiguous`, `status = partially_confirmed`.
- `11b6dcde…9f`: `statement`, sem closing balance, `source_account_id = NULL`, `ambiguous`, `partially_confirmed`.
- Ambos foram confirmados pela ação `invoice_atomic_confirmed` com `result.statement = null` (auditoria em `document_import_audit`). Semântica de fatura aplicada a extrato — confirmado.
- Último snapshot confirmado da conta ainda é **02/08 = 589,39**. Nenhum snapshot novo com 52,63.
- `transactions` **não possui** vínculo de estorno (`refund_of_transaction_id`/reversal) nem `superseded`/`duplicate_of`. Só `extracted_items` tem `duplicate_of`.
- `financial_daily_category_facts` agrupa por `t.category_id` do próprio lançamento (migration `20260724023000`), logo o estorno abate a categoria "Estornos", não Transporte.
- `linkRefunds()` existe em `_shared/import/dedupe.ts` e é usada só por `_shared/import/stage.ts`; `assistant-ingest-document` importa apenas `classifyBatch`/`fetchExistingCandidates` — o vínculo nunca roda no fluxo do documento.
- Estornos mal tipados existem: `49cba4dd` "Estorno IFood" 21,10 = `income/transaction`.
- Duplicidades purchase-date x posting-date confirmadas (mesmo valor, docs diferentes, posted 03/08): 99 33,00 (`bc7052de` doc 6e768b47 vs `038be068` doc 11b6dcde), 99 34,55 (`9d72b394` vs `4229162c`), 99 66,00 (`60037a2b` vs `83a790f3`), Uber 32,95 (`59b9fcae`) x item 24 de 11b6dcde. E manual x statement em 08–10/08: Souk4u 24,47 (`8fcb7eee` manual 08/08 vs `bcc2bc3e` import 10/08), Souk4u/Market4you 8,59 (`20f059b9` vs `796d15eb`), OXXO 19,58 (`b61715d0` vs `48a6cc20`), Autopass 5,40 (`e4ac3512`/`68899e8d` vs `7473f76b`).

Divergências que **não** se confirmam como descritas:
1. **Saldo atual do Nino não é −187,67 do banco.** Pela fórmula canônica (`computeAccountBalances`: âncora = último snapshot confirmado + movimentos com data de caixa posterior), o saldo hoje é **−399,15**. Contra 52,63 do banco a diferença é **−451,78**.
2. **Não existe snapshot de 31/07 = 923,85.** Os snapshots confirmados são 18/07 = 139,95, 20/07 = 39,97 e 02/08 = 589,39. O valor 923,85 não está em nenhuma fonte do banco de dados — é âncora externa não persistida.
3. **O Resgate CDB de 500,67 não é "não substituído": ele nunca virou lançamento.** O item `11b6dcde` idx 4 está `confirmed` com `transaction_id = NULL` e não existe nenhuma transaction de 500,67. O manual errado de 659,00 (`99d431ab`) está sozinho no ledger.
4. **Perda silenciosa de itens confirmados.** `invoice_atomic_confirmed` reportou `created_count = 20` e `16`, mas só existem 15 e 14 transactions. 7 itens ficaram `confirmed` sem ledger: 500,67 CDB; Uber 45,94 + EST 45,94; 99 28,75 + EST 28,75; Uber 21,94 + EST 21,94. Os pares de estorno se anulam (efeito zero), o CDB não: explica 500,67 dos 451,78.
5. **O extrato não cobre o período inteiro.** Linhas bancárias existem só para 03–07/08 e 10/08 (a1481e01/11b6dcde). Não há linhas de 01–02/08 nem 08–09/08, e o closing balance é datado 09/08 enquanto há postagens de 10/08. Com os dados atuais **não é possível provar aritmeticamente 923,85 → 52,63**: os itens não ignorados somam −849,88 (923,85 − 849,88 = 73,97; até 09/08 = 273,64). Por isso a ponte por dia é o **primeiro passo executável**, não uma afirmação deste plano.

## 2. CAUSA RAIZ

1. **Resolução de conta com ordem errada**: em `assistant-ingest-document` o degrau "extrato + 1 conta ativa" existe, mas só é alcançado se `statement.bank` não casar antes; nos dois uploads o bank não veio no metadata e ainda assim caiu em `ambiguous` — a persistência do resultado do resolver não ocorreu na reingestão em lote (docs de 02/08 com o mesmo bank resolveram 0.92; os de 10/08 ficaram `none`). Fail-open: documento seguiu sem conta.
2. **Um único caminho de confirmação (`invoice_atomic`) para dois contratos** (extrato x fatura). Sem `source_account_id` a etapa de statement é ignorada (`statement: null`): sem conciliação, sem snapshot, sem gate de divergência.
3. **Confirmação não atômica de fato**: itens marcados `confirmed` sem transaction criada, sem erro reportado (`ok: true`, `errors: []`).
4. **Dedupe textual e por data de documento**, sem identidade econômica (purchase_date x posted_at, merchant canônico, conta, método) — duplica evento único e ainda marca compras legítimas como suspeitas.
5. **Ausência de contrato de reversão**: sem `refund_of_transaction_id`, o netting é global e por categoria do próprio refund; despesa original permanece cheia na categoria e refunds mal tipados inflam renda.
6. **Saldo bancário não é fonte de verdade**: closing balance extraído não gera snapshot nem status de conciliação.

## 3. SANEAMENTO ATUAL (read-only agora; execução em P0)

Estratégia contábil: **nunca DELETE**. Para cada duplicata econômica, `status` passa a `superseded` + novas colunas `superseded_by`/`supersede_reason` + linha em tabela de auditoria `ledger_corrections` (quem, quando, evidência, valor). Registro manual errado é corrigido por versão (mantém histórico em `previous_*`/auditoria), não apagado.

| Ação | Registros (id curto) | Impacto no saldo |
|---|---|---|
| Criar (falta no ledger, item confirmado sem tx) | CDB 500,67 (`11b6dcde` idx 4) | +500,67 |
| Corrigir/superseder manual errado | `99d431ab` Resgate CDB 659,00 → substituído pelo item bancário | −659,00 |
| Superseder duplicatas 01–03/08 | `bc7052de`(33,00), `9d72b394`(34,55), `60037a2b`(66,00), `59b9fcae`(32,95) — manter as linhas do extrato | +166,50 |
| Superseder duplicatas 08–10/08 | `8fcb7eee`(24,47), `20f059b9`(8,59), `b61715d0`(19,58), um dos `e4ac3512`/`68899e8d`(5,40) | +58,04 |
| Retipar `movement_kind` | `49cba4dd` (Estorno IFood 21,10 → refund) + varredura EST/ESTORNO/DEV | 0 (afeta renda/consumo) |
| Vincular estorno → original | pares Uber/99 de 03/08 e 10/08 (`875be515`↔`98817c1b`, `68af4c68`↔`c635c9b8`, `a3c27d52`↔`06785807`, IFood 70,35 `bc0b8388`↔21,10) | 0 |
| Reclassificar não-consumo | pagamentos de fatura manuais (`b6ed6cdb` 210,00, `45aaa843` 90,00, `4e1e2d2c` 185,00) vs itens FATURA PAGA do extrato (`needs_review` 190,00/20,00, suspects 90,00/185,00) — decidir 1 saída por evento | a definir na ponte |
| Revisar itens não confirmados | 27 `duplicate_suspect` + 2 `needs_review` nos dois docs | a definir na ponte |

## 4. PROVA DE RECONCILIAÇÃO (o que falta para fechar)

P0.0 é uma reconstrução read-only, dia a dia, de 31/07 a 10/08, cruzando ledger x linhas bancárias, e só termina quando `opening + Σ deltas = 52,63` sem lançamento de ajuste. Para isso são necessárias as linhas bancárias ausentes (01–02/08 e 08–09/08) e o saldo de 31/07 — hoje inexistentes no banco. Ou o extrato é reingerido cobrindo o período completo, ou você confirma o saldo 31/07 e as linhas faltantes. Sem isso qualquer número seria inventado, o que este plano proíbe.

## 5. ARQUITETURA PROPOSTA

1. `statement_reconciliation_contract.v1`: extrato → conta resolvida → itens → closing balance → snapshot (`confirmed` ou `pending_review`) → ledger balance → delta → status. Import só é "concluído" com `reconciliation_status ∈ {balanced, pending_review}`; `unreconciled` bloqueia e aparece na UI.
2. Separar `confirm_statement_atomic` de `confirm_invoice_atomic`, com orquestrador tipado por `document_kind`; extrato sem conta resolvida = fail-closed com pergunta ao usuário.
3. Resolver de conta determinístico e persistido: (a) escolha do usuário, (b) match banco+agência/conta, (c) extrato com uma única conta ativa → resolve com confiança 0.7, (d) múltiplas contas sem evidência → `needs_account_selection` (nunca escolha silenciosa).
4. Dedupe econômico (`ledger_event_identity.v1`): chaves em cascata — `external_id`/`bank_reference` → (conta, valor, merchant canônico, janela purchase_date↔posted_at de 0–4 dias, método) → texto. `exact` auto-supersede; `probable` exige 2 evidências independentes para auto-link, senão revisão; contagem por ocorrência preserva duas compras reais iguais.
5. `refund_of_transaction_id` em `transactions` + tabela `transaction_reversals` (parciais múltiplos, soma ≤ original, bloqueio de excesso, guards de conta/tipo/janela).
6. Consumo líquido: `net_consumption = despesa − refunds vinculados`, atribuído à categoria **do gasto original**; `financial_daily_category_facts` passa a usar `coalesce(original.category_id, t.category_id)`.
7. Renda: refund, `investment_redemption`, `investment_yield`, `internal_transfer` e reembolso de rolê fora de receita — auditar todos os consumidores.
8. Observabilidade por import: contadores, balances, delta, status, resolução de conta, versão de contrato e build sha em `document_imports`/eventos.
9. Fail-closed: sem ajuste de saldo artificial, sem delete de lançamento manual, sem auto-link ambíguo, sem import "ok" com delta material.

## 6. IMPLEMENTAÇÃO P0–P3

- **P0 — Ponte + saneamento + guards**: relatório read-only da ponte; migration com `superseded`/auditoria e RPC `apply_ledger_correction`; criação do CDB 500,67; correção do 659,00; supersede das duplicatas; snapshot 52,63; guard de statement (resolver + separação statement/invoice + confirmação realmente atômica). Risco: médio. Rollback: reverter status via auditoria (dados preservados). Aceite: saldo = 52,63.
- **P1 — Refund/reversal truth**: colunas/tabela de vínculo, matching com guards, netting por categoria original, renda saneada, refresh de facts. Risco: médio. Rollback: manter colunas, desativar netting por flag.
- **P2 — Backfill histórico**: dry-run com relatório antes/depois (EST sem tipo, refunds sem vínculo, duplicidades antigas, resgates/aplicações, pagamentos de fatura), aplicação em lotes reversíveis.
- **P3 — Observabilidade e gates**: telemetria de import/reconciliação, painel admin, gate de release por teste de reconciliação.

## 7. TESTES

Casos A–R do pedido como fixtures (purchase x posting, duas compras legítimas, refund total/parcial/tardio/múltiplo/sem original, CDB não é renda, card_payment não é consumo, statement 52,63 fecha, conta única resolve, múltiplas contas não escolhem, categoria/meta líquidas, renda sem refunds, reimport idempotente) + teste de idempotência de facts e teste de contrato App↔Edge.

## 8. RISCOS E ROLLBACK

Risco principal: netting e supersede alterarem histórico de metas/relatórios. Mitigação: flags por contrato, auditoria completa, dry-run obrigatório, nenhum delete. Rollback de cada etapa por reversão de status/flag.

## 9. ARQUIVOS E FUNÇÕES AFETADOS

- Migrations novas: correções auditáveis + `superseded_by`, `refund_of_transaction_id`/`transaction_reversals`, `confirm_statement_atomic`, refresh de `financial_daily_facts`/`financial_daily_category_facts`.
- Edge: `assistant-ingest-document`, `assistant-review-actions`, `_shared/import/{dedupe,stage,schema,commit}.ts`, `_shared/ledger/canonical.ts`, `_shared/finance-core/facts.ts`.
- App: `src/lib/engine/facts.ts`, `src/lib/ledger/canonical.ts`, `src/components/assessor/ReviewSheet.tsx`, superfícies de metas/relatórios.
- Testes: novos arquivos em `src/test/`.

## 10. NADA FOI IMPLEMENTADO

Estamos em Plan Mode: nenhuma linha de código, migration, deploy, alteração de dados, secret ou configuração WAHA foi tocada. Apenas leituras (SQL read-only e leitura de arquivos).
