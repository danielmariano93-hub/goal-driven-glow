# NoControle.ia — Plano de Transformacao

Rebranding integral do prototipo local em plataforma multiusuario real com landing, auth, Supabase/RLS, agente financeiro, WhatsApp WAHA (numero oficial unico) e painel admin. Preservar UI/UX de formularios e paginas onde faz sentido; substituir a fundacao (persistencia, calculos financeiros duvidosos, modelo de dados).

## 1. Diagnostico do codigo atual

**Preservar (refatorar visualmente, manter estrutura):**
- Paginas de dominio: `Lancamentos.tsx`, `Metas.tsx`, `Dividas.tsx`, `Investimentos.tsx`, `Relatorios.tsx`, `Perfil.tsx`, `Planejamento.tsx` (Antes de Gastar), `Emocoes.tsx` (como opcional).
- Componentes de formulario: `LancamentoForm`, `MetaForm`, `DividaForm`, `InvestimentoForm`, `EmocaoForm` (adaptar campos ao novo schema).
- `csv.ts` (util de export), padroes de graficos com recharts, `NotFound.tsx`.
- Tipos em `types/financial.ts` como referencia para o schema Supabase.

**Refatorar (mudanca de fundacao, mesma superficie):**
- `FinancialContext.tsx`: substituir useReducer+localStorage por hooks TanStack Query sobre Supabase; manter o shape `useFinancial()`/`useIndicadores()` para nao propagar refactor pelas paginas.
- `AppLayout.tsx`, `BottomTabBar.tsx`, `DesktopSidebar.tsx`, `Index.tsx`: reaplicar design system NoControle.ia (paleta #21164F/#6D3BFF/#8B5CF6/#FF6B4A, fundo #F8F7FC, Inter/Manrope).
- `engine.ts`: manter funcoes puras, corrigir formulas (secao 4). Recalculos passam a rodar sobre dados do Supabase e nao mais do state global.

**Descartar:**
- `data/mockData.ts` (ja removido) e SEED_* dentro de `FinancialContext.tsx`.
- `alertas` inline no reducer: viram derivacao pura ou tabela `alerts` apenas se houver uso real.
- `categoriasCustom: string[]` no state (vira tabela `categories`).
- Campo `impulsivo` como boolean obrigatorio no lancamento: passa a ser opcional derivado de emocao/tag; nunca gatilho de score arbitrario.
- Score "Emocional" e "Financeiro" com pesos magicos (25/20/20/20/15): remover ate haver metodologia transparente e dados suficientes; substituir por indicadores factuais (taxa poupanca, comprometimento, patrimonio) sem grade 0-100 disfarcada de rating.

## 2. Arquitetura-alvo

**Frontend (React 18 + Vite + Tailwind + shadcn):**
- `/(publico)`: landing, precos futuros, login, signup, recuperacao.
- `/app/*`: area autenticada com bottom nav mobile e sidebar desktop.
- `/admin/*`: painel do founder, protegido por `has_role(uid, 'admin')`.
- Estado servidor via TanStack Query; estado UI local via `useState`. Sem contexto global de dados.

**Banco (Supabase Postgres):** RLS por `user_id`; dinheiro em `numeric(14,2)`; UUID + timestamps timezone-aware; enums para tipo/status.

**Edge Functions (Deno, todas com JWT verificado ou secret do WAHA):**
- `whatsapp-webhook`: recebe eventos WAHA, normaliza via `MessagingProvider`, deduplica, resolve usuario por telefone verificado, enfileira para o agente.
- `whatsapp-send`: envia mensagens (unico ponto de saida).
- `whatsapp-session`: start/QR/status/logout do numero oficial (apenas admin).
- `whatsapp-ack-watchdog`: reconciliacao de ACKs.
- `agent-run`: executa o agente com prompt versionado, tools whitelisted, logs em `agent_runs`.
- `link-phone-code`: gera codigo temporario para vinculacao "VINCULAR 123456".

**Agente:** LLM via Lovable AI Gateway (`@ai-sdk/openai-compatible`, `LOVABLE_API_KEY` server-side). Ferramentas com Zod: `createTransaction`, `requestTransactionConfirmation`, `getFinancialSummary`, `listRecentTransactions`, `updateTransaction`, `deleteTransaction`. Nenhuma escrita fora dessas tools. `stopWhen: stepCountIs(50)`.

**MessagingProvider (interface):** `sendText`, `getSessionStatus`, `getSessionHealth`, `startSession`, `getQrCode`, `logoutSession`, `normalizeWebhookEvent`. Implementacao inicial `WahaProvider` isolada em `supabase/functions/_shared/waha/` (referencia Sniper AI para dedupe/ACK/health/QR/normalizacao apenas). Futuro `MetaCloudProvider` implementa a mesma interface.

## 3. Modelo de dados e RLS

**Agora (fase inicial):**

```text
profiles(id=auth.users.id, display_name, avatar_url, phone_e164, phone_verified_at, created_at)
user_financial_settings(user_id PK, monthly_income numeric, income_frequency, timezone, currency='BRL')
user_roles(user_id, role app_role) + has_role() SECURITY DEFINER  [padrao Lovable]
accounts(id, user_id, name, kind, initial_balance numeric)  -- contas/carteiras
categories(id, user_id NULL=global, name, kind income|expense, color, icon)
transactions(id, user_id, account_id, category_id, kind income|expense, amount numeric, occurred_at date, description, payment_method, source enum(app|whatsapp|import), idempotency_key unique, confirmed_at, agent_run_id NULL, emotion NULL, notes NULL)
recurring_transactions(id, user_id, template..., day_of_month, next_run_at) -- substitui "Contas Fixas"
goals(id, user_id, name, target_amount, deadline, priority, status)
goal_contributions(id, goal_id, user_id, amount, occurred_at, transaction_id NULL)
investments(id, user_id, kind, invested_amount, current_amount, updated_at) -- agregado, nao cotacoes
debts(id, user_id, name, principal, current_balance, interest_rate, installments_total, installments_left, monthly_payment, priority)
phone_link_codes(code, user_id, expires_at, consumed_at)
messaging_connections(id, provider='waha', session_name, status, health, last_ack_at)
messaging_provider_events(id, provider_message_id unique, received_at, payload jsonb, processed_at, error)
conversations(id, user_id, channel='whatsapp', started_at)
messages(id, conversation_id, direction in|out, content, agent_run_id NULL, created_at)
agent_configs(id, name, active bool, model, temperature, max_tokens, memory_window)
agent_prompt_versions(id, agent_config_id, version, prompt, created_by, created_at)
agent_runs(id, user_id, config_id, prompt_version_id, input, output, tools_used jsonb, tokens_in, tokens_out, cost_estimate, duration_ms, error, created_at)
```

**RLS:** todas as tabelas de dominio (`transactions`, `goals`, `debts`, ...) com policies `user_id = auth.uid()` para SELECT/INSERT/UPDATE/DELETE. `messaging_provider_events`, `agent_configs`, `agent_prompt_versions`, `messaging_connections`, `phone_link_codes`: SELECT/UPDATE apenas admin (`has_role(auth.uid(), 'admin')`); INSERT via service_role a partir das Edge Functions. `agent_runs`: usuario le so os proprios; admin le todos. `messages`/`conversations`: usuario le so as proprias.

**Grants:** cada `CREATE TABLE` seguido de `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated` e `GRANT ALL ... TO service_role`. `anon` nunca recebe grants em tabelas de dominio.

**Futuras (nao criar agora):** `challenges`, `gamification_events`, `imports_ofx`, `split_expenses`, `open_finance_connections`.

## 4. Revisao das formulas financeiras

Problemas atuais em `engine.ts`:
- `calcularGastoTotal` sem filtro somando historia inteira e sendo usado como "gasto do mes" no dashboard.
- `calcularSaldoMes` faz `renda - gastos - gastosFixos`, mas gastos fixos deveriam estar dentro dos lancamentos do mes (double-count).
- `calcularPatrimonioLiquido = investimentos - dividas` ignora saldo em contas e reserva.
- `calcularProjecao` extrapola saldo linearmente sem considerar recorrencias, aportes previstos ou juros de dividas.
- Scores 0-100 com pesos arbitrarios apresentados como se fossem metrica objetiva.

**Definicoes corrigidas (documentar em `lib/engine.ts` com comentario da formula):**
- `patrimonio_atual = SUM(accounts.saldo_atual) + SUM(investments.current_amount) - SUM(debts.current_balance)`
- `renda_mes(m) = SUM(transactions.amount WHERE kind='income' AND month(occurred_at)=m AND confirmed)`
- `gasto_mes(m) = SUM(kind='expense' ...)` (fixas ja estao dentro via `recurring_transactions` materializadas)
- `comprometimento_%(m) = gasto_mes(m) / renda_mes(m)` (0 se renda=0; exibir "sem dados")
- `taxa_poupanca(m) = max(0, (renda_mes - gasto_mes) / renda_mes)`
- **`livre_para_gastar`** = `saldo_atual_contas_liquidas + renda_prevista_ate_fim_do_mes - despesas_recorrentes_pendentes_do_mes - aporte_planejado_do_mes - reserva_minima_do_perfil`. Sempre rotular como **estimativa**, mostrar a formula em tooltip e nunca esconder inputs zerados.
- Projecoes: usar simulacao mes-a-mes com recorrencias e amortizacao real de dividas; nunca linear.
- Remover `scoreFinanceiro`/`scoreEmocional` da UI ate haver metodologia publicavel. Substituir por 3 indicadores factuais: comprometimento, taxa de poupanca, evolucao patrimonial 3m.

## 5. Migracao localStorage -> Supabase

Fonte unica: Supabase. Sem sincronizacao bidirecional. Estrategia:
1. Ao habilitar Cloud e implantar auth, o app novo **nao le mais** `financial_ecosystem_v2` do localStorage.
2. Oferecer, na primeira sessao autenticada, um banner "Importar dados do dispositivo" que abre um modal, le o JSON local, mostra preview e faz insert em massa via RPC transacional `import_local_snapshot(jsonb)` mapeando para o novo schema. Apos import bem-sucedido, remover a chave local.
3. Import e opcional e idempotente por `idempotency_key`; se o usuario ignorar, o localStorage e limpado na 2a sessao para evitar duas fontes de verdade.
4. Nenhum outro codigo le localStorage para dominio financeiro.

## 6. Estrutura de rotas

```text
Publicas
  /                       Landing NoControle.ia
  /login  /signup  /reset-password  /reset-password (recovery)
  /termos  /privacidade

Autenticadas (/app/*)
  /app                    Dashboard
  /app/transacoes         Lancamentos (ex-Lancamentos)
  /app/categorias         Gestao de categorias
  /app/contas             Contas e formas de pagamento
  /app/metas              Metas + aportes
  /app/investimentos      Investimentos
  /app/dividas            Dividas
  /app/antes-de-gastar    Simulador (ex-Planejamento)
  /app/emocoes            Registro emocional (opcional)
  /app/relatorios         Relatorios
  /app/perfil             Perfil, financas, vinculacao WhatsApp
  /app/onboarding         Wizard inicial

Admin (/admin/*, guardadas por has_role='admin')
  /admin                  Overview
  /admin/agente           Configs, prompt versionado, playground
  /admin/conversas        Conversas WhatsApp e agent_runs
  /admin/whatsapp         Saude WAHA, sessao, QR
  /admin/usuarios         Lista, roles, suporte
  /admin/metrics          Tokens, custo, latencia, erros
```

## 7. Rebranding e design system

- Substituir `index.css` e `tailwind.config.ts` pelos tokens do Project Knowledge (cores, gradiente 135deg #6D3BFF->#8B5CF6->#FF6B4A com moderacao, fundo #F8F7FC, superficie branca, texto #171321).
- Fonte Inter (padrao) com Manrope opcional para numeros grandes; carregar via `<link>` no `index.html`.
- Componentes shadcn: variantes reescritas para consumir tokens (`--primary`, `--accent`, `--surface`). Nunca `text-white`, `bg-[#...]` hardcoded.
- `ScoreRing` aposentado; criar `MetricStat` (numero + label + delta).
- Bottom nav mobile 375px, sidebar 1440px; testar 768px. WCAG AA, foco visivel, `prefers-reduced-motion`.
- Atualizar `<title>`, `<meta description>`, `og:*`, `twitter:card` no `index.html` para NoControle.ia.
- Landing: hero com promessa "Seu controle financeiro comeca com uma conversa", secoes de valor (WhatsApp, Antes de Gastar, Metas), CTA login/signup. Sem depoimentos ou metricas inventados.

## 8. Fluxo WhatsApp (numero oficial unico)

1. Admin inicia sessao WAHA uma vez em `/admin/whatsapp`; QR escaneado no numero da empresa. `messaging_connections` guarda estado.
2. Usuario abre `/app/perfil` -> "Conectar WhatsApp". App chama `link-phone-code` que insere um codigo de 6 digitos com TTL 10min em `phone_link_codes`.
3. UI mostra o numero oficial e a instrucao: enviar `VINCULAR 123456` por WhatsApp.
4. `whatsapp-webhook` recebe, o `WahaProvider.normalizeWebhookEvent` extrai `from_phone_e164` + texto. Handler detecta o comando `VINCULAR`, consome o codigo, escreve `profiles.phone_e164` e `phone_verified_at` para o `user_id` dono do codigo.
5. Mensagens subsequentes: resolucao **sempre** por telefone E.164 verificado inteiro; se nao houver match exato, responde instrucoes de vinculacao. Nunca casar por sufixo.
6. Deduplicacao por `provider_message_id` em `messaging_provider_events`. ACK watchdog reconcilia entregas.
7. Mensagens de saida so via `whatsapp-send`; nenhum componente frontend fala com WAHA direto.

## 9. Fluxo do agente para registrar transacao

1. Webhook -> resolve usuario -> insere `messages(direction=in)` -> chama `agent-run` com contexto (mensagem, memoria resumida, config ativa, prompt version).
2. Agente decide chamar `createTransaction` com Zod `{amount, kind, occurred_at, category_hint, description, payment_method?, account_hint?}`.
3. Se ha ambiguidade critica (conta, categoria ambigua entre 2 candidatas, data relativa nao resolvida), chama `requestTransactionConfirmation` que retorna uma pergunta curta e o agente pergunta ao usuario **antes** de gravar.
4. Ao gravar, a tool gera `idempotency_key = hash(user_id, provider_message_id, amount, occurred_at)`; insert em `transactions` respeita unique constraint (segunda tentativa e no-op).
5. Confirmacao de exclusao/edicao sempre exige resposta explicita do usuario ("sim"/"confirmo") antes de `deleteTransaction`/`updateTransaction`.
6. `agent_runs` grava input, output, tools chamadas, tokens, custo, duracao, erro. `messages(direction=out)` guarda a resposta enviada.
7. Nunca inventar valores; se faltar dado essencial (valor), pergunta em vez de assumir.

## 10. Painel admin

- **Agente:** listar/editar `agent_configs`, criar novas `agent_prompt_versions` (nunca editar versao publicada), toggle da versao ativa, playground que roda `agent-run` em dry-run sem gravar transacoes.
- **Conversas:** timeline por usuario com `messages` + `agent_runs` colapsaveis (input, tools, tokens, custo, erro). Filtros por usuario, data, erro.
- **Metricas:** graficos de mensagens/dia, custo/dia, latencia p50/p95, taxa de erro, tools mais usadas. Fonte: `agent_runs` + `messaging_provider_events`.
- **WhatsApp:** status da sessao WAHA, health check, botao logout/restart, ultimo ACK, backlog nao processado.
- **Usuarios:** busca, atribuir role, ver telefone verificado, ultimo acesso. Nunca listar valores financeiros.

## 11. Fases ordenadas

**F0 — Rebrand visual + landing (sem backend)** — Baixo
- Arquivos: `index.css`, `tailwind.config.ts`, `index.html`, `AppLayout`, `BottomTabBar`, `DesktopSidebar`, `Index`, novo `pages/Landing.tsx`, novo `pages/Login.tsx` (placeholder).
- Aceite: preview responsivo mobile/desktop com nova identidade; landing acessivel em `/`; build sem erro.

**F1 — Lovable Cloud + auth + profiles + roles** — Medio
- Habilitar Cloud; migrations: `profiles`, `user_roles`, `has_role`, `user_financial_settings`, triggers de auto-profile. `/signup`, `/login`, `/reset-password`.
- Aceite: usuario cria conta, faz login/logout, reset por email funciona, admin marcado manualmente ve `/admin` (stub).

**F2 — Schema financeiro + RLS + refactor do contexto** — Alto
- Migrations: `accounts`, `categories`, `transactions` (com `idempotency_key`), `recurring_transactions`, `goals`, `goal_contributions`, `investments`, `debts` + policies + grants.
- Refactor `FinancialContext` para hooks TanStack Query. Adaptar formularios ao novo schema. Onboarding basico (renda, primeira conta).
- Import opcional do snapshot local via RPC.
- Aceite: CRUD real funcionando em `/app/transacoes`, `/app/metas`, `/app/dividas`, `/app/investimentos`; RLS bloqueia acesso cruzado (teste com 2 contas); dados persistem entre sessoes/dispositivos.

**F3 — Motor financeiro corrigido + dashboard + relatorios** — Medio
- Reescrever `engine.ts` com formulas da secao 4. Dashboard novo com 3 indicadores factuais e "livre para gastar" com tooltip da formula. Relatorios sem scores 0-100.
- Aceite: valores conferem em teste manual com dataset seed; tooltip da formula visivel; nenhum score fantasma na UI.

**F4 — Antes de Gastar refatorado** — Baixo
- Adaptar `Planejamento.tsx` ao novo motor; simulacao roda contra dados reais mas nao grava. Confirmacao cria `transaction` idempotente.

**F5 — MessagingProvider + WAHA + webhook + admin/whatsapp** — Alto
- `_shared/waha/` (referencia Sniper AI), Edge Functions `whatsapp-webhook`, `whatsapp-send`, `whatsapp-session`, `whatsapp-ack-watchdog`. Migrations `messaging_connections`, `messaging_provider_events`, `phone_link_codes`, `conversations`, `messages`. Pagina `/admin/whatsapp` e `/app/perfil` (vinculacao).
- Aceite: admin escaneia QR uma vez; usuario envia `VINCULAR xxxxxx`; perfil recebe `phone_verified_at`; mensagem posterior gera `messages(in)` sem gravar transacao ainda.

**F6 — Agente + tools + agent_runs + admin/agente** — Alto
- Migrations `agent_configs`, `agent_prompt_versions`, `agent_runs`. Edge Function `agent-run` com AI SDK + Lovable AI Gateway. Tools whitelisted (secao 9). Painel `/admin/agente`.
- Aceite: mensagem "Gastei R$80 no bar ontem no Nubank" gera `transaction` correta, resposta curta pelo WhatsApp, `agent_runs` com tokens/custo; segunda mensagem identica nao duplica (idempotencia).

**F7 — Metricas admin + polimento** — Baixo/Medio
- `/admin/metrics`, `/admin/conversas`, `/admin/usuarios`. SEO da landing, og tags, acessibilidade.

## 12. Riscos e dependencias

- **WAHA self-hosted:** dependencia externa; precisa host e credencial. Sem isso F5+ nao roda. Decisao pendente: onde hospedar o WAHA (VPS do founder).
- **Custo LLM:** monitorar via `agent_runs.cost_estimate`; hard limit por usuario/mes configuravel em `agent_configs`.
- **LGPD:** transacoes contem dado financeiro; logs precisam sanitizar valores em stack traces.
- **Idempotencia via WhatsApp:** garantir que `provider_message_id` sempre entra no hash; sem ele, arriscamos duplicar.
- **Migracao localStorage:** decidir se apagamos automaticamente apos import ou damos 30 dias de tolerancia. Recomendacao: apagar apos import; nao manter fallback.
- **Scores 0-100:** decisao produto de nao publicar ate ter metodologia. Confirmar com stakeholder antes de F3.
- **Numero unico WhatsApp:** custo e complience de um numero comercial (business). Founder precisa providenciar.

## 13. Estimativa de creditos por fase

| Fase | Escopo | Creditos |
|------|--------|----------|
| F0 | Rebrand + landing | Baixo |
| F1 | Cloud + auth + profiles | Medio |
| F2 | Schema + refactor contexto | **Alto** |
| F3 | Motor financeiro + dashboard | Medio |
| F4 | Antes de Gastar | Baixo |
| F5 | WAHA + webhook + admin whatsapp | **Alto** |
| F6 | Agente + tools + admin agente | **Alto** |
| F7 | Metricas + polimento | Baixo/Medio |

## 14. Recomendacao para a PRIMEIRA execucao

**Executar F0 isoladamente.** Motivo: rebrand nao depende de backend, nao arrisca dados, valida design system e narrativa NoControle.ia antes de investir credito Alto em schema/agente. Escopo exato da F0:

1. Aplicar tokens de cor/tipografia em `index.css` e `tailwind.config.ts`.
2. Trocar meta tags e titulo em `index.html`.
3. Criar `src/pages/Landing.tsx` com hero + 3 secoes de valor + CTA e monta-la em `/` (mover dashboard atual para `/app`).
4. Ajustar `AppLayout`, `BottomTabBar`, `DesktopSidebar`, `Index` (agora `/app`) para nova paleta sem tocar em logica.
5. Placeholder `/login` e `/signup` sem funcao ainda (so UI), redirecionando para landing.

Ao final da F0: preview responsivo mostrando a nova marca e a landing, dashboard existente preservado em `/app` com a nova paleta. Aprovacao da F0 destrava F1.