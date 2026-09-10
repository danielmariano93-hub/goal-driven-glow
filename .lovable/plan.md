# Correção E2E dos Relatórios + blindagem contra desalinhamento de schema

## O que está acontecendo (confirmado nesta auditoria)

- A geração de relatório está falhando com erro de servidor. A consulta de parcelas de cartão pede um campo (`installments_total`) que **não existe** na tabela de parcelas — confirmei a lista real de colunas no banco.
- Registros de falha encontrados: 06/09 (4 ocorrências), 10/09 09:12 local (2 ocorrências) — todas com exatamente essa mensagem.
- O relatório de "mês em andamento" mais recente é de **02/09** (por isso a tela mostra "setembro até 02/09").
- O trabalho automático semanal rodou em **07/09 10:00 UTC** com `processed = 0`, `failed = 7`, `last_ok = false`, motivo `partial_user_failures`. **Não confirmei ainda** que a causa dos 7 é a mesma falha de campo — não há registro de incidente naquele horário, então isso será investigado antes de qualquer correção adicional.
- Todos os 36 relatórios existentes estão gravados com versão financeira `finance_contract.v2` (valor padrão da tabela), enquanto os motores atuais estão em `finance_contract.v4` — a versão financeira nunca é gravada explicitamente na criação.
- Baseline saudável, a preservar: saldos atuais, diagnóstico, conversas do Nino, WhatsApp, lembretes e importação de documentos estão operando sem erro.

## Correções

### 1. Causa raiz (sem inventar coluna no banco)
Alinhar a consulta de parcelas ao contrato canônico de cartão: remover o campo inexistente e **passar a trazer os campos que o motor realmente usa e hoje não são carregados** — em especial os dois que evitam contar a mesma parcela duas vezes (parcela já absorvida por fatura e parcela que já existe no histórico antigo). Sem eles a função voltaria a responder, mas com número errado.

Mesma auditoria para faturas: incluir os campos de saldo em aberto e diferença de conciliação, hoje ausentes.

### 2. Contrato de projeção testável
Extrair as listas de campos para um contrato único compartilhado entre consulta e motor, e criar testes que falham quando: um campo não existe no banco, um campo exigido pelo motor não é carregado, ou um campo é renomeado. Esse teste, se existisse, teria barrado este incidente.

### 3. Versões corretas gravadas
Gravar explicitamente, em cada relatório novo, a versão financeira, a de catálogo de insights e a de template, todas a partir de uma fonte única de constante. Ajustar o padrão da coluna no banco para não mentir mais.

### 4. Erro deixa de ser invisível
Enriquecer o registro de falha com etapa, consulta que falhou, tipo e período do relatório, código sanitizado e se é reexecutável. A mensagem ao usuário continua igual. Manter a regra atual: **falha de consulta nunca vira lista vazia**.

### 5. Os quatro tipos de relatório
Validar de ponta a ponta última semana, último mês, mês em andamento e período escolhido — nenhum pode falhar. Regerar o mês corrente atualizando o relatório parcial existente (sem criar duplicado), com início 01/09 e fim na data de hoje.

### 6. Trabalho semanal
Investigar os 7 usuários que falharam, executar em modo de simulação, e só então refazer de forma idempotente os relatórios semanais que deixaram de existir — sem duplicar relatório, aviso no app ou mensagem no WhatsApp para quem já recebeu.

### 7. Paridade com as verdades canônicas
Comparar receitas, despesas, resultado, categorias, média diária, estornos, compras de cartão por competência, fatura em aberto, parcelas futuras, saldo em contas, metas e comparação com período anterior contra os motores que a Home e o Nino usam. Metas usam a mesma semântica canônica de progresso, não uma paralela.

### 8. Cartões — casos de teste obrigatórios
Fixtures para fatura aberta, paga, parcialmente paga, parcela futura, parcela absorvida, parcela vinda do histórico antigo e fatura marcada para revisão. Provar: nada contado duas vezes, fatura paga = obrigação zero, parcela absorvida não volta como futura, saldo em aberto correto.

### 9. Auditoria de desalinhamento nas demais funções (somente leitura)
Comparar os campos consultados contra as colunas reais nas áreas críticas: relatórios, saldos, conversas do Nino, diagnóstico, insights, proatividade/antecipação, agenda de compromissos, dívidas, cartões, divisão do rolê, importação de documentos, categorização e envio de WhatsApp. Entregar matriz Subsistema / Saudável ou Quebrado ou Risco / Causa / Evidência / Ação. **Onde estiver saudável, não altero nada.**

### 10. Visibilidade operacional
Fazer o painel operacional sinalizar claramente trabalho automático com falha total (0 processados / 7 falhas), erro repetido na mesma função e ausência de relatório esperado.

### 11. Regressões a garantir
Dívidas: paga não alerta, vence hoje ≠ atrasada, próximo vencimento correto, sem mensagem repetida. Tela de relatórios: abrir antigo e novo, CSV, impressão, exclusão e marcar como visto.

## Detalhes técnicos

- `supabase/functions/financial-reports-generate/index.ts` → `loadContext()`: corrigir projeções de `credit_card_installments` (remover `installments_total`; incluir `legacy_transaction_id`, `absorbed_by_statement_id`, `due_date`) e de `credit_card_statements` (incluir `outstanding_amount`, `reconciliation_difference`).
- Contrato de projeção novo em `supabase/functions/_shared/finance-core/` (ou `reports-core`), consumido pelo loader; teste de contrato consultando `information_schema.columns` + campos exigidos por `CardStatementRow` / `CardInstallmentRow` de `cardExposure.ts`.
- Persistir `finance_contract_version` a partir de `FINANCE_CONTRACT_VERSION`; migration só para ajustar o default da coluna (nenhuma coluna nova, nenhum dado financeiro alterado à mão).
- Lote semanal: `financial_reports_weekly_tick()` → função em modo batch (linhas ~520-600); backfill idempotente pela chave de idempotência já existente.
- Nada é publicado em produção sem sua autorização explícita; o redeploy segue o contrato atômico de `DEPENDENTS.md` quando `_shared` mudar.

## Entrega final
Relatório com as seções A) causa raiz, B) os quatro tipos com período e status, C) campos de cartão antes/depois, D) trabalho semanal antes/depois, E) matriz de auditoria, F) testes (total, novos, resultado), G) confirmação de produção.
