# Entrega única: verdade financeira canônica, agenda de compromissos, metas, emocional e desafios

## O que foi confirmado na inspeção (causas raiz reais)

- O motor canônico existe (`src/lib/engine/metrics.ts`, `financial_snapshot_contract.v7`, espelho em `supabase/functions/_shared/finance-core`), mas **quem carrega os dados é cada tela**. `useFinancialSnapshot` monta um conjunto; a página "Antes de comprar" (`src/pages/Planejamento.tsx`) monta outro, muito menor, e chama o caminho legado `computeBeforeSpending` sem cartões, snapshots de saldo, faturas nem recorrências (`recurring: []`). Daí o saldo divergir da Home.
- `computeUpcomingCommitments(input.recurring, input.txs, 30)` recebe apenas recorrências e transações. Faturas de cartão, parcelas de cartão e parcelas de dívida ficam fora da agenda e, por consequência, fora do card "Próximos compromissos" e da previsão.
- `user_challenges` no banco tem apenas `id, user_id, challenge_id, status, progress, started_at, finished_at`, com enum `joined | completed | abandoned`; o frontend chama `supabase.rpc("join_challenge")` e **essa função não existe no banco** (nenhuma rotina com "challenge"). Além disso o catálogo usado na tela é `challenges_catalog` (slug), enquanto a FK aponta para `challenges`. Adesão falha por isso.
- `emotional_checkins` tem `mood` e `trigger_label`, sem campo próprio de emoção — confirma a mistura de conceitos entre Home e aba Emocional.
- `category_spending_goals` e `goals` são tabelas separadas sem tipo de meta de doação; não existe coluna/estrutura para meta percentual sobre receitas elegíveis.

## Arquitetura da entrega

### A. Camada única de carregamento (`FinancialSnapshotService`)
- Novo módulo `src/lib/finance/snapshotService.ts` (+ espelho server em `supabase/functions/_shared/finance-core/loader.ts`) responsável por: buscar todas as fontes, normalizar, deduplicar, preservar origem/confiança, executar o motor puro e devolver o contrato com `contractVersion`, `formulaVersion`, competência, `generatedAt`, `missingSources`, `assumptions`.
- `useFinancialSnapshot` passa a ser um invólucro fino desse serviço. Home, Relatórios, Nino, Metas, Recorrências, Antes de gastar, alertas e MCP consomem o mesmo retorno.
- Timezone `America/Sao_Paulo` centralizado; cálculo monetário em centavos na camada de cálculo.
- Motor permanece puro e determinístico.

### B. Agenda canônica de compromissos (`CommitmentAgenda`)
- Novo módulo no motor consolidando faturas, parcelas de cartão, regras/ocorrências recorrentes, transações planejadas e parcelas de dívida, com `id` estável, tipo, origem, valor, vencimento, competência, conta/cartão, categoria, confiança, oficial vs estimado, `absorvedByStatement` e evidência.
- Deduplicação por fatura/parcela/transação: parcela absorvida por fatura oficial não é somada duas vezes.
- Substitui `computeUpcomingCommitments`. Recorrências exibem itens derivados de cartão em modo somente leitura.

### C. Previsão de fechamento
- Composição explícita: disponível hoje + receitas confirmadas + receitas estimadas elegíveis − compromissos conhecidos − fatura a vencer − gasto variável projetado.
- Precedência de cartão: fatura oficial manda; sem fatura oficial, estimativa por ciclo (transações elegíveis + parcelas da competência), marcada como oficial / estimada alta / parcial / indisponível.
- Aceita competência explícita, não só o mês corrente.
- Card com detalhamento expansível e memória de cálculo.

### D. Gráfico de ritmo
- Série padrão `typicalAmount`, comparação com período anterior, alternância "Ritmo típico" / "Todos os gastos", marcação de dias atípicos, escala robusta e tooltip com real, típico, diferença, motivo da exclusão e comparação.

### E. Antes de gastar (reescrita)
- Novo serviço `simulateSpending` com entrada `amount, plannedDate, categoryId, paymentMethod, accountId?, cardId?`, cenário-base = snapshot canônico.
- Débito/PIX/dinheiro impactam caixa na data prevista; cartão impacta categoria na compra e caixa no vencimento da fatura do ciclo correto.
- Retorna disponível antes/depois, fechamento antes/depois, data do impacto, impacto e meta de categoria (realizado, projeção, % antes/depois, restante, risco), compromissos preservados, premissas, fontes ausentes, confiança e versões.
- `computeBeforeSpending` legado removido dos consumidores.

