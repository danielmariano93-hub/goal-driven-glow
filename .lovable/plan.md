# Fatura não registrada: causa real e correção (competência, cartão único e categoria por histórico)

## O que aconteceu de fato

Rastreei os incidentes `4cc99521` e `b453f99d` (mesma falha, três tentativas às 15:55/15:56). A gravação foi bloqueada na etapa final de fechamento da fatura, com este resultado:

- total informado na fatura nova: **R$ 2.675,23**
- total conciliado pelo sistema: **R$ 7.314,23**
- diferença: **R$ 4.639,00**

Motivo: o documento novo (período 25/07 a 12/08) veio **sem mês de competência e sem data de vencimento**. Nesse caso a regra atual cai no mês corrente (agosto/2026), e agosto/2026 **já tem uma fatura registrada e paga** (R$ 4.636,08, itens somando R$ 4.639,00) vinda de outro documento. Os itens novos foram somados dentro daquela fatura antiga, o total explodiu e a conciliação reprovou. Como tudo roda em transação única, nada foi gravado — a mensagem "Nada foi gravado" está correta, mas o motivo exibido é genérico.

Sobre os outros dois pontos, confirmei nos dados:

- O usuário tem **um único cartão ativo**. O preenchimento hoje só acontece quando a fatura traz pista do nome do cartão; sem pista, o campo fica vazio e vira bloqueio.
- Turbi, Lovable e Eventim **já têm histórico categorizado** em lançamentos anteriores, mas o motor de categoria V2 só confia em preferências materializadas por merchant e **não existe nenhuma preferência gravada para esses estabelecimentos**. Por isso vieram como "Sem categoria · Precisa da sua validação".

## O que vou corrigir

### 1. Competência da fatura deixa de ser adivinhada pelo mês atual
- Quando o documento não trouxer competência nem vencimento, a competência passa a ser derivada do **ciclo do cartão** a partir do fim do período do documento (fechamento/vencimento do cartão), não do mês corrente.
- Nova guarda: se a fatura de destino já existe, está **paga ou fechada** e veio de **outro documento**, o fechamento não sobrescreve nada. Ele para antes de qualquer escrita e devolve motivo explícito.
- O total conciliado passa a ser verificado contra a origem: fatura com itens de outro documento nunca é reaproveitada silenciosamente.

### 2. Mensagem de erro honesta e acionável
Em vez de "A fatura não foi registrada / Nada foi gravado", o usuário vê o motivo real e a saída:
"Essa fatura seria lançada em agosto/2026, competência que já está registrada e paga (R$ 4.636,08). Confirme o mês de vencimento desta fatura para eu registrar." — com campos de **competência e vencimento editáveis** no cabeçalho da revisão e reprocessamento imediato.

### 3. Cartão único vem marcado por padrão
- Na leitura do documento: fatura de cartão sem pista de cartão, e o usuário tendo **exatamente um** cartão ativo, já grava esse cartão no item.
- Na tela de revisão: seletor do cabeçalho e dos itens já vêm preenchidos com o cartão único, sem exigir clique. Com dois ou mais cartões, continua pedindo escolha.

### 4. Categoria aprende com o histórico real
- Passa a existir uma consulta de **verdade pessoal por histórico**: para os estabelecimentos do documento, o sistema busca a categoria dominante dos lançamentos confirmados do próprio usuário e, quando há evidência consistente, materializa a preferência e aplica a categoria automaticamente.
- Aplica-se a "Turbi", "Lovable", "Eventim" e a qualquer merchant com histórico, mantendo o custo baixo (busca limitada aos merchants do documento).
- Sem histórico suficiente, mantém "precisa da sua validação" — nada de chute.

## Notas técnicas

- `finalize_invoice_statement`: competência derivada do ciclo do cartão (`credit_cards.closing_day`/`due_day`) quando `invoice_competence_month`/`invoice_due_date` são nulos; guarda de `status in ('paid','closed')` com `source_document_id` diferente retornando `error: 'statement_already_settled'` com competência e total; `activity_total` validado por origem dos itens.
- `confirm_invoice_import_atomic`: propaga o motivo estruturado em `DETAIL` para o contrato `edge_error.v1`.
- `assistant-review-actions`: mapeia `statement_already_settled` e `invoice_statement_failed` para mensagens específicas com valores; `update-document` já suporta ajustar competência/vencimento.
- `src/components/assessor/ReviewSheet.tsx`: cabeçalho com competência/vencimento editáveis, mensagem de falha específica, pré-seleção de cartão único.
- `supabase/functions/assistant-ingest-document/index.ts`: cartão único como fallback determinístico; nova etapa de preferência por histórico antes de deixar o item sem categoria.
- `supabase/functions/_shared/categorization/`: função de derivação de preferência pessoal a partir de transações confirmadas (mesmo tipo, merchant key normalizada, categoria dominante com mínimo de evidência), gravando em `user_merchant_preferences` para reuso.
- Sem mudança em autenticação, ledger canônico ou motores financeiros. Nada é gravado fora de transação.
- Testes: competência derivada do ciclo, bloqueio de fatura já paga com mensagem, cartão único preenchido, categoria herdada do histórico e não herdada quando o histórico é ambíguo. Depois, deploy de `assistant-ingest-document` e `assistant-review-actions`.

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES, reproduzindo a fatura de R$ 2.675,23 ponta a ponta até o registro.
