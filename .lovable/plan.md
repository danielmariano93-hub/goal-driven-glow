## 1. Causa raiz (verificada no HEAD e no banco)

Documento real auditado: `document_imports 2b45c2f9…` (kind `invoice`, origem `app`, status `canceled`), com `source_account_id = 6c1cf814…` (conta Itaú), `source_context_method = statement_bank`, `statement_closing_balance = 4639,73`, `statement_period_start/end = NULL`. Dos 39 `extracted_items`: **39 com `account_id` preenchido** e **37 sem `category_id`**. O usuário tem exatamente **1 cartão ativo ("Cartão Itaú")**.

Três defeitos concretos:

1. **Kind estagnado na resolução de origem** — `supabase/functions/assistant-ingest-document/index.ts`
   - L784: `resolveSourceContext(sb, userId, doc, null)` roda **antes** da extração, com `doc.document_kind = "unknown"`.
   - L884: a reavaliação usa `{ ...doc, ...statementPatch }`, e `statementPatch` **não inclui `document_kind`**. Como `resolveSourceContext` lê `doc.document_kind` (L72), o ramo `documentKind !== "invoice"` (L79-83) casa "Itaú" com a **conta corrente** e devolve `statement_bank` com confiança 0,92. O ramo de cartão (L84-88), que casaria com "Cartão Itaú", nunca é avaliado.
   - Consequência: L1015-1016 propagam `source_account_id` para os 39 itens e L1006 grava `payment_method = "account"`.
2. **Metadata de saldo aplicada a qualquer documento** — `extractStatementMetadata` + patch L873-883 gravam `statement_opening/closing_balance` mesmo em fatura. Isso produz "Saldo informado pelo banco: R$ 4.639,73" na revisão e, pior, ativa o guardrail de conciliação de `confirm_document_import` (L31-53 da função), que compara soma de itens com saldo bancário — semanticamente inválido para fatura.
3. **Período vazio** — o prompt só pede `period_start/period_end` no bloco `m` de **extrato**; em fatura o modelo devolve saldos mas não período, e não há derivação por fallback (min/max de `occurred_at`, competência ou vencimento). Daí `Período — a —`.

Defeitos correlatos confirmados:

- `confirm_document_import` (RPC) **não conhece `document_kind`**: aceita item de fatura com `account_id` e insere `transactions` com `account_id` preenchido → reduz caixa indevidamente. Não há constraint impedindo isso.
- `ReviewSheet.tsx` é agnóstico de tipo: sempre exibe bloco "Saldo informado pelo banco" (L410-420), seletor global Conta/Cartão (L430-437) e "Método: Conta/Cartão" por item (L514-533).
- Categorização na ingestão (`enrichItems`, L470-500) usa apenas alias → regra → histórico → hint, **sem** o pipeline completo `_shared/categorization/pipeline.ts` (que já tem estágios rule/history/alias/llm e thresholds). Em fatura, `category_hint` costuma vir `null` e não há histórico de cartão → 37/39 sem categoria.
- Nenhum lugar do fluxo cria `credit_card_statements` / `credit_card_purchases` / `credit_card_installments` (tabelas do núcleo financeiro recém-implantado): a fatura confirmada não vira fatura, vira 39 despesas soltas.

## 2. Inventário dos fluxos afetados

| Caminho | Arquivo/objeto | Risco |
|---|---|---|
| Upload app (chat/anexo) | `AssessorAttachButton.tsx` → `assistant-ingest-document` | destino errado |
| WhatsApp mídia/JSON | `whatsapp-webhook`, `_shared/messaging/wahaMedia.ts`, `AgentCore.ts` | mesmo pipeline + resposta textual divergente |
| Lote em texto/JSON | `_shared/agent/core/BulkEntry.ts` | cai em `accounts[0]` quando não há hint de cartão; grava `payment_method: "account"` |
| FastLog `!ja` | `_shared/agent/core/FastLog.ts` | resolução genérica de conta |
| Revisão manual | `ReviewSheet.tsx` + `assistant-review-actions` | UI sem noção de tipo |
| Persistência | RPCs `confirm_document_import`, `commit_movement`, `reconcile_document_balance`, `rollback_document_import` | sem invariantes contábeis |
| Reprocesso/retentativa | `reprocess_rejected_items`, `document_fragments` | pode reintroduzir destino errado |
| CSV/OFX | `src/lib/import/csv.ts`, `ofx.ts`, `legacy.ts` | sempre conta (correto para extrato, errado se arquivo for de cartão) |

## 3. Matriz documento → destino → efeitos → perguntas

