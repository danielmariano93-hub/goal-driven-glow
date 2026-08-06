# Entrega corretiva única — verdade financeira canônica, Home premium e pendências confirmadas

Base de trabalho verificada: HEAD = `dd8467c` ("Criou agenda canônica e integrou"), sem commits posteriores. Nada será revertido; a entrega completa o que já existe.

## Causas raiz confirmadas na inspeção (não presumidas)

- `src/lib/engine/metrics.ts:706-748`: a projeção é calculada **antes** da agenda. `knownFutureCommitments = plannedExpense + recurringOut` e `cardDueThisMonth` vem só de `currentStatement`. A agenda canônica só é construída na linha 791 e não alimenta a projeção — parcelas, dívidas e doações ficam fora do card de previsão.
- `src/lib/engine/cardExposure.ts:285-327`: sem fatura oficial a estimativa da competência vem apenas de transações do ciclo; parcelas programadas não entram na fatura estimada. Rótulos existentes são `official | estimated | none` (faltam `partial` / `unavailable`).
- `src/lib/hooks/useFinancialSnapshot.ts:237,275`: dívidas carregadas sem `installment_amount`, `due_day`, parcelas restantes; cartões carregados sem `name`.
- `src/components/home/RitmoUnificadoCard.tsx:37`: série desenha `netAmount` (atual e anterior), sem `typicalAmount` nem alternância; outliers comprimem a escala.
- `src/pages/Metas.tsx:61,146`: metas por categoria seguem escondidas atrás de `openCatList = false`; não há indicadores de topo.
- `src/components/CategorySelect.tsx:14`: `filterCategoryOptions` não ordena o resultado.
- `src/components/home/EmotionalCheckinCard.tsx:95-109`: grava `emotion_key` **e** `trigger_label = selected.key`, mantendo a mistura de conceitos.

## O que será implementado

### A. Projeção alimentada pela agenda canônica
Reordenar `computeFinancialSnapshot`: agenda antes da projeção. Projeção passa a consumir os totais deduplicados por tipo. Fórmula explícita: disponível hoje + entradas confirmadas + renda estimada elegível − compromissos conhecidos (agenda) − gasto variável projetado. Fatura nunca somada fora da agenda. `composition` expandida para: disponível hoje, entradas confirmadas, renda estimada, faturas oficiais, faturas estimadas, parcelas, recorrências, planejados, dívidas, doações, gasto variável, resultado. Competência recebida explicitamente (sem depender de `new Date()`), timezone America/Sao_Paulo. Espelho em `supabase/functions/_shared/finance-core/` via `scripts/sync-finance-core.mjs`. `PrevisaoFechamentoCard` exibe a composição em expansão com memória de cálculo.

### B. Faturas estimadas com parcelas
`cardExposure.ts`: por cartão e competência — fatura oficial manda e absorve parcelas/transações; sem oficial, estimativa = transações elegíveis do ciclo + parcelas da competência + ajustes, deduplicadas por transação/parcela/fatura/origem. Rótulos `official | estimated | partial | unavailable`. Fatura atual e próxima consideram parcelas conhecidas.

### C. Agenda canônica completa
Contrato de cada item com `id, sourceId, source, type, name, amount, dueDate, competence, accountId, cardId, categoryId, official, estimated, confidence, absorbedBy, evidence, dedupKey, formulaVersion`. Dedup por chave estrutural (não por descrição/valor). Loader passa a trazer `installment_amount`, `due_day`, parcelas restantes, saldo devedor e status das dívidas, e nome dos cartões. `Recorrencias.tsx` mostra itens derivados de cartão/dívida como leitura apenas. `ProximosCompromissosCard` usa o contrato ampliado. Insights e relatórios consomem a mesma agenda.

### D. "Antes de gastar" completo
`spendingSimulation.ts` recebe `amount, plannedDate, categoryId, paymentMethod, accountId?, cardId?, installments?` e retorna `formulaVersion, contractVersion, asOf, baseline, scenario, cashImpactDate, purchaseCompetence, statementCompetence?, categoryGoalImpact, commitmentsPreserved, verdict, confidence, assumptions, missingSources`. PIX/dinheiro/débito impactam caixa na data; cartão impacta categoria na compra e caixa no vencimento do ciclo real (`closing_day`/`due_day`), com parcelas distribuídas nas competências corretas. `Planejamento.tsx` exige valor, data, categoria, forma de pagamento e conta/cartão, com categorias ordenadas. Ferramenta equivalente no MCP/assistente alinhada.

### E. Ritmo de gastos
Padrão "Ritmo típico" com `typicalAmount` (atual e período anterior), outliers como marcadores separados, alternância para "Todos os gastos" com `netAmount`. Tooltip com data, gasto real, típico, anterior, diferença, reembolsos, atípico, motivo de exclusão e causa principal quando houver evidência.

### F. Alertas por dia da semana
Critérios estatísticos mantidos. Nova superfície de estado: aprendendo / dados insuficientes / padrão encontrado / alerta programado / nenhum padrão relevante, com ocorrências, janela, requisito faltante, dia, diferença, confiança e cobertura. Validação do pipeline fatos → padrão → oportunidade → política → entrega.

