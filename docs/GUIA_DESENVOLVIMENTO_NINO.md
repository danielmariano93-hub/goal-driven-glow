# Guia de desenvolvimento do Nino — leia ANTES de qualquer mudança

Para quem vai continuar o trabalho (outra IA ou pessoa). Este documento existe porque
já aconteceram incidentes reais por falta de método. O objetivo aqui não é só dizer
**o que** fazer, mas **por que**, para você tomar a decisão certa em casos que este
guia não prevê.

Idioma: o produto e toda resposta ao usuário são em **português do Brasil**.
Documentos complementares: `docs/emocional-redesign-handoff.md` (aba Emocional),
`docs/nino-runtime-v3-architecture.md` (agente conversacional), `docs/INDICADORES_E_LENTES.md`.

---

## 1. As 7 regras que evitam 90% dos problemas

1. **Verifique no sistema real, não na memória.** Antes de escrever SQL, consulte o
   banco (`information_schema.columns`, `pg_enum`, `pg_proc`). Antes de dizer "está
   pronto", valide com dados reais. Antes de dizer "não funciona", reproduza.
2. **Não confie em outro agente nem em outro PR.** Confira o que ele afirma contra o
   banco/código. (Um PR afirmou que `transactions.status` era `posted`; esse valor
   não existe, e a mudança teria zerado a medição dos experimentos.)
3. **Uma definição de "gasto".** Nunca crie uma segunda regra de gasto/receita; use o
   livro canônico (seção 4). Se dois números do app divergem, é bug, não opinião.
4. **Prove com o dado do usuário.** Reproduza o bug com os dados reais dele (consulta
   no banco) antes de corrigir, e reconfira em produção depois. O bug do "Saiu R$ 0,00"
   só apareceu porque olhamos as transações de hoje.
5. **Mudança pequena e validada, nunca especulativa.** Rode as checagens da seção 6
   antes de dar push. Um push que quebra o CI custa mais que dois pushes cuidadosos.
