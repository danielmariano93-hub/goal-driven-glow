# Product Regression Hardening — Meu Nino

Objetivo: eliminar a classe de bug "corrigimos A e quebramos B sem perceber". Nada de fórmula financeira, nada de IA, nada de reverter performance.

## O que a auditoria já confirmou no código atual

Verificado nesta rodada (leitura de código, sem alterações):

- `src/App.tsx` declara ~45 rotas em `/app`. `BottomTabBar`, `MaisMenu` e `DesktopSidebar` mantêm **três listas manuais independentes** — nenhuma deriva de fonte comum.
- Rotas funcionais **sem nenhum ponto de entrada de menu**: `/app/compromissos`, `/app/cobrancas`, `/app/notificacoes`, `/app/metas-conjuntas`, `/app/planejamento` (só no desktop), `/app/whatsapp`, `/app/nino-hub`, `/app/nino-contexto`, `/app/antecipacoes/detalhe`, `/app/assessor`.
- Divergência mobile × desktop real: o `DesktopSidebar` não oferece Cartões, Recorrências, Relatórios, Divisão do Rolê, Desafios, Importar, Plano, Metas Conjuntas — todos existem no `Mais` do mobile. No desktop essas telas ficam inacessíveis por navegação (só por URL), porque o `Mais` é `md:hidden` na tab bar e não há item "Mais" no sidebar.
- `BottomTabBar.isActive("/app/mais")` usa uma lista manual de 15 prefixos; ela **não inclui** `/app/metas-conjuntas`, `/app/compromissos`, `/app/notificacoes`, `/app/whatsapp` → aba nenhuma fica ativa nessas telas.
- Metas por categoria: a correção já está no runtime — `supabase/functions/home-snapshot/index.ts` consulta categorias com `or(user_id.eq.<id>,user_id.is.null)` (globais incluídas), usa `CONTRACT = "home_snapshot.v3"`, valida `materialized.contract_version === CONTRACT` e a chave de cache é `home_snapshot_v3|...`. O app (`Metas.tsx`, `MetaCategoriaDetalhe.tsx`) resolve nome via `useCategories()`. Ou seja: **a regressão está corrigida; falta blindagem e observabilidade** (hoje `CategoryGoalCard` cai em `"Categoria"` silenciosamente).
- Janelas de ledger em uso: Cartões `back 2/ahead 2`, Metas `3/1`, MetaDetalhe `3/0`, MetaCategoriaDetalhe `3/1`. Precisam ser auditadas contra o que cada cálculo exige (baseline de 3 meses de meta por categoria com janela de 3 meses é limítrofe).
- Não existe nenhum teste de navegação/rota, nem smoke de produto: `src/test` tem 200+ testes de motor, e `category-goal-name.test.ts` cobre só o rótulo.

## Tabela 1 — Achados

| ITEM | ESTADO ATUAL | PROBLEMA | CAUSA RAIZ | CORREÇÃO | RISCO |
|---|---|---|---|---|---|
| Nome da categoria na meta (P1, já corrigido) | v3 ativo, globais incluídas | fallback ainda esconde falha futura | contrato sem invariante | invariante + telemetria `category_name_missing` | baixo |
| 3 listas de navegação (P1) | manuais e divergentes | feature some do menu sem ninguém notar | sem fonte única | `appNavigationRegistry.ts` | baixo |
| Desktop sem Cartões/Relatórios/etc. (P1) | inacessível por navegação | perda de acesso funcional | sidebar com lista própria | sidebar derivado + grupo "Mais" no desktop | baixo |
| Active state do "Mais" (P2) | lista manual incompleta | aba sem destaque | active paths hardcoded | derivar `activePaths` do registry | baixo |
| Rotas órfãs (P2) | 10 rotas sem entry point | funcionalidade esquecida | sem classificação | classificar cada uma (`primary/secondary/detail/deep_link/internal`) | baixo |
| Contrato de snapshot (P1 preventivo) | só home-snapshot valida | outros read models podem servir payload de contrato antigo | validação local | helper `assertSnapshotContract` reutilizável | médio |
| Janela do ledger (P1 a confirmar) | 2–3 meses por tela | cálculo com baseline maior pode subestimar | otimização sem contrato de janela | declarar janela mínima por consumidor | médio |
| Relatórios (P2 a confirmar) | `RelatoriosInteligentes` substituiu `RelatoriosHub` | possível perda de exportação/CSV/impressão/histórico | troca de rota | diff funcional documentado; restaurar o que faltar na UX nova | médio |
| Ausência de smoke/contract test (P1) | inexistente | regressão silenciosa reincide | sem rede de proteção | suíte `product-regression-*` | baixo |

## Tabela 2 — Módulos (estado inicial; preenchida por completo na Fase 1)

