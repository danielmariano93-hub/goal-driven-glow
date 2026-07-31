
# Fatura Itaú 4739 — plano de correção definitiva

## 1. Diagnóstico confirmado no código

**A extração é 100% dependente do LLM de visão, sem nenhuma verificação determinística contra o resumo oficial.**

- `supabase/functions/assistant-ingest-document/index.ts:1657` — o pipeline converte o PDF em imagens/data-url (`bytesToDataUrl`) e envia ao modelo. Não há leitura da camada de texto do PDF em lugar nenhum: `_shared/documents/pdfFragments.ts` só fatia páginas com `pdf-lib` (4 páginas por fragmento) e devolve bytes. Uma fatura de 3 páginas vira **1 único fragmento, 1 única chamada** ao modelo.
- `index.ts:166` — `LIMITE RÍGIDO: no máximo ${BATCH_ITEMS_LIMIT} lançamentos` (80). Os ~47 itens reais cabem no lote, logo **o corte de 40 itens não é limite técnico: é omissão do modelo**. Como `more=false` (`index.ts:379`), o loop encerra o fragmento como `completed` e ninguém questiona a cobertura.
- `index.ts:151` — a regra `EXCLUA todas as linhas informativas: ... subtotais e totais` é aplicada pelo modelo ao bloco **“Pagamentos efetuados”**, que na fatura Itaú aparece no quadro-resumo. A regra de `index.ts:159` (“não omita pagamento/antecipação → income + card_payment”) é genérica e perde a disputa contra a regra de exclusão, que é mais explícita. **Causa direta dos R$ 4.099,34 sumidos** (PIX 3.529,34 + 300,00 + 50,00 + 220,00).
- “AmazonPrimeBR R$ 19,90” e “Repasse de IOF R$ 62,71” são linhas de valor pequeno em regiões densas/rodapé de seção. Não há nada no código que as descarte (o filtro de assinatura em `index.ts:1109-1116` só dedupa itens idênticos já vistos; a quarentena `validateExtractedRow` grava rejeições em `document_item_rejections`, verificável por documento). **São perda de recall do modelo, sem detecção posterior.** Total omitido: R$ 82,61.
- **Conciliação valida, mas não sabe o que faltou.** `validate_invoice_import` (migration `20260730235500`, linhas 49-88) soma `previous_balance + Σ(sinalizado)`, onde `payment/refund` entram negativos. A fórmula está **contabilmente correta**; ela só não tem como acertar porque as linhas de pagamento nunca chegaram a `extracted_items`. Resultado exibido: 3.529,34 + 5.128,58 − 1,46 = 8.656,46; diferença 4.639,73 − 8.656,46 = **−4.016,73**, exatamente `82,61 − 4.099,34`. Confirma o diagnóstico do usuário.
- Não existe persistência do **resumo oficial por seção** (compras nacionais, internacionais, IOF, pagamentos, saldo financiado). `document_imports` guarda apenas `invoice_total`, `invoice_previous_balance`, `due_date`, `closing_date`, `competence`, `card_last4`. Sem subtotais, é impossível dizer *qual seção* está incompleta — por isso o app joga a diferença crua na cara do usuário.
- `assistant-review-actions/index.ts` já protege o lado contábil: `statement_item_kind` `payment`/`informational` entram em `nonLedgerIds` e **não viram transação nova** (coberto por `src/test/invoice-import-contract.test.ts:16-21`). Não há risco de duplicidade compra↔pagamento hoje; o risco aparece quando passarmos a extrair os pagamentos e precisarmos liquidá-los contra a conta bancária.

**Resumo das causas-raiz por camada**

| Camada | Causa-raiz |
|---|---|
| Aquisição | Só imagem; camada de texto do PDF nunca é lida |
| Prompt | “Excluir subtotais/totais” engole o bloco Pagamentos efetuados |
| Extração | Recall do LLM sem rede de segurança; nenhuma segunda passada por seção |
| Contrato | Sem subtotais oficiais persistidos → impossível auditar cobertura |
| Conciliação | Fórmula certa sobre dados incompletos; erro genérico `invoice_total_mismatch` |
| UX | Diagnóstico técnico exposto e “Saldo anterior” duplicado (`ReviewSheet.tsx:536` input vs `:548` calculado); `docKind` cru “invoice” no subtítulo (`:449`) |
| Nino | `NinoContextoV2` e `AssessorAcompanhamentoV2` consomem a **mesma** RPC `my_nino_context` e o mesmo `reviews[]` (`src/lib/nino/client.ts:22`), duplicando headline/highlights. V1 de ambos é código morto não roteado |
| Tempo | `reviewWindow('weekly')` (`AdvisorReviewServiceV2.ts:143`) sempre usa segunda→domingo, sem flag de período parcial |

## 2. Arquitetura-alvo e decisões contábeis

**Estratégia híbrida, determinística primeiro.**