| # | Documento | Ledger | Caixa | Resultado | Passivo | Pergunta obrigatória |
|---|---|---|---|---|---|---|
| A | Fatura de cartão | credit_card + statement | não | sim (compras, na data da compra) | +obrigação | "A qual cartão esta fatura pertence?" |
| B | Extrato bancário | bank_account | sim | sim | — | "Qual conta?" + saldo permitido |
| C | Comprovante Pix/TED | conta origem/destino | sim | só se contraparte externa | — | "Foi entre suas contas?" |
| D | Pagamento de fatura | conta + cartão | sim (−) | **não** | −obrigação | "De qual conta saiu?" |
| E | Recibo/nota | depende do meio | depende | sim | se cartão | "Foi no cartão ou na conta?" |
| F | Boleto/conta a pagar | payable | só na liquidação | na competência | +obrigação | "Já foi pago?" |
| G | Empréstimo/financiamento | debt | sim (principal) | só juros/tarifas | +/− | "É novo contrato ou parcela?" |
| H | Estorno/reembolso | mesmo ledger da compra | conforme ledger | reverte | −obrigação se cartão | "Refere-se a qual compra?" |
| I | Invoice comercial de fornecedor | payable, não cartão | não | sim | +obrigação | confirmar explicitamente quando ambíguo |

Regra transversal: **a classificação vem do conteúdo, não do canal**; app e WhatsApp chamam o mesmo classificador.

## 4. Arquitetura canônica proposta

Novo módulo compartilhado `supabase/functions/_shared/ledger/` (espelhado em `src/lib/ledger/` para a UI):

- `classifyDocument.ts` → `document_kind` com evidências (presença de "fatura/limite/vencimento/melhor dia" vs. "saldo do dia/agência/conta"), score e motivos.
- `resolveLedger.ts` → para cada item produz o **CanonicalMovement**:
  `{ document_kind, movement_kind, ledger: 'bank_account'|'credit_card'|'debt'|'cash'|'payable', source_id (obrigatório), cash_effect, result_effect, liability_effect, links{purchase_id, installment_id, statement_id, payment_id, debt_id}, confidence, reasons[], pending_fields[], blocks[] }`.
- `invariants.ts` → validação pura, reutilizada por Edge Function, UI e testes.

Invariantes (com espelho no banco):

1. `ledger='credit_card'` ⇒ `account_id IS NULL` e `cash_effect = 0`.
2. `movement_kind='card_payment'` ⇒ `result_effect = 0`, `cash_effect < 0`, `liability_effect > 0` (redução).
3. Total da fatura nunca vira transação — só `credit_card_statements.total_amount`.
4. `statement_closing_balance` só é aceito quando `document_kind='statement'`.
5. `internal_transfer` e principal/amortização de empréstimo ⇒ `result_effect = 0`.
6. `source_id` (`document:<id>:<idx>`) obrigatório e único → idempotência entre canais/reenvios.
7. Baixa histórica de parcelas anteriores exige `confirmed_by_user_at` ou evidência conciliada.

Mudanças de banco (migration nova, aditiva):

- `document_imports`: `document_kind` normalizado + `kind_confidence`, `kind_evidence jsonb`, `credit_card_statement_id`, `blocked_reason`.
- `extracted_items`: coluna gerada/CHECK `ledger` + `CHECK (ledger <> 'credit_card' OR account_id IS NULL)`.
- `transactions`: `CHECK (movement_kind <> 'card_payment' OR credit_card_id IS NOT NULL)`; `CHECK (payment_method <> 'credit_card' OR account_id IS NULL)` (validar dados antes com `NOT VALID` + validação posterior).
- Índice único `(user_id, import_source_id)` em `transactions` para idempotência.
- `confirm_document_import` v2: recebe `document_kind`, aplica invariantes, cria `credit_card_statements` + `credit_card_purchases` + `credit_card_installments` para faturas, aplica guardrail de saldo **apenas** em extrato, e devolve `blocked_reasons` estruturados.
- Nova RPC `set_document_target(document_id, card_id|account_id)` que repropaga destino a todos os itens de forma transacional.

## 5. Mudanças por camada

- **Edge ingest**: mover `resolveSourceContext` para depois da classificação, passar `document_kind` real; descartar metadata de saldo em fatura; derivar período por precedência (metadata → vencimento/fechamento → min/max de `occurred_at`); gravar `kind_evidence`.
- **Agente (app/WhatsApp)**: `BulkEntry`/`FastLog` passam a chamar `resolveLedger`; em fatura, a pergunta é sobre cartão; nunca fallback para `accounts[0]` quando kind = invoice.
- **WhatsApp**: perguntas curtas e sequenciais ("Essa fatura é do Cartão Itaú? 1-Sim 2-Outro cartão"), mesma intenção canônica do app.
- **Frontend**: `ReviewSheet` ganha cabeçalho por tipo (`InvoiceHeader`, `StatementHeader`, `ReceiptHeader`); em fatura some "Saldo informado pelo banco" e a lista de contas; item passa a ter classificação compra/crédito/estorno/encargo/pagamento; botão principal desabilitado com motivo textual específico; blocos "O que será registrado" e "O que não movimenta seu saldo agora".