### G. Cards do Nino
Agrupamento semântico por `rootCauseKey`, `topicKey`, categoria, período e ação antes da renderização; um principal por grupo; apoio só com evidência/causa/ação/período novo. Modo compacto reduz corpo, evidências, feedback e CTAs (título + evidência + uma recomendação + uma ação), resto em expansão.

### H. Metas unificadas
Remoção do `openCatList`; filtros Todas / Financeiras / Categoria / Doação (+ Conjuntas). Indicadores de topo: "Impacto positivo estimado no mês" (economia projetada e valor guardado separados, doação nunca como ganho) e "Atingimento geral" com normalização explícita por tipo e tooltip por componente. Categoria usa projeção de fechamento, sem percentual negativo; reembolsos reduzem gasto pela semântica canônica.

### I. Meta de doação completa
Campos adicionais: fontes/categorias de receita elegíveis, categoria de destino, periodicidade, data inicial, data final opcional. Retorno com base elegível, meta até a data, meta mensal projetada, doado, restante, progresso e marcos. Percentual calculado só sobre as fontes escolhidas. Copy positiva, sem culpa.

### J. Ordenação de categorias
Comparador único `localeCompare("pt-BR", { sensitivity: "base" })` aplicado em `filterCategoryOptions` e reutilizado em `CategoryGoalForm`, `Planejamento`, seletores de Cartões e ad hoc. Preserva globais, pessoais, overrides e arquivada selecionada; arquivadas fora de novos registros.

### K. Registro emocional
Home grava `emotion_key` = emoção e `trigger_label = null` (só preenchido com causa real). Aba emocional separa emoção e contexto. Migration corretiva: preenche `emotion_key` apenas quando o valor antigo pertence ao catálogo/aliases, não converte texto livre, não apaga gatilhos legítimos, corrige registros migrados indevidamente. Novo candidato `emotional_checkin_due` (acesso recente, sem registro no dia local, preferências, horário silencioso, no máximo 1/dia, sem disparo na abertura, cancelamento após check-in, dedup por usuário+data) no catálogo e no pipeline.

### L. Desafios
Identificador canônico único (relação por ID com o catálogo; `slug` apenas externo), migration segura com backfill, constraint, índice único e estratégia de remoção do legado. RPCs de aderir (sem duplicar), atualizar progresso, concluir e abandonar somente desafio ativo, reentrada quando permitida, bloqueio de desafio de outro usuário e XP idempotente. `progress`, `current_progress`, `status`, `finished_at` e XP consistentes.

### M. Camada canônica compartilhada
`FinancialSnapshotService` (com espelho server) responsável por buscar, normalizar, deduplicar, calcular via `computeFinancialSnapshot` (sem novo motor) e expor qualidade, fontes ausentes e versões. `useFinancialSnapshot` torna-se invólucro fino. Home, Relatórios, Nino, MCP, alertas e simulador em paridade. Sem cutover para `financial_current_snapshots`/`financial_daily_facts` (vazias): cálculo sob demanda.

### N. Home premium
Hierarquia: saudação, período, disponível hoje, previsão, ritmo típico comparado, próximos compromissos, insight prioritário, próxima ação, check-in emocional, atalhos. Card principal com roxo profundo luminoso (gradiente oficial), secundários neutros, raio 20–24px, borda sutil, sombra discreta, padding 16–20px, tipografia refinada, densidade compacta, mobile-first, identidade oficial preservada. Tooltips obrigatórios (disponível, guardado, ritmo atual/típico, comparação, atípicos, previsão, confiança, fatura oficial/estimada, compromissos, impacto das metas, % geral) explicando significado, período, fórmula, inclusões, exclusões, confiança, fontes ausentes e última atualização.

## Migrations previstas
1. Correção do registro emocional (`emotion_key` seletivo + limpeza de `trigger_label` migrado indevidamente).
2. Meta de doação: fontes elegíveis, categoria destino, periodicidade, datas, com GRANTs e RLS.
3. Desafios: identificador canônico, backfill, constraint, índice único e RPCs.
4. `emotional_checkin_due` no catálogo/dedup de comunicação.

## Validação e publicação
Toda a matriz de testes da solicitação (projeção via agenda, fatura estimada com parcelas, dedup, dívida na agenda, PIX/débito/cartão antes e depois do fechamento, parcelamento entre competências, impacto de categoria, ritmo típico/outlier/toggle, alertas em aprendizado e elegíveis, dedup Nino, metas e indicadores, doação fixa e percentual, reembolsos, acentos, emoção/gatilho, backfill, lembrete, ciclo de desafios, XP idempotente, sem dados, dados parciais, timezone, paridade). Depois: vitest, typecheck, build, lint dos arquivos alterados, sync do finance-core, bundle MCP, migrations e RPCs, verificação visual mobile. Correção do teste falhando em `nino-admin-journey-contract.test.ts`. Nenhuma publicação durante o desenvolvimento; uma única publicação final do frontend com republicação apenas das Edge Functions alteradas, seguida de evidência do commit ativo e da Home autenticada.

Ao final, resposta com resumo executivo, causas raiz, matriz de rastreabilidade (Concluído ou Bloqueado, sem status intermediário), arquivos, migrations, RPCs, contratos, fórmulas, resultados individuais de testes/build/typecheck/lint, Edge Functions implantadas, commit final e evidências.