1. **Text layer** — extrair texto posicional do PDF (`unpdf`/`pdf.js` no Deno). Se houver texto, um **parser determinístico de faturas** lê o quadro-resumo por rótulo (fatura anterior, pagamentos/créditos, saldo financiado, lançamentos atuais, compras nacionais, internacionais, IOF/encargos, total, vencimento, fechamento, final do cartão) e as linhas por seção (`data | descrição | valor`, incluindo blocos “Pagamentos efetuados” e “Compras parceladas — próximas faturas”).
2. **LLM** — passa a ser usado para (a) categorização, (b) descrição amigável, (c) **fallback** quando não há camada de texto (PDF só imagem/foto), (d) bancos sem parser dedicado.
3. **Auditoria de cobertura em 3 camadas**, sempre executada:
   - soma das linhas de cada seção vs. subtotal oficial da seção;
   - soma dos subtotais vs. “lançamentos atuais”;
   - `saldo anterior − pagamentos + lançamentos atuais == total oficial`.
   Quando uma camada não fecha, o sistema **nomeia a seção e o valor faltante** (“os itens detalhados estão R$ 82,61 abaixo de Lançamentos atuais”) e dispara **re-extração dirigida daquela seção** antes de incomodar o usuário.
4. **Saldo financiado** é derivado (`anterior − pagamentos`), nunca item nem despesa.

**Regras contábeis fixadas**: compra → consumo + obrigação do cartão; pagamento/antecipação → liquida obrigação contra conta bancária, sem despesa; estorno → reduz obrigação e consumo; IOF/tarifa cobrado na fatura → despesa (Impostos e Taxas); saldo anterior → só conciliação; “próximas faturas” → compromisso futuro, nunca lançamento desta fatura; reimportação idempotente por `dedupe_fingerprint` + `document_id`.

## 3. Arquivos existentes afetados

- `supabase/functions/assistant-ingest-document/index.ts` (prompt, orquestração, auditoria de cobertura, persistência do resumo)
- `supabase/functions/_shared/documents/pdfFragments.ts` (+ novo `pdfText.ts`)
- **novos** `_shared/documents/invoiceParser.ts`, `_shared/documents/banks/itau.ts`, `_shared/documents/coverage.ts`
- `supabase/functions/_shared/documents/invoice.ts` e espelho `src/lib/finance/invoice.ts` (seções, IOF, saldo financiado)
- `supabase/functions/_shared/ledger/canonical.ts` + `src/lib/ledger/canonical.ts` (espelhos)
- `supabase/functions/assistant-review-actions/index.ts` (liquidação do pagamento contra conta)
- `src/components/assessor/ReviewSheet.tsx` (redesenho completo, quebrado em subcomponentes)
- `src/pages/AssessorAcompanhamentoV2.tsx`, `src/pages/NinoContextoV2.tsx`, `src/pages/MaisMenu.tsx`, `src/App.tsx`
- `supabase/functions/_shared/agent/core/AdvisorReviewServiceV2.ts` (período parcial)
- Testes em `src/test/`

## 4. Migrations / RPCs / Edge Functions

**Migration única `2026xxxx_invoice_official_summary.sql`:**
- `document_imports`: `invoice_payments_total`, `invoice_current_charges_total`, `invoice_domestic_total`, `invoice_international_total`, `invoice_taxes_total`, `invoice_credits_total`, `invoice_financed_balance`, `invoice_summary_source` (`parser|llm|manual`), `invoice_coverage jsonb`.
- `extracted_items`: `statement_section text`, `is_future_installment boolean default false`.
- `validate_invoice_import`: passa a validar as **três camadas** e a devolver `sections` com o gap por seção, além do erro global.
- `finalize_invoice_statement`: grava `payments_total`/`financed_balance` em `credit_card_statements`; itens `payment` geram **liquidação** (`card_payment`) contra a conta escolhida, nunca despesa.
- Nova `reextract_invoice_section(document_id, section)` para a re-extração dirigida.
- GRANTs: `authenticated` + `service_role`; RLS por `user_id` mantida.
- Backfill: nenhum. Faturas já importadas ficam com `invoice_summary_source = 'legacy'`.

**Deploy**: `assistant-ingest-document`, `assistant-review-actions`.

## 5. Categorização e parcelamento

Ordem determinística **antes** do LLM: `merchant_aliases` do usuário → histórico de transações confirmadas → regras globais (Amazon Prime/Apple → Assinaturas; RD Saúde/Drogasil → Saúde; iFood/Outback → Alimentação; Localiza/Turbi → Transporte; IOF/tarifa → Impostos e Taxas) → LLM. Cada item guarda `category_source` + `category_confidence`; correção manual grava alias e passa a valer nas próximas faturas. Parcelas: `parcela atual/total`, restantes, já pago e compromisso futuro; “Compras parceladas — próximas faturas” entra como `is_future_installment` (visível como compromisso, fora da conciliação e fora do ledger).

## 6. UX/UI — revisão mobile

