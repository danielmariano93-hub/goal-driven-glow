
Plano completo gravado em `.lovable/plan.md` (19 seções, ~1.100 linhas). Resumo executivo abaixo — o documento é a fonte canônica.

## Causa raiz confirmada
- `/admin/operacao/saude` e `/admin/operacao/ia-ocr`: RPCs exigem `_require_perm('ops.read')`, mas em `platform_permissions` existe apenas `operations.read`. Owner incluído — `42501` para todos os papéis.
- `/admin/operacao/whatsapp`: RPC exige `whatsapp.read`, ausente da tabela (só existe `whatsapp.critical`).
- `/admin/crescimento` e `/admin/governanca/auditoria`: permissões (`growth.read`, `audit.read`) existem e o owner as tem. `Promise.all` em Crescimento mascara qual chamada falhou. Causa exata **não confirmada** — tarefa #1 da execução será reproduzir com Playwright autenticado como owner e capturar o erro real antes de propor patch.

## Ruptura de vocabulário (menu vs backend)
Menu usa `overview.read`, `product.read`, `users.read`, `agent.read` (Mensageria), `security.read` (Auditoria), `ops.read`. Backend exige `cockpit.read`, `growth.read`, `product_intel.read`, `clients.read`, `messaging.read`, `audit.read`, `operations.read`. Plano padroniza um único vocabulário canônico (22 ações) e faz o menu ser **derivado 100% de `usePlatformPermissions()`**; matriz local vira apenas tipagem.

## Migrations planejadas (sem SQL executado)
M1 permissões canônicas (inclui `whatsapp.read`, `clients.identity.read`, `clients.identity.masked`) · M2 renomear gates dos 3 RPCs quebrados · M3 revogar `EXECUTE` a `PUBLIC`/`anon` nos 15 RPCs admin · M4 três RPCs separados para Clientes (pseudonimizado / identificado / mascarado) · M5 auditoria por chamada identificada · M6 recomputo do funil sem passos órfãos · M7 rebuild de coortes semanais.

## Frontend — redesign real (não “mínimo funcional”)
- Novos primitivos: `AdminSectionSkeleton`, `AdminSectionError` (retry por bloco), `AdminNoDataState`, `AdminDataQualityBadge`, `AdminMetricTooltip`, `AdminResponsiveDataList` (tabela ≥1024 px, cards <768 px).
- `displayDictionary.ts` centraliza labels PT (nada de `agent`, `entry`, `other`, `initiated` na UI).
- `formulas.ts` com denom‑zero → `—`, amostra insuficiente <10, sinal inicial 10–19, deltas em pp.
- Reescrita das 12 páginas admin com wireframes desktop + mobile (§7 do plano).
- Paleta Deep Ink/Cloud/Violet/Coral/Mint; **sem** `#FFC46B`; Phosphor único.

## Estados honestos (regras)
- Coortes vazias → mensagem “ainda não há histórico suficiente”, jamais tabela vazia.
- Receipts WhatsApp/App sem `delivered_at`/`read_at` → KPIs de entrega/leitura como `—` + aviso factual “provedor ainda não retorna confirmações”.
- Oportunidades com `initiated=0` **não listadas**.
- Badge de qualidade `live | backfill | proxy` em todo KPI derivado (hoje: 0 live, 466 backfill/proxy).

## Clientes — identidade por papel
Break‑glass **não é usado** para nome/e‑mail. Três RPCs separados com gates distintos; owner/admin veem identidade completa (auditada), support vê mascarado por padrão (e completo em detalhe com reautenticação), analyst só pseudônimo. Nunca saldo/lançamentos/conversas/telefone.

## Auditoria
Filtros por período/ação/ator/resultado. Ações em PT via dicionário. Nome do ator só para `security.read`; UUID vai para “Ver detalhes técnicos”. Estado vazio explicativo. Lista de instrumentação faltante em §13 (ficará para rodada seguinte).

## Critérios de aceite (§15)
12 critérios mensuráveis, incluindo: 5 páginas quebradas carregam ok para owner; menu 100% server‑driven; grants revogados para `anon`; nenhuma chave técnica em UI; nenhum `0%` sob receipts indisponíveis; tabelas >4 colunas viram cards <768 px; auditoria grava toda leitura de identidade; build/typecheck/testes verdes.

## Decisões pendentes (§17)
Apenas 4 — todas com recomendação técnica registrada:
1. Support vê e‑mail completo pós‑reauth? (recomendo sim, auditado)
2. Retenção de `product_events` (90d?)
3. Cadências de job (chumbar em `job_heartbeats` ou em `opsCadence.ts`?)
4. Configuração do WhatsApp entra agora ou em rodada dedicada? (recomendo dedicada)

## Confirmação
Somente `.lovable/plan.md` foi atualizado. Nenhuma migration, RPC, policy, grant, componente, rota ou configuração alterada. Nenhum build/teste mutável/commit/deploy. Aguardo autorização explícita para entrar em Build Mode.
