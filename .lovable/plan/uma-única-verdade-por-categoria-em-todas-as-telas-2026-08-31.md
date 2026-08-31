# Uma única verdade por categoria em todas as telas

## O que os dados mostram (verificado, não hipótese)

Transporte, agosto/2026, mesmo usuário, mesma categoria (existe só uma categoria "Transporte", não há duplicidade):

| Lente | Bruto | Líquido de estorno | Onde aparece hoje |
| --- | --- | --- | --- |
| Data do lançamento (`occurred_at`) | 1.197,55 | 983,62 | tela da categoria / lista de lançamentos considerados |
| Competência canônica (cartão pela fatura) | 2.603,92 | 2.389,99 | Nino / motor de metas |
| Relatório gravado em 31/08 19:29 | — | 1.603,76 (32 itens) | tela de Relatórios |

Três achados objetivos:

1. **O relatório na tela é resultado antigo, gravado por uma versão da função que ainda não tem a competência única.** O registro de agosto foi gerado às 19:29 de 31/08 e conta apenas 32 lançamentos em Transporte, quando o mês tem 61 por data de lançamento e 76 por competência. Enquanto a função não for atualizada e o período não for recalculado, a tela continuará mostrando um número que nenhum motor atual produz. Também há divergência de contagem em outras categorias do mesmo relatório (Alimentação 498,48 contra 1.450,63 reais), o que confirma que o dado gravado é de outra geração.
2. **A tela da categoria usa uma terceira lente.** A lista "Lançamentos considerados" e o filtro de período dessa tela somam por `occurred_at`, enquanto o cartão do teto acima dela já soma por competência. As duas leituras convivem na mesma tela.
3. **Ainda existem cópias do cálculo por categoria fora do núcleo canônico.** O breakdown mensal por categoria soma por `occurred_at`, e a função MCP tem uma reimplementação própria desse mesmo cálculo, colada dentro do arquivo. Cada cópia é uma verdade a mais.

## O que será feito

### 1. Uma lente única por categoria (P0)

- O breakdown mensal por categoria passa a usar a competência canônica (cartão pela fatura), igual ao motor de metas e ao de relatórios.
- A função MCP deixa de ter cálculo próprio e passa a consumir o núcleo canônico, eliminando a cópia.
- A tela de detalhe da meta por categoria passa a listar e somar exatamente os lançamentos que o teto considerou (mesma lente, mesmo período), exibindo a data de competência quando ela difere da data da compra.

### 2. Relatório sem número órfão

- Atualização das funções de relatório e do agente para a versão já implementada e testada, seguida de recálculo do período aberto — sem isso a tela continua exibindo o resultado da geração antiga.
- Relatório fechado guarda a versão de motor que o gerou; quando a versão gravada é anterior à atual, a tela avisa que o período precisa ser recalculado em vez de apresentar o número como verdade atual.

### 3. Inventário auditável de indicadores

- Documento único listando cada indicador exibido no produto (home, categorias, metas, relatórios, Nino, MCP), qual motor o produz e qual lente de data ele usa.
- Verificação estática ampliada: qualquer agregação nova por mês/categoria que não use a competência canônica falha na validação, e nenhum arquivo pode reimplementar cálculo já existente no núcleo.

### 4. Provas de convergência entre superfícies

- Teste com os dados reais do caso: Transporte em agosto precisa dar o mesmo valor em tela da categoria, meta, relatório, Nino e MCP.
- Teste de estorno e de compra de cartão de ciclo anterior nas cinco superfícies.
- Teste de que relatório com versão de motor antiga é sinalizado, não exibido como atual.

## Detalhes técnicos

- Alterados: `src/lib/engine/facts.ts` (`computeCategoryBreakdown` por `reportingCompetenceDate`) e espelho em `_shared/finance-core`, `supabase/functions/mcp/index.ts` (remoção da cópia local), `src/pages/MetaCategoriaDetalhe.tsx` (lista pela lente do teto), `src/lib/reports/intelligent/client.ts` + tela de relatório (aviso de versão), `scripts/check-tx-selects.mjs` (guarda ampliada), novo `docs/INDICADORES_E_LENTES.md`.
- Sem alteração de fórmula financeira e sem migração destrutiva; se for necessário gravar a versão do motor no relatório, entra uma coluna nova com valor padrão.
- Como o texto do agente já mudou na rodada anterior, o lote de atualização inclui as 9 funções de `DEPENDENTS.md`.

## Atualização de produção

Implementação e testes rodam localmente. **A atualização das funções (incluindo relatório e agente) só acontece com sua autorização explícita** — e é ela que faz o número 1.603,76 desaparecer da tela.

## Critérios de aceite

- Transporte em agosto mostra o mesmo valor na tela da categoria, na meta, no relatório, no Nino e no MCP.
- Nenhuma superfície soma por categoria fora da competência canônica.
- Nenhum cálculo por categoria duplicado fora do núcleo.
- Relatório gerado por motor antigo é sinalizado como "recalcular", nunca apresentado como atual.