```
┌──────────────────────────────┐
│ ← Fatura Itaú · final 4739   │  56px, uma linha
│ R$ 4.639,73 · vence 03/08    │
├──────────────────────────────┤
│ ✅ Tudo confere   Ver conciliação ›│  chip 32px
├──────────────────────────────┤
│ [Pendentes][Sem categoria]   │  chips roláveis
│ [Parceladas][Créditos][Todos]│
├──────────────────────────────┤
│ 24/07  Pagamento recebido    │
│        −R$ 220,00  · liquida │  ← lista ocupa ~72%
│ 23/06  Amazon Prime          │
│        R$ 19,90 · Assinaturas│
│ …                            │
├──────────────────────────────┤
│  Confirmar 47 lançamentos    │  sticky 64px
└──────────────────────────────┘
```
Estado com falha de cobertura: o chip vira `⚠️ Faltam R$ 82,61 em Lançamentos atuais · Revisar ›`, e o drawer mostra a equação oficial linha a linha (anterior − pagamentos + lançamentos = total) com a seção divergente destacada e botão “Procurar de novo nesta seção”.

Regras: conciliação **recolhida por padrão** em bottom sheet; “Saldo anterior” aparece **uma única vez** (dentro do drawer); nada de “invoice”/`docKind` cru; diagnóstico técnico só via menu “⋯ › Detalhes técnicos”; edição inline preserva scroll; **rascunho persistente** em `localStorage` por `document_id` com merge no reload; feedback por item e por seção; CTA alterna entre “Confirmar X lançamentos” e “Revisar X pendências”. Responsivo em 320/375/390/430 px com números em `tabular-nums` e truncagem por `min-w-0`; alvos ≥44px, labels e `aria-live` nos estados de conciliação.

## 7. Unificação do Nino e correção temporal

Central única **“Nino”** em `/app/nino`, com seções Agora · Onde agir · Evolução · Plano · Histórico. “O que o Nino sabe” sai da navegação; memórias, aliases, regras, exportação e controles migram para **Mais › Dados e personalização › O que o Nino aprendeu**. `/app/nino-contexto` e `/app/assessor/acompanhamento` viram redirects. V1 órfãos (`NinoContexto.tsx`, `AssessorAcompanhamento.tsx`) removidos.

Período: `reviewWindow` passa a devolver `is_partial` e `days_elapsed`; copy “Até agora, nesta semana” enquanto em andamento e “A semana fechou” só após o término; dias futuros nunca contam como zerados; comparação semana-a-semana usa janelas parciais equivalentes (D1..Dn vs D1..Dn).

## 8. Matriz de testes e aceite

Regressão obrigatória com a fatura Itaú 4739 (fixture de texto anonimizada): pagamentos 4.099,34 · nacionais líquidas 3.355,00 · internacionais 1.792,02 · IOF 62,71 · lançamentos atuais 5.209,73 · total 4.639,73 · **diferença 0,00** · 47 linhas.
Demais casos: antecipação maior que a fatura anterior; múltiplos pagamentos; estorno; internacional+IOF; sem saldo anterior; parcelas antigas não presumidas pagas; PDF com texto e PDF só imagem (fallback LLM); reimportação idempotente; zero duplicidade contábil compra↔pagamento; rascunho preservado após reload e após falha de rede; layouts 320/375/390/430; tela única do Nino com redirects; semana parcial com copy e comparação corretas.

## 9. Riscos e rollback

- **Parser específico de banco quebrar com layout novo** → fallback automático para LLM, `invoice_summary_source` registra a origem.
- **Extração de pagamentos criar dupla contagem** → mitigado por `nonLedgerIds` já existente + testes de não-duplicidade.
- **Faturas legadas** → marcadas `legacy`, sem reprocessamento automático.
- Rollback: Edge Functions voltam à versão anterior; colunas novas são aditivas e nullable (nenhum `DROP`); UI atrás de commit revertível.

## 10. Ordem de implementação

1. Migration do resumo oficial + RPCs de 3 camadas.
2. `pdfText` + parser determinístico Itaú + auditoria de cobertura + prompt corrigido → deploy `assistant-ingest-document`.
3. Liquidação de pagamentos → deploy `assistant-review-actions`.
4. Redesenho do ReviewSheet + rascunho persistente.
5. Unificação do Nino + correção de período parcial.
6. Testes, build, publicação (só com sua autorização).

## 11. Decisões que dependem da sua aprovação

1. **Adotar parser determinístico por banco** (começando por Itaú) em vez de depender do LLM — confirma?
2. Quando extrairmos os pagamentos, eles **liquidam contra qual conta**? Perguntamos ao usuário na revisão, ou usamos a conta única quando só houver uma?
3. Rota final da central: `/app/nino` (com redirects) ou manter `/app/assessor/acompanhamento` como canônica?
4. Faturas já importadas: deixar como estão (`legacy`) ou oferecer botão “reconciliar de novo”?
5. Extração de texto: posso adicionar a dependência `unpdf` na Edge Function?