### F. Alertas de padrão por dia da semana
- Limiares mantidos. Nova superfície de estado: aprendendo / dados insuficientes / padrão encontrado / alerta programado / nenhum padrão relevante, com ocorrências analisadas, requisito faltante, dia analisado, diferença e confiança.

### G. Cards do Nino
- Agrupamento semântico por causa raiz/tema/categoria/período/ação antes da renderização; um card principal por grupo; densidade real no modo compacto; detalhes em expansão.

### H. Metas unificadas + meta de doação
- Visão única com filtros Todas / Financeiras / Categoria / Doação, topo com "Impacto positivo estimado no mês" e "Atingimento geral".
- Fórmulas: financeira `min(acumulado/alvo,100%)`; categoria via gasto projetado (100% se dentro do limite, aderência proporcional sem negativo); doação `doado/alvo`.
- Geral = média normalizada explicável, tooltip com cada componente, fórmula e tipos sem dados.
- Impacto positivo separa economia projetada e valor guardado — sem chamar de "ganho real"; doação nunca entra como ganho.
- Nova estrutura de meta de doação: valor fixo ou percentual da receita, categorias/fontes elegíveis, categoria de destino, periodicidade mensal ou intervalo, data final opcional; retorna base elegível, meta, doado, restante, % e próximo marco.
- Reembolsos corrigidos via função comportamental canônica.

### I. Ordenação de categorias
- Função compartilhada única com `localeCompare("pt-BR", { sensitivity: "base" })`, arquivadas fora das opções, regras global/pessoal preservadas; implementações locais removidas.

### J. Registro emocional
- Catálogo compartilhado de emoções para Home e aba Emocional; nova coluna `emotion_key`; `trigger_label` volta a ser só contexto/gatilho; migração com backfill seguro dos registros gravados pela Home.
- Candidato de comunicação `emotional_checkin_due` com data local, ausência de registro no dia, atividade recente, preferências, horário silencioso, no máximo um por dia, sem disparo imediato à abertura e sem disparo após registro.

### K. Desafios (correção do contrato)
- Contrato canônico alinhado ao banco (`joined | completed | abandoned`, `progress`, `started_at`, `finished_at`), catálogo único, migração idempotente, RPCs de adesão/progresso/conclusão/abandono com `auth.uid()`, RLS, GRANTs, tipos regenerados e frontend reescrito sem `as any`.

### L. Snapshots e fatos canônicos
- Auditoria de quais tabelas são só backfill e quais são de produção; sem cutover cego. Cálculo sob demanda pelo loader compartilhado como caminho padrão; persistência só após paridade comprovada. Testes de paridade Home / MCP / Nino / alertas / Antes de gastar.

### M. Home premium e tooltips
- Direção visual atual preservada (hero com gradiente roxo, cards neutros, linhas suaves, densidade alta). Tooltips com memória de cálculo em disponível hoje, guardado, ritmo atual/típico, variação, previsão, confiança, compromissos, impacto de metas, % geral, gastos atípicos e oficial vs estimado, sempre com período, atualização e fontes ausentes.

### N. Contratos e confiabilidade
- Cada contrato novo com nome/versão, tipagem compartilhada, validação de entrada e saída, premissas, fontes ausentes, evidências, competência e versões. Tipos sincronizados via `scripts/sync-finance-core.mjs`. Zero nunca substitui fonte ausente: estado parcial ou indisponível.

## Migrações previstas
1. `emotional_checkins.emotion_key` + backfill + índice de unicidade diária por usuário.
2. Estrutura de metas de doação (tipo, base percentual, fontes elegíveis, categoria destino, periodicidade) com GRANTs e RLS.
3. Correção idempotente do subsistema de desafios (catálogo, constraint de status, RPCs, GRANTs, RLS).
4. Suporte a `emotional_checkin_due` no catálogo/dedup de comunicação.

## Testes
Toda a matriz do pedido: fatura oficial com parcelas, ausência de fatura, deduplicação, fatura vencendo no mês, compra antes/depois do fechamento, débito, paridade Antes de gastar × Home, metas de categoria antes/depois, reembolso, gasto atípico, alternância de série, comparação de período, alertas sem e com evidência, dedup de cards Nino, três tipos de meta, doação percentual, ordenação com acentos, catálogo emocional, lembrete uma vez ao dia, ciclo completo de desafios, paridade entre consumidores, timezone, usuário sem dados e com dados parciais. Build, lint, typecheck e vitest ao final.

## Observações
- Nada será publicado; a entrega final vem com resumo executivo, causas raiz, arquivos, migrações, contratos, fórmulas, legados removidos, resultados de testes/build e evidências de paridade.
- Migrações passam pela sua aprovação no momento da execução.