| MÓDULO | MOBILE | DESKTOP | ROTA | DADOS | TESTES |
|---|---|---|---|---|---|
| Home | tab | sidebar | /app | snapshot v3 + read model | motor sim / UI não |
| Movimentos | tab | sidebar | /app/lancamentos | ledger | parcial |
| Metas | tab | sidebar | /app/metas | ledger 3/1 + catálogo | parcial |
| Metas por categoria | via Metas | via Metas | /app/metas/categoria/:id | ledger + catálogo | rótulo só |
| Metas conjuntas | órfã | órfã | /app/metas-conjuntas | RPC | não |
| Cartões | Mais | **ausente** | /app/cartoes | ledger 2/2 | motor sim |
| Contas | Mais | sidebar | /app/contas | ledger + âncoras | motor sim |
| Categorias | Mais | sidebar | /app/categorias | catálogo | sim |
| Dívidas | Mais | sidebar | /app/dividas | RPC | sim |
| Investimentos | Mais | sidebar | /app/investimentos | RPC | sim |
| Relatórios | Mais | **ausente** | /app/relatorios | read model | motor sim |
| Recorrências | Mais | **ausente** | /app/recorrencias | catálogo | parcial |
| Emocional | Mais | sidebar | /app/emocoes | RPC | parcial |
| Desafios | Mais | **ausente** | /app/desafios | RPC | parcial |
| Divisão do Rolê | Mais | **ausente** | /app/divisao-do-role | RPC | sim |
| Planejamento | **ausente** | sidebar | /app/planejamento | simulador | sim |
| Importação | Mais | **ausente** | /app/importar | pipeline | sim |
| Perfil | Mais | sidebar | /app/perfil | perfil | parcial |
| Plano | Mais | **ausente** | /app/plano | billing | não |
| Nino | FAB | **sem FAB** | /app/nino | agente | sim |
| Notificações / Cobranças / Compromissos | órfãs | órfãs | — | RPC | não |

## Fases de implementação (uma rodada)

**FASE 1 — Navigation registry**
`src/lib/navigation/appNavigationRegistry.ts`: uma entrada por rota de `/app` com `id, path, label, icon, group, navigationType, mobilePlacement, desktopPlacement, activePaths, parentId, featureStatus`. `BottomTabBar`, `MaisMenu` e `DesktopSidebar` passam a derivar dessa fonte. Active state calculado por `activePaths`/`parentId`, sem lista manual.

**FASE 2 — Regressões confirmadas**
Desktop ganha acesso coerente (grupos derivados + hub "Mais" no sidebar) e entrada para o Nino. Mobile ganha Planejamento no `Mais`. Rotas órfãs recebem classificação explícita e, quando forem `secondary`, entry point (Notificações e Cobranças pelo header/Mais; Compromissos e Metas Conjuntas dentro de Metas; `nino-hub`, `nino-contexto`, `whatsapp`, `assessor`, `antecipacoes/detalhe` marcadas como `internal`/`deep_link`).

**FASE 3 — Contratos de read model**
`src/lib/db/snapshotContract.ts` com `assertSnapshotContract(payload, expected)`: contrato incompatível nunca é servido como fresh (marca stale → recomputa → fallback seguro). Tipos explícitos nas fronteiras (snapshot da Home, `finance-derived`, performance) e invariantes de negócio: `category_id` válido ⇒ `categoryName` presente; caso contrário fallback neutro + violação registrada.

**FASE 4 — Invalidação e janelas**
Auditar `INVALIDATION_SCOPES` por domínio (categoria alterada precisa derrubar metas por categoria e relatórios; lançamento categorizado precisa derrubar Home + metas + relatórios) e declarar a janela mínima de cada consumidor de `useLedgerWindow`, subindo somente onde o cálculo exigir — sem voltar a baixar ledger inteiro.

**FASE 5 — Observabilidade leve**
Contador de violações de contrato (`snapshot_contract_mismatch`, `category_name_missing`, `missing_account_name`, `missing_card_name`, `read_model_missing_required_field`), sem valores financeiros, exposto na área técnica de admin já existente — sem nova página.

**FASE 6 — Testes**
- `product-navigation-contract.test.ts`: toda rota de `App.tsx` existe no registry; todo item de menu aponta para rota válida; todo `activePath` é rota ou prefixo válido; `detail` tem parent; `deep_link` explícito; nenhuma rota `primary/secondary` sem entry point.
- `product-regression-smoke.test.tsx`: Home, Movimentos, Metas, Metas por categoria, Cartões, Contas, Categorias, Dívidas, Investimentos, Relatórios, Mais, Nino renderizam com dados mockados e **mostram o dado crítico** (nome da categoria/cartão/dívida/conta/meta, valor, data, período), sem `undefined` visível e sem fallback genérico quando o dado existe.
- Casos obrigatórios A–I, incluindo snapshot v2 rejeitado como v3 e efeitos laterais entre módulos (categoria → Home/Metas/Relatório; lançamento → Home/Movimentos/Meta por categoria).
- Diff funcional `RelatoriosHub` × `RelatoriosInteligentes` documentado em `docs/`; o que tiver sido perdido sem intenção volta na UX atual (sem segunda tela).

**FASE 7 — Validação**
`vitest run` completo, `npm run test:perf-arch`, build, e conferência de preview em mobile e desktop.

## Fora de escopo (explícito)

Fórmulas financeiras, motores de IA, Hot Path V3/Performance V2, orçamentos e circuit breakers de IA. Qualquer problema financeiro encontrado será documentado, não alterado.