6. **Diga a verdade sobre o que foi e o que não foi verificado** (ex.: "a tela logada
   não foi aberta; só a prévia dos componentes"). Nunca declare sucesso sem evidência.
7. **Ações irreversíveis ou externas pedem confirmação** (apagar dados, `DROP`,
   publicar para usuários fora do fluxo normal, mexer em segredos).

---

## 2. Incidentes reais (e a lição de cada um)

| Incidente | O que aconteceu | Lição |
|---|---|---|
| **Login derrubado para todos** | Um agente (Lovable) commitou direto na `main` trocando `.env` para outro projeto do Supabase (`wesjjdj…`). O site passou a falar com o projeto errado. | `.env` define o backend do bundle. Conferir `git log origin/main` antes de começar; tratar commit de bot na `main` como incidente. Corrigido nos PRs #167/#168. |
| **Correção do login não publicava** | O Vercel cancelou o build ("Ignored Build Step") porque `scripts/vercel-ignore-build.mjs` ignorava `.env`. | Depois de corrigir, **confirme em produção** (ex.: baixar o bundle e ver que referencia o projeto certo). Hoje `.env` e o próprio script disparam build. |
| **`status='posted'`** | Migração filtrava `posted`, inexistente. Enum real: `confirmed`, `planned`, `superseded`. | Consultar `pg_enum`. Também erraram `debts.initial_amount` (é `original_amount`) e `investment_movements.kind='aporte'` (é `application`). |
| **Job semanal falhando** | RPC existia com parâmetro `p_uid` e o código chamava `p_user_id`. | Validar o job de ponta a ponta em produção (chamar a função e ler `net._http_response`), não só testar a lógica. |
| **CI da `main` quebrado** | Testes leem código-fonte com `readFileSync`; mover lógica de arquivo os quebrou. | Ao mover/renomear: `grep -rn "<arquivo antigo>" src/test`. Atualize o teste ao novo contrato **preservando a intenção**. |
| **Relatórios: "Saiu R$ 0,00" com gastos no dia** | Estorno de R$ 291 (compra de setembro) foi subtraído dos gastos de hoje (R$ 285); o líquido ficou negativo e foi cortado em zero, enquanto a lista de categorias mostrava os gastos. | Estorno é **entrada de dinheiro**, não "gasto negativo". `Saiu` = bruto (igual à Home), estorno aparece separado. Sempre cheque se totais e detalhamentos batem entre si. |
| **WhatsApp: "qual meu saldo atual?" e "como está minha meta de alimentação?" sem resposta** | Com `v3_first_authority_v1` (100% desde 29/09) o LLM decide primeiro e toda leitura passa pelos gates. A ferramenta buscava o dado certo, mas `executedIRFrom` só sabia derivar relatórios de gasto/comparações/comerciantes (saldo, metas, patrimônio, dívida davam `executed_ir_missing`) e `buildEvidenceClaims` só registrava campos de gasto (todo valor de saldo virava `money_not_in_evidence`). Meta com filtro de categoria nem tinha capacidade mapeada. | Todo recurso novo de LEITURA precisa nascer com: (1) derivação do "executado" no `ExecutedIRBridge`, (2) evidência no `EvidenceClaims`, (3) mapeamento no `IRCapabilityAdapter`, (4) teste em `nino-state-metrics-gates.test.ts`. Gate fail-closed é correto; o erro é a engine não provar o que fez. O log agora traz o motivo: `contract_fulfillment_blocked:codigo(detalhe)`. |
| **Tela de Metas com meses sumidos** | Metas eram registros únicos editados/apagados; o passado desaparecia. | Histórico precisa de registro permanente (`category_spending_goal_cycles`), não de "estado atual". |

---

## 3. Arquitetura em 1 minuto

- **Frontend:** React + Vite + TypeScript, React Query v5, react-router, Tailwind/shadcn,
  gráficos em SVG próprio ou recharts. Deploy: **Vercel** (projeto `goal-driven-glow`).
  Domínio de produção `www.meunino.com.br`.
- **Backend:** **Supabase** (projeto `amjanjlvsatubxdreyep`): Postgres + RLS, RPCs
  `security definer`, Edge Functions (Deno) em `supabase/functions/`, `pg_cron` + `pg_net`.
- **Agente conversacional (Nino, WhatsApp/chat):** pipeline ActionIR → WriteWorkflowManager →
  ToolRuntime → `pending_confirmations` → RPC executora → ReceiptBuilder/PersistenceProof.
  Escritas sempre com confirmação. Ver `docs/nino-runtime-v3-architecture.md`.
- **Comunicação proativa:** `agent-proactive-tick` + `communication_catalog` (tipos,
  cooldowns, materialidade). Não envie mensagem proativa sem passar por esse catálogo.
- **Insights:** `nino-insights` (ações `get`, `refresh`, `feedback`, `simulate`, `goals`,
  `goal_merchants`, `dashboard`). `verify_jwt=false` + `x-cron-secret` + `user_id` para
  validação via SQL.

### Mapa de pastas
- `src/lib/engine/<módulo>.ts` — lógica pura compartilhada (app + servidor).
- `supabase/functions/_shared/finance-core/` — **cópia gerada** do engine (não editar).
- `src/lib/<área>/` — clientes, hooks, regras de tela. `src/components/<área>/`, `src/pages/`.
- `supabase/migrations/` — toda mudança de esquema vira arquivo versionado.
- `src/test/` — testes (Vitest). `scripts/` — sincronização e utilitários.

---

### Diagnosticar uma falha do agente (WhatsApp/chat)
1. `agent_runs` do usuário (`error_sanitized`, `path`, `tools_used`, `capability`) e a pergunta em `conversation_messages` (mesmo `conversation_id`, direção `inbound`).
2. `semantic_gate_blocked` = a resposta determinística não passou nos gates; `contract_fulfillment_blocked:...` = preservação/grounding/escopo (veja o detalhe entre parênteses); `semantic_unsupported:...` = nenhuma capacidade mapeada para aquela IR.
3. Reproduza SEM o LLM: monte a IR da pergunta e rode `runSemanticTurn` com um `runEngine` que devolve o resultado REAL da ferramenta (modelo: `src/test/nino-state-metrics-gates.test.ts`). Só depois corrija.
4. `agent_tool_calls` com `evidence_unavailable_in_v2_bridge` é só o registro posterior de um turno que falhou; não é a causa.

## 4. Verdade financeira canônica (nunca contorne)

Fonte: `supabase/functions/_shared/insights/executive/load.ts` (`loadExecutiveInput`) e
`src/lib/engine/facts.ts`.
- **Data de competência** para cartão (`reportingCompetenceDate`).
- Fora do consumo: transferências, pagamento de fatura, investimentos, ajustes.
- **Categoria efetiva** (`effectiveCategoryId`) e **estabelecimento normalizado**
  (`merchant.ts`, versão `merchant_truth.v3`: prefixos de POS, datas coladas, nomes truncados).
- **Estorno = entrada** (nunca abate "saída"); aparece separado. Na Home, estorno entra em `accountIn`.
- **Pagamento de dívida/parcela de empréstimo:** nos **relatórios** conta como saída
  (`includeDebtPayments`), pois sai da conta. Nos insights executivos é amortização,
  não gasto novo. Não unifique à força: a pergunta é diferente.
- Status de lançamento: use `confirmed` (`planned` e `superseded` ficam de fora).
- Fuso: `America/Sao_Paulo`; semana começa na segunda (`weekStartOf`).

### Espelho `finance-core`
Lógica usada no app e nas Edge Functions mora em `src/lib/engine/<módulo>.ts` e é copiada por
`scripts/sync-finance-core.mjs` (lista `FINANCE_CORE_MODULES`). Depois de editar um módulo:
`node scripts/sync-finance-core.mjs` e commite as duas cópias. O teste
`finance-core-parity.test.ts` garante a paridade. Nomes exportados via `export *` em
`finance-core/index.ts` precisam ser únicos. Módulo espelhado **não pode importar o
cliente Supabase do navegador** (por isso o motor observado é puro).

---

## 5. Banco de dados e a ferramenta MCP do Supabase

- **Consulte antes de escrever.** Exemplos reais de enums/colunas já errados por memória: ver seção 2.
- Toda tabela nova: **RLS por usuário** (`user_id = (select auth.uid())`) e grants explícitos.
- Funções `security definer`: `set search_path = public` e validação de `auth.uid()` / `service_role`.
- **Peculiaridades do MCP (`apply_migration`/`execute_sql`):**
  - Timeout de 60 s. `DELETE` e vários `UPDATE`/`DROP FUNCTION` **travam** (sem resposta e sem efeito).
    Prefira **remoção lógica** (`value=0`, `source='removed'`) e `UPDATE ... RETURNING`.
  - Execute **um comando por vez**; dois em paralelo costumam travar.
  - Para criar função, use `apply_migration` com **uma função por chamada**. Para
    renomear parâmetro de função existente, **não** use `DROP`: ajuste o chamador.
  - Depois de qualquer timeout, **confira o estado** (`pg_proc`, contagens) antes de repetir.
- Todo SQL aplicado em produção precisa existir como arquivo em `supabase/migrations/`
  **idêntico ao que está no banco** (um banco novo deve nascer igual à produção).
- Chamar função/edge com segredo via SQL: `net.http_post` com cabeçalho `x-cron-secret`
  (segredo no vault: `INTERNAL_CRON_SECRET`, `meunino_cron_secret` ou `nocontrole_cron_secret`),
  depois ler a resposta em `net._http_response`.
- Usuário de teste real do Daniel: `088920ce-1f5e-47d5-9e07-e2e4a63f9214`. Não grave dado de teste
  em tabelas de usuário sem remover depois (e confira que removeu).

---

## 6. Checklist antes de dar push

Rode na raiz do repositório:

1. `npx vitest run` — suíte inteira verde (≈2.870 testes hoje).
2. `npx tsc --noEmit -p tsconfig.app.json` — **linha de base: 8 erros pré-existentes**
   (testes antigos e `chartFallback.ts`). Qualquer erro além desses é seu.
3. `npx eslint <arquivos alterados>` — não adicione `no-explicit-any` novo.
4. `npm run build` e depois `git checkout -- supabase/functions/mcp/index.ts` (o build altera esse arquivo).
5. Edge Functions mexidas: `~/.deno/bin/deno check --no-config <entrada>` (linhas de base de erros
   antigos: agent-chat 14, agent-proactive-tick 1, whatsapp-webhook 26, agent-run 15).
6. Telas: conferir em 390 px com Playwright (`/opt/pw-browsers/chromium`; **não** rode
   `playwright install`). Apague arquivos de prévia antes do commit.
7. Re-leia o próprio diff como se fosse o revisor: "o que faria o CI recusar isto?".

Escrever testes: lógica nova = função pura + teste ao lado (`src/test/<nome>.test.ts`). Cubra o
caso real que motivou a mudança. Nunca pule, desabilite ou "quarentene" teste para ficar verde.

---

## 7. Fluxo de entrega (GitHub + Vercel + Supabase)

1. `git fetch origin main` e `git log origin/main -5`: **veja quem mexeu na `main`**. Branch nova a
   partir de `origin/main`.
2. Commit com a atribuição pedida pelo ambiente. PR com descrição clara (o quê, por quê, como foi verificado).
3. Esperar o check **`regressions`** ficar verde (demora a aparecer). Merge **squash** informando o
   SHA completo da cabeça (`expectedHeadSha`).
4. **Deploy das Edge Functions:** workflow `Nino Direct Supabase Deploy` roda se mudou
   `supabase/functions/**` ou `config.toml`. Se falhar, a causa costuma ser a suíte de regressão:
   leia o log (`get_job_logs`). Disparo manual: `workflow_dispatch` com `confirm=DEPLOY`.
5. **Frontend (Vercel):** `scripts/vercel-ignore-build.mjs` decide se compila. Mudança só de
   backend/teste não publica o site. Mudou `.env`/`src`/`public`/configs de build → publica.
6. **Migrações não são aplicadas pelo CI.** Aplique com o MCP do Supabase **e** versione o arquivo.
7. **Valide em produção:** chame a função/RPC com dado real, baixe o bundle e confira o projeto
   (`amjanjlvsatubxdreyep`), leia `net._http_response`. Só então diga que está no ar.
8. Sem `gh` CLI: use as ferramentas `mcp__github__*`. Poll de CI via
   `https://api.github.com/repos/<owner>/<repo>/commits/<sha>/check-runs`.

**Nunca:** commitar direto na `main`; mexer em `.env` sem necessidade; versionar segredo; rodar
`DROP`/`DELETE` em produção sem pedir; forçar push; reescrever histórico alheio.

---

## 8. Como pensar um problema do usuário (método)

1. **Reproduza com os dados dele** (consulta no banco + chamada da função). Ache a causa raiz,
   não o sintoma. Ex.: "Saiu R$ 0,00" → olhar as transações do dia → achar o estorno.
2. **Cheque a consistência entre números** na mesma tela e entre telas (Home × Relatórios × Nino).
3. **Corrija na camada certa** (motor puro, não a tela) e **cubra com teste do caso real**.
4. **Pergunte "o que mais usa isto?"** (`grep` pelo tipo/função) antes de mudar um contrato.
5. **Valide em produção** e relate com honestidade o que ficou sem verificar.
6. **Registre a lição** neste guia se o erro for de método, não só de código.

### Princípios de produto
- Só afirmar "melhorou/piorou" com **dois pontos reais** para comparar; senão dizer "ainda não dá para dizer".
- Associação nunca é causa. Sem diagnóstico psicológico.
- Status sempre com **ícone + texto**, nunca só cor. Nada de "falhou": tom sem julgamento.
- Mostrar **de onde veio** cada número/contagem (evidência), com ação clara para o usuário.
- Cada bloco de tela responde a **uma pergunta**; se repete o que está acima, remova.

---

## 9. Mapa rápido por assunto

| Assunto | Onde |
|---|---|
| Relatórios (painel) | `src/lib/engine/reportDashboard.ts`, `src/components/reports/*`, `src/pages/RelatoriosInteligentes.tsx`, `supabase/functions/_shared/reportsDashboard/runtime.ts`, ação `dashboard` em `nino-insights` |
| Metas e histórico | `src/lib/engine/spendingGoals.ts`, `goalHistory.ts`, `src/components/metas/*`, tabela `category_spending_goal_cycles` |
| Aba Emocional | `docs/emocional-redesign-handoff.md`, `src/lib/behavioral/*`, `src/lib/engine/behaviorObserved.ts`, `src/components/behavioral/*`, edge `behavior-observed-weekly` |
| Experimentos | `src/lib/behavioral/experimentCopy.ts`, `experimentEvidence.ts`, RPCs `behavior_experiment_*` |
| Merchants | `src/lib/engine/merchant.ts` (`merchant_truth.v3`) |
| Agente / ferramentas | `supabase/functions/_shared/agent/tools.ts`, `core/*` (CapabilityRegistry, ConversationTurnContract, SemanticInterpreterV3) |
| Proativo | `supabase/functions/agent-proactive-tick`, `_shared/proactive/*`, `communication_catalog` |
| Navegação | `src/lib/navigation/appNavigationRegistry.ts` |

---

## 10. Pendências conhecidas (ver também o handoff Emocional)

- Teste ponta a ponta do Nino/WhatsApp para "como estão meus hábitos?" (só a lógica foi testada).
- Primeira execução automática do cron `behavior-observed-weekly` (segunda 09:30 UTC): conferir `cron.job_run_details`.
- Migração para a API oficial da Meta no WhatsApp: depende de decisões do usuário (número, CNPJ/site, nome de exibição).
- Subcategorias reais (`parent_id` não existe em `categories`); hoje o 2º nível é o estabelecimento.
- O agente conversacional não responde "como estou?" com o veredito dos Relatórios.
