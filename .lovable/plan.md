# Plano consolidado — Ingestão robusta + Privacidade reativa

Documento de referência do caso real: `0252fd7f-7e52-4726-91f5-678d958c8b45` (97/97 sem categoria, 0 duplicatas detectadas, 20 candidatos fortes por tipo+data+valor, saldo do extrato R$ 273,19 não conciliado; caixa calculado -R$ 1.072,60).

## 1. Causa raiz por problema

1. **Olho não é reativo.** `src/lib/privacy.ts` guarda `financialValuesHidden` em uma variável de módulo lida por `formatPrivateBRL`, e `formatBRL` (em `src/lib/engine/facts.ts` e `src/lib/split/math.ts`) delega para essa função pura. Alterar o flag não dispara re-render — componentes só releem no próximo mount (refresh).
2. **Dedupe zero.** `assistant-review-actions` (confirm) e a RPC `confirm_document_import` inserem transações sem comparar com o histórico. Não existe fingerprint canônico persistido em `transactions` (só há `import_source_id` livre) nem comparação intra-documento. Por isso 20 coincidências fortes passaram como novas.
3. **Descrições cruas.** `extracted_items.description` é gravada como o modelo devolve ("ON UBER TRIP 16/07"). Não há `raw_description` nem passo de normalização (merchant map + limpeza de datas/códigos).
4. **97/97 sem categoria.** Não há resolver de categoria no confirm: `category_id` chega null e nada tenta preencher via histórico do usuário, regras determinísticas ou IA de baixo custo. A UI de revisão não sinaliza a lacuna.
5. **Saldo do extrato descartado.** `isNonTransactionLine` em `_shared/documents/types.ts` filtra corretamente linhas de saldo, mas o extrator não separa esses valores em um bloco `statement_metadata` (saldo inicial/final, data, banco). Nada é conciliado; caixa é sempre `opening_balance + soma(ledger)`, o que diverge do extrato quando há período incompleto.
6. **Instruções e período do usuário não persistem.** `document_imports` guarda `raw_text` mas não `user_instructions`, não `period_start/end`, nem contadores de "ignorados por período/duplicata".
7. **Sem rollback.** `extracted_items.transaction_id` existe (permite localizar), mas não há endpoint/RPC que reverta uma importação preservando edições posteriores.

## 2. Arquivos, tabelas, migrations e Edge Functions afetados

**Migrations (uma só, em ordem):**
- `transactions`: adicionar `dedupe_fingerprint text`, `raw_description text`, `bank_reference text`; índice `unique(user_id, dedupe_fingerprint) where dedupe_fingerprint is not null`.
- `extracted_items`: adicionar `raw_description text`, `normalized_description text`, `bank_reference text`, `dedupe_fingerprint text`, `duplicate_suspect boolean default false`, `duplicate_reason text`, `duplicate_of_transaction_id uuid`, `category_source text` ('history' | 'rule' | 'ai' | 'none'), `category_confidence numeric`.
- `document_imports`: adicionar `user_instructions text`, `period_start date`, `period_end date`, `statement_opening_balance numeric`, `statement_closing_balance numeric`, `statement_balance_date date`, `statement_bank text`, `counters jsonb` (ignored_out_of_period, duplicate_strong, duplicate_ambiguous, categorized_auto, needs_review).
- Nova tabela `account_balance_snapshots(id, user_id, account_id, source_document_id, balance, balance_date, kind ['statement','manual','reconciled'], created_at)`: fonte de verdade para caixa; caixa vigente = último snapshot + soma de transações após `balance_date`. Grants + RLS por `user_id`.
- Nova tabela `merchant_aliases(id, user_id, pattern text, normalized text, category_id, hit_count, last_used_at)` para aprender com correções. Grants + RLS.
- RPC `confirm_document_import` reescrita: aceita array com `{item_id, apply, category_id, description, account_id, credit_card_id}`, computa fingerprint, checa dedupe intra-lote e contra `transactions.dedupe_fingerprint`, respeita `duplicate_suspect`, retorna contadores.
- RPC `rollback_document_import(document_id)`: apaga apenas transações cujo `id` está em `extracted_items.transaction_id` e cujo `updated_at <= extracted_items.updated_at + tolerância` (preserva edições posteriores); marca items como `status='rolled_back'`; grava auditoria em nova `document_import_audit`.

