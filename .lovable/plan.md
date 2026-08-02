# Pipeline único de importação em lote e deduplicação

## Diagnóstico verificado no código atual

- `supabase/functions/agent-chat/index.ts:15` define `MAX_MSG_LEN = 2000` e trunca a mensagem em `:38` — um JSON grande é cortado silenciosamente. `_shared/agent/llm.ts:94` também corta cada mensagem de histórico em 2000 caracteres.
- `_shared/agent/core/BulkEntry.ts` guarda **uma única data** para o lote (`payload.occurred_at`, linha 66/113) e a aplica a todos os itens na execução.
- `_shared/agent/bulkParse.ts` não lê data por item, nem conta/cartão, nem referência externa, nem vínculo com estorno; converte tudo em `income`/`expense` e só preserva `movement_kind` cru.
- `BulkEntry.executeBulkPending` **não faz nenhuma deduplicação** contra `transactions`, e descarta pagamentos de fatura (linha 128) em vez de registrá-los como movimento próprio.
- O motor de dedupe existe, porém **apenas dentro do fluxo de documento**: `classifyDuplicates` está embutido em `assistant-ingest-document/index.ts` (~linha 415) e `computeFingerprint` em `_shared/documents/normalize.ts:135`. Ele compara fingerprint, `bank_reference` e tipo+data+valor(+descrição normalizada), mas exige **data exatamente igual** — não tolera janela de dias nem data de compra vs. processamento, e a comparação de descrição é igualdade exata do texto normalizado.
- Os estados por item já existem em `extracted_items` (`needs_review`, `duplicate_suspect`, `rejected`, `failed`, `rolled_back`…), assim como a UI de revisão em lote (`src/components/assessor/ReviewSheet.tsx`) — mas o lote via chat não passa por eles.

Conclusão: em vez de duas arquiteturas, extraímos o que já funciona no fluxo documental para um serviço compartilhado e ligamos o JSON do chat (e CSV/OFX) nele.

## O que será construído

### 1. Serviço único de importação — `supabase/functions/_shared/import/`
- `schema.ts`: contrato canônico `import_item.v1` com todos os campos pedidos — `occurred_at` (por item, obrigatório), `posted_at`, `amount`, `description`, `raw_description`, `type`, `movement_kind`, `category_hint`, `account_hint`/`account_id`, `card_hint`/`credit_card_id`, `payment_method`, `merchant`, `installment_number`/`installments_total`, `external_id`/`bank_reference`, `reverses_external_id` (vínculo estorno/original), `confidence`.
- `parseBatch.ts`: substitui e absorve `bulkParse.ts`. Aceita `{ "lancamentos": [...] }` com objetos completos (o exemplo da sua mensagem passa a ser o formato de referência), o formato compacto em arrays já usado pelo extrator, e linhas soltas. Sem data por item, cai para a data-âncora da mensagem e marca `needs_review` — nunca sobrescreve a data informada.
- `normalize.ts`: reaproveita `documents/normalize.ts` (merchant dictionary, PIX, fingerprint) + `ledger/creditSemantics.ts` para sinal de crédito, e `merchant_aliases` para o merchant canônico.
- `dedupe.ts`: `classifyDuplicates` sai de `assistant-ingest-document` para cá, com melhorias — janela de ±3 dias entre `occurred_at`/`posted_at`, comparação por merchant canônico (resolve `PAY DL Ub 31/07` ≡ `UBER *TRIP` ≡ `Uber do Brasil`), casamento de estorno com a transação original, `bank_reference`/`external_id` como chave forte, e ordinal preservando duas compras reais de mesmo valor no mesmo dia.
- `classify.ts`: atribui o status de cada item — `new`, `exact_duplicate`, `probable_duplicate`, `needs_review`, `invalid` — sempre com `duplicate_reason`/`reason_code` legível para o usuário.
- `commit.ts`: registro idempotente via `commit_movement` com chave `import:{batch_id}:{ordinal}:{fingerprint}`; confirmar duas vezes não duplica. Naturezas completas suportadas: despesa, receita, `internal_transfer` (enviada/recebida), `investment_application`, `investment_redemption`, `investment_yield`, `refund`, `card_payment`, `debt_payment`, `loan_proceeds`, compra parcelada no cartão.
- `report.ts`: relatório final com importados, ignorados, duplicidades exatas, prováveis, em revisão, falhas, totais por natureza e IDs criados.

### 2. Fim do truncamento silencioso
- `MAX_MSG_LEN` sobe para 32k quando o corpo é detectado como lote/JSON; acima disso a resposta é um erro explícito pedindo envio como arquivo (nunca corte silencioso).
- O histórico enviado ao modelo continua compactado, mas o texto original do lote nunca passa pelo modelo — o parser é determinístico.
- Fluxo alternativo já suportado: enviar o `.json` como arquivo cai no mesmo pipeline (documento → `import/`).

### 3. Prévia e revisão antes de gravar
- O lote do chat passa a criar um `document_imports` + `extracted_items` (mesma trilha do PDF), então ganha automaticamente a revisão em lote existente.
- Resposta do Assessor: `Encontrei 42 lançamentos: 31 novos · 8 já registrados · 3 precisam de revisão`, com link direto para a revisão no app e `CONFIRMAR` no WhatsApp para gravar só os novos.
- `ReviewSheet.tsx` ganha filtros por estado (novos / duplicados / possíveis / sem categoria / baixa confiança) e exibe o motivo da classificação em cada item.

### 4. PDF/imagem: dedupe antes de materializar
`assistant-ingest-document` passa a delegar normalização, dedupe e classificação ao serviço compartilhado, mantendo fragmentos e heartbeat. Nada é gravado como transação antes da aprovação; a resposta devolve IDs criados e ignorados.

### 5. Reaproveitamento nos demais canais
`src/lib/import/csv.ts` e `ofx.ts` passam a emitir `import_item.v1` e usar o mesmo pipeline, assim como o MCP (futura integração externa).

## Detalhes técnicos
- Migration: colunas `posted_at`, `reverses_transaction_id`, `import_batch_id` e `reason_code` em `extracted_items`; índice em `transactions (user_id, amount, occurred_at)` para acelerar o candidato de dedupe; `GRANT` correspondentes.
- `bulkParse.ts` fica como reexport fino para não quebrar os testes atuais; testes novos cobrem parser por item, janela de datas, equivalência de merchant, estorno e idempotência de confirmação dupla.
- Sincronização do núcleo Edge/App segue `scripts/sync-finance-core.mjs`.
- Sem alteração de identidade visual, autenticação ou publicação em produção sem sua autorização.