Copies finais (pt-BR simples):

- Cartão: "A qual cartão essa fatura pertence?" / "Não encontrei esse cartão. Quer cadastrar agora? (emissor, bandeira, final)".
- Divergência: "A soma dos itens (R$ X) não bate com o total da fatura (R$ Y). Diferença de R$ Z. Quer revisar antes de confirmar?".
- Parcelas anteriores: "Essa compra é 3/10. Não vou registrar as parcelas 1 e 2 sem sua confirmação. Elas já foram pagas?".
- Duplicidade: "Parece que essa compra já está registrada em outra fatura. Confirmar mesmo assim?".
- Pagamento de fatura: "Isso é o pagamento da fatura. Vou tirar da sua conta e abater o cartão — não conta como gasto novo."

## 6. Categorização

Substituir a escada ad hoc de `enrichItems` pelo pipeline existente `_shared/categorization/pipeline.ts` (alias → histórico → regra → LLM em lote, com thresholds), somando: normalização de estabelecimento (remoção de sufixos tipo `*PAG`, cidade, UF, `PARC 03/10`), histórico específico por cartão, dicionário global de merchants para categorias globais (20 já existem) e fallback legível "A classificar". Categoria ausente **não bloqueia** a fatura; só sinaliza.

## 7. Ordem de execução segura

1. Módulo canônico + testes unitários (sem tocar em fluxo).
2. Correção do `document_kind` na resolução de origem + supressão de saldo em fatura + período derivado.
3. `ReviewSheet` por tipo de documento e bloqueios com motivo.
4. Migration de constraints/índices (`NOT VALID` → validação) e `confirm_document_import` v2 com criação de fatura/compras/parcelas.
5. Agente/WhatsApp usando o classificador canônico.
6. Categorização via pipeline completo.
7. Auditoria e reconciliação dos dados existentes.

## 8. Dados já importados — auditoria (somente leitura por enquanto)

Consultas propostas:

- itens de documentos `invoice` com `account_id NOT NULL`;
- `transactions` com `payment_method='credit_card' AND account_id IS NOT NULL`;
- `transactions` com `import_source_id LIKE 'document:%'` originados de documento `invoice`;
- as 2 faturas do backfill em `needs_review` (`credit_card_statements`) versus soma de `credit_card_statement_items`.

Nada será alterado sem sua aprovação; a correção proposta é uma migration de reconciliação idempotente que remove `account_id` de transações de cartão e vincula compras à fatura correta, com tabela de auditoria `document_reconciliation_log` e rollback por `import_source_id`.

## 9. Testes e aceite

Unitários: classificador, `resolveLedger`, invariantes, datas/período, normalização de merchant.
Integração/RPC: confirmação de fatura não grava `account_id`; guardrail de saldo só em extrato; reenvio não duplica (`import_source_id` único); parcelas em faturas sucessivas não recriam cronograma.
Contrato: mesma fatura em app e WhatsApp gera o mesmo CanonicalMovement.
UI: fatura nunca mostra lista de contas nem saldo bancário; botão bloqueado com motivo.
Banco: RLS impede acesso cruzado; constraints rejeitam combinações proibidas.
Ponta a ponta: os 39 itens da fatura real não alteram saldo bancário; pagamento da fatura reduz banco e passivo sem novo consumo.

## 10. Observabilidade, riscos e decisões pendentes

Observabilidade: `document_processing_events` com `kind_evidence`, motivo de bloqueio e destino escolhido; métrica de % de itens categorizados e de documentos bloqueados por divergência.

Riscos: constraints podem rejeitar dados legados (mitigado com `NOT VALID`); reclassificação retroativa pode alterar números históricos (mitigado com log e rollback).

Perguntas bloqueantes:

1. Confirmo que a única fatura afetada (`2b45c2f9…`, hoje `canceled`) **não** deve ser reprocessada automaticamente — apenas reenviada por você após a correção?
2. Para faturas, o gasto deve ser reconhecido na **data da compra** (competência) — confirma essa escolha como padrão?
3. As 2 faturas do backfill em `needs_review` podem ser mantidas como estão até a reconciliação, ou prefere invalidá-las?