**Edge Functions:**
- `assistant-ingest-document`: além de itens, extrair `statement_metadata` (saldo inicial/final, data, banco). Persistir `user_instructions`, `period_start/end`. Preencher `raw_description` = texto do modelo; `normalized_description` = pipeline pt-BR (merchant map + strip de datas/códigos + PIX contraparte).
- Nova função (ou modo do ingest) `assistant-categorize-batch`: enriquece `extracted_items` antes da revisão (histórico -> regras -> IA barata; grava `category_source`, `category_confidence`).
- `assistant-review-actions`: novos modos `dedupe-scan` (rechecagem antes de confirmar), `rollback-import`.

**Frontend:**
- `src/lib/privacy.ts` → substituir singleton por Zustand ou Context reativo com hook `usePrivateBRL()` e componente `<Money value={n} />`. Refatorar `formatBRL` em `facts.ts`/`split/math.ts` para não mascarar (apenas formatar) e trocar todos os call sites (~30 arquivos listados) para `<Money>` ou hook, via codemod único.
- `src/components/assessor/ReviewSheet.tsx`: seção de conciliação de saldo, badge de duplicata com link ao lançamento existente, coluna de categoria sugerida + confiança, banner "X sem categoria, Y duplicatas suspeitas, Z fora do período".
- `src/pages/Importar.tsx` (ou nova `HistoricoImportacoes`): listar imports, acionar `rollback-import`.

## 3. Desenho de dados e fluxo

```text
Upload PDF ─► ingest (extrai items + statement_metadata + user_instructions)
           ─► normalize (raw_description → normalized_description)
           ─► fingerprint (user+type+date+amount+account+bank_ref+norm_desc)
           ─► dedupe-scan (vs transactions e intra-lote) marca duplicate_suspect
           ─► categorize-batch (history → rules → IA) preenche category_id + source
           ─► counters gravados em document_imports.counters
ReviewSheet ─► usuário edita/desmarca duplicatas/ajusta categoria/concilia saldo
            ─► confirm (RPC atômica, respeita fingerprint, cria snapshot de saldo)
Home/Patrimônio/Contas ─► caixa = último snapshot + Δ transações posteriores
```

### Fingerprint canônico
`sha1(user_id | type | occurred_at | round(amount*100) | account_id||credit_card_id | bank_reference || normalize(desc))`. Se `bank_reference` presente, ele domina (chave forte). Duas transações legítimas no mesmo dia com mesmo valor mas descrições distintas geram fingerprints distintos.

### Normalização de descrição
Pipeline determinístico: remove prefixos ("ON ", "COMPRA ", "PAG "), remove datas embutidas (`\d{2}/\d{2}`) e códigos de autorização, mapeia via `merchant_aliases` do usuário + dicionário global (Uber, iFood, PIX contraparte). Nunca inventa; se nada casa, mantém texto limpo do banco.

### Conciliação de saldo
`saldo_inicial_extrato + Σ entradas válidas − Σ saídas válidas` vs `saldo_final_extrato`. ReviewSheet mostra a igualdade e a diferença. Se `= 0`, botão "Registrar saldo conciliado" cria snapshot. Se `≠ 0`, exibe causas prováveis (duplicatas marcadas, itens sem categoria abaixo do valor Δ, período incompleto). Nunca sobrescreve `accounts.opening_balance`.

## 4. Ordem de implementação (rodada única)

