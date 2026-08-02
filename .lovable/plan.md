# Relatórios Inteligentes: dados reais nos highlights + insights integrados

## Diagnóstico confirmado (verificado em código e banco)

A causa raiz do "75,4% das despesas estão sem categoria" está na Edge Function `financial-reports-generate` (linha 55):

```
sb.from("categories").select("id,name").eq("user_id", userId)
```

Ela busca **apenas categorias próprias do usuário** e ignora as **categorias globais** (`user_id IS NULL`). Quando o motor não encontra o nome da categoria, o lançamento cai em "Sem categoria".

Evidência no banco (julho/2026, usuário principal):
- 175 despesas no período, **0 com `category_id` nulo** e **0 órfãs**.
- Dos `category_id` usados: **164 lançamentos apontam para categorias globais** (`user_id IS NULL`, 13 categorias) e apenas 38 para categorias próprias (10 categorias).
- O relatório gravado (`financial_report_highlights`) registra `uncategorized` com `count: 155`, `total: 11.411,75`, `share: 75.37` — exatamente o efeito de perder os nomes das globais.
- A tela de Lançamentos usa `useCategories()` **sem filtro de `user_id`** (a RLS já devolve próprias + globais), por isso mostra corretamente ~6 sem categoria. Ou seja: divergência de fonte de nomes, não de dados.

Todas as outras funções (`insights-generate`, `assistant-ingest-document`, `_shared/engine/metrics.ts`, tools do agente) já usam `or(user_id.eq.X,user_id.is.null)`. A função de relatórios é a única fora do padrão.

Consequências em cadeia (todas resolvidas pela mesma correção): a "Maior categoria", a concentração por categoria, o split essencial vs. flexível, as flags de qualidade de dados e a **nota de saúde** (componentes `composition` e `data_quality`) estavam todos distorcidos, além da narrativa da IA que se baseia nesses números.

## O que será feito

### 1. Fonte única de nomes de categoria (correção da causa raiz)
- Em `financial-reports-generate/index.ts`: trocar o filtro por `or("user_id.eq.<uid>,user_id.is.null")`, sem filtro de `archived_at` (lançamentos históricos mantêm o rótulo).
- Adicionar teste de regressão garantindo que uma transação com categoria global não seja classificada como "Sem categoria".
- Revisão dos demais consumidores de nome de categoria para confirmar o padrão único (incluindo `supabase/functions/mcp/index.ts`, que hoje seleciona categorias sem escopo explícito).

### 2. Regeneração dos relatórios já gravados
Os relatórios existentes contêm números errados persistidos. Serão regenerados:
- A função ganha modo `force` (regenerar sobrescrevendo métricas/highlights do mesmo período em vez de retornar o relatório em cache).
- Execução única de regeneração dos relatórios semanais/mensais já existentes, para que o histórico da tela passe a exibir dados corretos.
- Na tela de detalhe, botão "Atualizar dados deste relatório" (regenera o período), útil quando o usuário categoriza lançamentos depois da geração.

### 3. Highlights alimentados também pelos insights já prontos
Hoje os highlights vêm só de `reports/intelligent/highlights.ts` (13 detectores de período). O `insights_catalog.v1` (17 detectores em `_shared/insights/detectors.ts`: fatura vencendo, dívida vs. renda, pressão de parcelas futuras, projeção de caixa, compromissos de 7 dias, anomalia de valor, peso de assinaturas, comerciante recorrente, ritmo de gastos, risco financeiro, próxima melhor ação etc.) não é aproveitado.

Integração:
- A função de relatórios passa a montar os sinais determinísticos e executar `deterministicCandidates(...)` do catálogo de insights, reaproveitando o mesmo código já usado pela Home/WhatsApp (nada duplicado).
- Os candidatos são convertidos para o contrato de highlight (tipo risco/conquista/oportunidade/leitura, prioridade, evidência, CTA) e **mesclados** com os detectores de período, com deduplicação por família (um highlight por família: cartão, dívidas, caixa, assinaturas, ritmo, categorização) e ordenação por prioridade.
- O limite sobe de 5 para até 8 highlights, mantendo no máximo 1 por família para não repetir leitura.
- Cada highlight mesclado carrega `source` ("periodo" ou "catalogo") e a evidência numérica original — o guardrail numérico continua validando a narrativa da IA contra esses números.
- A UI (`ReportHighlightList`) ganha agrupamento por tipo e o rótulo de origem discreto, sem mudar a identidade visual.

### 4. Verificação antes de considerar concluído
- Consulta de conferência comparando, para o mesmo período: total de despesas, contagem sem categoria e top categorias — banco vs. relatório gerado vs. tela de Lançamentos. O highlight `uncategorized` só deve aparecer se realmente houver ≥10% sem categoria.
- Sincronização do core (`scripts/sync-finance-core.mjs`) para manter o espelho das Edge Functions.
- Suíte de testes completa + validação no preview da tela de relatórios (histórico e detalhe).

## Detalhes técnicos

- Arquivos afetados: `supabase/functions/financial-reports-generate/index.ts` (fonte de categorias, modo `force`, merge de insights), `src/lib/reports/intelligent/highlights.ts` + espelho `supabase/functions/_shared/reports-core/highlights.ts` (merge/dedup por família, limite 8), `src/lib/reports/intelligent/types.ts` (campos `source`/`family`), `src/lib/reports/intelligent/client.ts` e `src/pages/RelatorioInteligenteDetalhe.tsx` (ação de atualizar), `src/components/relatorios/ReportHighlightList.tsx`, testes em `src/test/reports-intelligent.test.ts`.
- Sem mudança de schema: `financial_report_highlights` já possui `detector_key`, `evidence`, `priority` e `dedup_key`. Se o rótulo de origem exigir persistência, ele vai dentro de `evidence` (nenhuma migration necessária).
- Deploy: apenas `financial-reports-generate` precisa de deploy; frontend publicado somente após sua autorização explícita.