1. Migration única (colunas + tabelas novas + RPCs `confirm_document_import v2` e `rollback_document_import` + `document_import_audit` + grants + RLS).
2. `_shared/documents/normalize.ts` (pipeline pt-BR) e `_shared/documents/fingerprint.ts`, com testes unitários.
3. `_shared/documents/dedupe.ts` (compara contra `transactions.dedupe_fingerprint` e intra-lote) + `categorize.ts` (history → rules → IA).
4. `assistant-ingest-document`: estender prompt para `statement_metadata`, persistir instruções/período/contadores, chamar normalize/fingerprint/dedupe/categorize e salvar em `extracted_items`.
5. `assistant-review-actions`: modos `dedupe-scan`, `rollback-import`; confirm passa a delegar tudo à nova RPC.
6. Backfill leve: script (edge admin) que preenche `dedupe_fingerprint` das transações existentes do usuário afetado a partir do documento `0252fd7f...` para tornar o rollback correto.
7. Frontend privacidade reativa: novo `PrivacyModeContext` já existe — expor hook `usePrivateBRL` + componente `<Money>`; refatorar `formatBRL` para versão pura; codemod substituindo `formatBRL(x)` por `<Money value={x} />` (ou `usePrivateBRL()(x)` em strings). Remover singleton `setFinancialValuesHidden`.
8. `ReviewSheet.tsx`: banners de contadores, coluna categoria sugerida + confiança, badge duplicata com link, seção de conciliação de saldo, ação "aplicar categoria em lote".
9. Nova página/modal `Importações` com botão `Desfazer importação` (chama `rollback-import`), pré-visualização do impacto.
10. Testes (ver §8 do briefing): unit (fingerprint, normalize, categorize, privacy hook), integração (RPC confirm com dedupe forte/ambíguo, rollback preservando edições), E2E mobile (Playwright: olho reativo em Home/Lançamentos/Assessor; abrir Review; conciliar saldo).
11. Build + `vitest run` + Playwright headless + deploy das functions afetadas.

## 5. Riscos e rollback

- **Fingerprint colidindo em cenários legítimos** (duas idas ao mercado por R$ 50 no mesmo dia): mitigar exigindo descrição/bank_ref na chave e classificando como `duplicate_ambiguous` (revisão manual), nunca bloqueio silencioso.
- **Backfill de fingerprint** em transações antigas pode gerar falsos duplicados no rollback: rollback usa `extracted_items.transaction_id` (referência direta), não fingerprint, então é seguro.
- **Codemod do `formatBRL`** pode quebrar strings interpoladas (`\`R$ ${formatBRL(x)}\``). Mitigação: manter função pura `formatBRL` (sem mascarar) + `<Money>` para JSX; strings continuam funcionando e a máscara aplica só em JSX via componente.
- **Rollback global**: RPC exige confirmação do usuário e é idempotente (marca `status='rolled_back'`); auditoria em `document_import_audit`.

## 6. Critérios objetivos de pronto

- Clicar no olho altera todos os valores em Home, Lançamentos, Cartões, Investimentos, Relatórios, Assessor e ReviewSheet em <100 ms, sem refresh. Persistência sobrevive a logout/login.
- Reimportar o PDF `0252fd7f...` produz `duplicate_strong ≥ 20`, todos desmarcados por padrão, com link para o lançamento existente.
- Dois gastos legítimos iguais no mesmo dia com descrições distintas passam como `duplicate_ambiguous` (revisão), nunca `strong`.
- `raw_description` preservada; `description` legível ("Uber", "PIX João Silva"); sem "ON " ou datas embutidas.
- Nenhum documento sai da revisão com >30 % de itens sem categoria sem banner explícito.
- ReviewSheet exibe: período considerado, X itens fora do período ignorados, Y duplicatas fortes, Z ambíguas, W categorizados automaticamente, K precisam de atenção.
- Extrato com saldo final é lido; ReviewSheet exibe equação de conciliação; snapshot criado em `account_balance_snapshots`; Home/Patrimônio usa a mesma fórmula (snapshot mais recente + Δ posterior).
- `rollback_document_import('0252fd7f...')` remove exatamente as 97 transações originadas, preservando qualquer transação editada depois; auditoria registrada.
- 100 % dos testes (unit + integração + E2E mobile) do §8 verdes.
- `patrimônio = caixa_reconciliado + investimentos − fatura_aberta − dívidas` valida com dados de teste.

## 7. Estimativa

Complexidade: **alta** (backend + schema + Edge Functions + refactor frontend transversal + Playwright). ~1 migration robusta, 2 edge functions estendidas + 1 novo modo, ~15 arquivos frontend tocados (a maioria via codemod), ~12 novos testes. Estimativa de créditos: **elevada** (uma rodada longa); risco principal é o codemod do `formatBRL`, que exige varredura cuidadosa.
