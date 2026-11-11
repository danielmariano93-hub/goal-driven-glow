# Nino Hábitos: refinamento técnico e de produto completo (11/11/2026)

Escopo: um segundo "lado" dentro do Nino, dedicado a criação de hábitos (financeiros e não financeiros), com seletor
**Dinheiro | Hábitos** no topo. **As telas atuais do Nino Finance não mudam.** Este documento cobre produto, dados, sinais,
indicadores, IA, notificações, arquitetura, segurança, qualidade e plano de entrega.

Convenção: **[verificado]** = li no código ou no banco de produção hoje; **[proposta]** = decisão de desenho a validar;
**[premissa]** = depende de algo que não consegui confirmar.

---

## 0. Resumo executivo (em português simples)

1. **O que vamos construir.** Um app de hábitos dentro do Nino: a pessoa escolhe um hábito, define quando vai fazê-lo
   ("depois do café, eu medito 5 minutos"), marca no app ou pelo WhatsApp, e vê o hábito ficando mais fácil com o tempo.
   Também há hábitos de *largar* algo (cigarro, delivery por impulso), com contagem de dias, recaída sem culpa e uma estimativa
   do dinheiro que ficou com a pessoa.
2. **O diferencial.** O Nino já conhece o dinheiro da pessoa. Alguns hábitos o Nino marca sozinho (registrar gastos, ficar no
   combinado de Lazer, pagar conta antes do vencimento) e o cruzamento entre hábito e gasto aparece com honestidade
   (padrão, não causa).
3. **Sem gamificação.** Nada de pontos, moedas, níveis ou ranking. Isso conflita com o que existe hoje (tabela `xp_events`, tela
   Desafios): ver decisão D2.
4. **Medimos três tipos de número**: *medido* (contagem), *estimado* (cálculo com premissa) e *autorrelatado* (a pessoa respondeu).
   A tela sempre diz qual é.
5. **IA entra onde ela é boa e fica fora de onde ela é arriscada.** Entra para entender frases soltas no WhatsApp ("treinei 40
   min"), ajudar a montar o plano do hábito e redigir/explicar com tom humano. **Nunca** calcula sequência, força do hábito ou
   percentuais: isso é código determinístico, como já é no resto do Nino.
6. **Notificações com orçamento próprio**: no máximo 2 mensagens de hábito por dia, nunca em horário silencioso, nunca em cima
   de uma conta a vencer, e com parada automática quando a pessoa ignora (o Nino pergunta se quer pausar, não insiste).
7. **Entrega em fases atrás de flag**, começando só na conta dona. Os dados são **sensíveis (saúde, vícios)** sob a LGPD e
   exigem tratamento próprio (seção 11).
8. **Há 8 contas reais e 2 WhatsApps ativos [verificado]**: não dá para provar efeito estatisticamente. A validação inicial é
   qualitativa (uso real da conta dona e de poucas pessoas) mais usuários sintéticos para testar o agente.

### Decisões que preciso de você (detalhe na seção 15)
- **D1** Nome e rota: a palavra "Hábitos" já existe no Nino com outro sentido (insights do comportamento financeiro).
- **D2** O que fazer com XP e Desafios, que contradizem o princípio "sem gamificação".
- **D3** O Nino pode gravar uma marcação de hábito direto pelo WhatsApp, sem confirmação? (Proposta: sim, com "desfazer".)
- **D4** Dados de saúde: consentimento específico e o que o admin pode ver.
- **D5** Mensagens iniciadas pelo Nino fora da janela de 24 h do WhatsApp precisam de modelos aprovados pela Meta.
- **D6** Hábitos será recurso do plano pago?

---

## 1. Princípios e restrições

| # | Princípio | Consequência técnica |
|---|---|---|
| P1 | **Telas do Nino Finance não mudam** | Hábitos vive em árvore de rotas própria (`/app/h/*`) e em chunk lazy. O único ponto de contato é o seletor no topo (seção 9.3). Teste de regressão visual das telas financeiras como portão de merge. |
| P2 | Determinístico primeiro, IA depois | Todo número vem de função pura e testada (`habits-core`). A IA só interpreta, sugere e redige, sempre com saída validada por esquema. |
| P3 | Honestidade sobre o que é medido | Todo indicador tem tipo (medido, estimado, autorrelatado) e tamanho de amostra quando for comparativo. |
| P4 | Falhar um dia não pune | Folgas, versão mínima, correção retroativa e recaída sem culpa fazem parte do modelo de dados, não só do texto. |
| P5 | Atenção é escassa | Orçamento de notificação próprio, dentro do teto diário já existente (5/dia), com parada automática. |
| P6 | Sem causalidade falsa | Qualquer cruzamento hábito × dinheiro exige amostra mínima e usa linguagem de padrão. |
| P7 | Dado sensível é sensível | Minimização, consentimento específico, exportação e exclusão completas, admin vê só agregado. |
| P8 | Tudo atrás de flag, por usuário | Padrão do repositório: `agent_runtime_flags` [verificado]. Desligada por padrão. |

---

## 2. Estado atual relevante [verificado]

- **Escala**: 8 contas reais, 2 vínculos de WhatsApp ativos, 1 conta com acesso ao "Hábitos v2" atual, 34 jobs agendados.
- **"Hábitos" já existe, com outro sentido.** `habits_v2_access`, `habit_context_answers`, `habit_insight_events` e
  `src/lib/behavioral/habitPatterns.ts` servem à página de **padrões de comportamento financeiro** ("o Nino observa que você
  gasta mais no fim de semana"). Documentos: `docs/habitos-v2-auditoria.md`, `docs/habitos-v2-validacao.md`.
  Isso **colide com o nome** do novo produto (D1).
- **Camada comportamental financeira existente** (reaproveitável como fonte de sinais): `behavioral_daily_facts`,
  `behavioral_transaction_facts`, `behavioral_cycle_facts`, `behavioral_patterns`, `behavior_experiments`,
  `nino_change_commitments`, `weekend_commitments`, `nino_behavioral_timing_windows`, `nino_behavioral_events`,
  `nino_learning_events`. A UI "Planos e experimentos" (Metas) lê `weekend_commitments`.
- **Comunicação proativa**: 52 tipos em 13 famílias; catálogo em `communication_catalog` (27 colunas: canais, cooldown,
  severidade mínima para WhatsApp, janela de validade, confiança mínima), 92 modelos em `communication_templates`, entregas em
  `communication_deliveries` (com `block_context`, `interacted_at`, `acted_at`), decisões em `proactive_decisions`, alocador por
  **pilares** (`proteger`, `antecipar`, `metas`, `organizacao`) em `proactive/pillars.ts`, despachante com política (silêncio
  21h-8h, opt-out, cotas), teto de 5/dia e cadência mínima de 2 h no WhatsApp.
- **Agente**: interpretador semântico V3 (LLM) -> `TurnSpec` -> executores determinísticos; 133 definições de ferramenta em
  `agent/tools.ts`; escrita sempre como rascunho com confirmação; guarda de números (grounding) e 37 flags em `agent_runtime_flags`
  (incluindo `deterministic_first_v2`, `model_routing_v2`, `progressive_tools_v1`).
- **Preferências**: `notification_preferences` (38 colunas: silêncio, fuso `timezone`, `max_proactive_per_day`, tipos silenciados).
- **Telemetria**: `product_events` (com `pseudo_id`, não o id real) e `product_event_types`; `agent_runs` (73 colunas, custo).
- **Operação**: `feature_health_snapshot()` (alertas de funcionamento), `ops_alerts`, painéis admin.
- **Estrutura do app**: `AppLayout` renderiza `<Outlet/>` dentro de um contêiner e `BottomTabBar` (4 abas:
  Início, Lançamentos, Metas, Mais); "cada rota é responsável pelo próprio cabeçalho" [verificado em `AppLayout.tsx`].
- **Gamificação legada**: `xp_events` (5 linhas), `challenges_catalog`, `user_challenges`, `user_gamification`, página
  `Desafios` e família de comunicação `achievement`.

---

## 3. Domínio: o que é um hábito no Nino

### 3.1 Entidades
- **Hábito** (`hb_habits`): o que a pessoa quer repetir (ou largar). Tem tipo, gatilho, versão mínima, cadência, folgas,
  área, vínculo opcional com dinheiro e estado.
- **Tipos de hábito**:
  - `do_daily`: todo dia (ou dias da semana escolhidos).
  - `do_weekly_count`: X vezes por semana.
  - `do_quantity`: quantidade acumulada (ex.: 20 páginas na semana, 2 L de água no dia).
  - `quit`: largar algo (contagem de dias sem; marcação é a *ocorrência*, não a abstinência).
- **Gatilho** (plano "se-então"): `cue_kind` = `after_event` ("depois de tomar café"), `at_time`, `at_place`, `free`.
  Guardamos o texto da pessoa e, opcionalmente, um horário de referência para o lembrete de reforço.
- **Versão mínima**: a ação reduzida que ainda conta ("3 respirações"). Registro `minimum` vale como feito parcial.
- **Folga**: dia previsto que a pessoa isenta de cobrança, dentro de um orçamento semanal (`rest_per_week`, padrão 1).
  Não entra no cálculo de adesão nem quebra a sequência.
- **Registro** (`hb_logs`): um evento por hábito por dia (status `done | minimum | rest | skipped | quantity`), origem
  (`app | whatsapp | auto | backfill`) e chave de idempotência.
- **Ciclo** (`hb_cycles`, só `quit`): um período contínuo sem ocorrência. Recomeçar encerra o ciclo e abre outro; o recorde e o
  total de dias sem sobrevivem.
- **Vontade** (`hb_cravings`, só `quit`): a pessoa tocou "bateu a vontade". Mede se o plano da vontade funcionou.
- **Check-in de automaticidade** (`hb_automaticity_checkins`): autorrelato 1 a 7, a cada 14 dias por hábito.
- **Fase** (derivada, nunca editada à mão): `starting` -> `rooting` -> `firm` -> `maintenance`; também `paused`, `archived`.

### 3.2 O que "dia" significa
Dia **local da pessoa** (`notification_preferences.timezone`, padrão `America/Sao_Paulo`). Todo registro guarda
`local_date date` calculada no servidor na hora da escrita, para não depender do fuso do cliente. Virada de dia às 03:00
(registros entre 00:00 e 03:00 podem ser atribuídos ao dia anterior se a pessoa confirmar; [proposta] no app, regra fixa por
padrão, ajustável).

### 3.3 Hábitos prontos (catálogo curado)
Tabela `hb_templates` (global, versionada): título, área, tipo, sugestão de gatilho, versão mínima, "por que funciona" em uma
linha, aviso de sensibilidade. Os do protótipo: caminhar, meditar, dormir mais cedo, registrar gastos (automático), delivery
por impulso (largar, automático via categoria), cigarro/bebida (largar, custo informado).

### 3.4 Hábitos "medidos pelo Nino" (regras automáticas)
Tabela `hb_auto_rules`: liga um hábito a um fato financeiro que o Nino já tem. Regras iniciais:
| `rule_kind` | Marca como feito quando | Fonte |
|---|---|---|
| `expense_logged_daily` | houve ao menos 1 lançamento no dia | `transactions` / `behavioral_daily_facts` |
| `category_within_cap` | gasto do período na categoria <= teto combinado | `weekend_commitments`, `category_spending_goals` |
| `bill_paid_before_due` | conta vencida na semana foi paga até o dia anterior ao vencimento | recorrências/compromissos |
| `quit_category_clean` | nenhum gasto na categoria/estabelecimentos no dia | `behavioral_transaction_facts` |
| `custom_sql` | **não existe** (fora de escopo) | - |

Regras automáticas só *escrevem* `hb_logs` com `source='auto'`; a pessoa pode contestar (vira `skipped` com nota).

---

## 4. Modelo de dados [proposta]

Prefixo `hb_` (habit builder) para não colidir com `habit_*`/`habits_v2_*`. Padrão do repositório: RLS por `user_id`,
escrita por RPC `SECURITY DEFINER` com idempotência, jobs com `service_role`. Todas as tabelas têm `created_at`, `updated_at`.

### 4.1 Tabelas núcleo

```sql
-- Preferências e modo (uma linha por pessoa)
create table hb_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  enabled boolean not null default false,            -- liga/desliga o lado Hábitos
  last_mode text not null default 'money' check (last_mode in ('money','habits')),
  consent_sensitive_at timestamptz,                   -- consentimento p/ hábitos de saúde/vício (D4)
  max_nudges_per_day smallint not null default 2 check (max_nudges_per_day between 0 and 3),
  nudge_start time, nudge_end time,                   -- janela própria; cai no silêncio geral se nulo
  whatsapp_logging boolean not null default true,     -- aceitar "treinei" pelo WhatsApp
  weekly_review_enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table hb_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  template_id uuid references hb_templates(id),
  kind text not null check (kind in ('do_daily','do_weekly_count','do_quantity','quit')),
  title text not null check (char_length(title) between 2 and 80),
  area text not null check (area in ('body','mind','routine','money','other')),
  sensitivity text not null default 'normal' check (sensitivity in ('normal','health','substance')),
  cue_kind text check (cue_kind in ('after_event','at_time','at_place','free')),
  cue_text text check (char_length(cue_text) <= 120),
  cue_time time,                                     -- horário de reforço (opcional)
  minimum_text text check (char_length(minimum_text) <= 120),
  days_of_week smallint[],                           -- 0..6; nulo = todos (do_daily)
  weekly_target smallint,                            -- do_weekly_count
  quantity_target numeric, quantity_unit text,       -- do_quantity
  quantity_period text check (quantity_period in ('day','week')),
  rest_per_week smallint not null default 1 check (rest_per_week between 0 and 3),
  craving_plan text check (char_length(craving_plan) <= 160),   -- só quit
  status text not null default 'active' check (status in ('active','paused','archived')),
  phase text not null default 'starting' check (phase in ('starting','rooting','firm','maintenance')), -- derivada, gravada pelo job
  started_on date not null,                          -- dia local
  paused_at timestamptz, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on hb_habits (user_id) where status = 'active';
-- limite de 5 hábitos ativos por pessoa aplicado na RPC (P4/anti-sobrecarga), não por constraint

create table hb_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  habit_id uuid not null references hb_habits(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('done','minimum','rest','skipped','quantity')),
  quantity numeric,
  source text not null check (source in ('app','whatsapp','auto','backfill')),
  note text check (char_length(note) <= 280),
  logged_at timestamptz not null default now(),      -- quando foi gravado
  edited_at timestamptz,
  idempotency_key text,
  unique (habit_id, local_date)                       -- um estado por hábito por dia; edição substitui
);
create unique index on hb_logs (user_id, idempotency_key) where idempotency_key is not null;
create index on hb_logs (user_id, local_date);

-- Histórico de alterações de definição (gatilho, meta): a análise antiga não pode mudar com edição nova
create table hb_habit_revisions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references hb_habits(id) on delete cascade,
  user_id uuid not null,
  changed_at timestamptz not null default now(),
  before jsonb not null, after jsonb not null
);

create table hb_cycles (            -- só quit
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid not null references hb_habits(id) on delete cascade,
  started_on date not null, ended_on date,
  end_reason text check (end_reason in ('relapse','manual_reset','archived')),
  baseline_daily_cost numeric,                       -- média diária da categoria nos 90 dias antes do início
  baseline_source text check (baseline_source in ('nino_data','user_informed')),
  baseline_n_days int,                               -- quantos dias sustentam a base
  trigger_tags text[]                                -- o que estava rolando na recaída (opcional)
);

create table hb_cravings (           -- só quit
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid not null references hb_habits(id) on delete cascade,
  occurred_at timestamptz not null default now(), local_date date not null,
  handled boolean,                                    -- null = ainda não respondeu
  context_tags text[]
);

create table hb_automaticity_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid not null references hb_habits(id) on delete cascade,
  due_on date not null, answered_at timestamptz,
  score smallint check (score between 1 and 7),
  skipped boolean not null default false,
  unique (habit_id, due_on)
);
```

### 4.2 Derivadas e materializações (calculadas por job, nunca digitadas)

```sql
create table hb_daily_facts (        -- uma linha por hábito por dia previsto
  habit_id uuid not null references hb_habits(id) on delete cascade,
  user_id uuid not null, local_date date not null,
  expected boolean not null,         -- o hábito estava previsto neste dia?
  outcome text not null check (outcome in ('done','minimum','rest','missed','unlogged','not_expected')),
  strength numeric,                  -- 0..1, valor ao fim do dia
  streak int, rests_used_week smallint,
  primary key (habit_id, local_date)
);

create table hb_user_daily (          -- agregado por pessoa/dia (alimenta Progresso e métricas de produto)
  user_id uuid not null, local_date date not null,
  habits_expected smallint, habits_done smallint, habits_minimum smallint, habits_rest smallint,
  nudges_sent smallint, nudges_interacted smallint,
  primary key (user_id, local_date)
);

create table hb_insights (            -- padrões detectados (estimados), com a evidência que os sustenta
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid references hb_habits(id) on delete set null,
  kind text not null,                 -- weekday_gap | time_of_day | money_pairing | trigger_for_slip | ...
  evidence jsonb not null,            -- n, grupos, médias, janela, método
  strength text not null check (strength in ('weak','moderate','strong')),
  status text not null default 'candidate' check (status in ('candidate','shown','dismissed','acted','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz
);
create table hb_insight_events (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  insight_id uuid references hb_insights(id) on delete cascade, event text not null, created_at timestamptz not null default now());
```

### 4.3 Ligação com dinheiro e regras automáticas

```sql
create table hb_money_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid not null references hb_habits(id) on delete cascade,
  link_kind text not null check (link_kind in ('category','merchant_group','goal','spending_goal','weekend_commitment')),
  ref_id uuid, ref_label text,
  direction text not null check (direction in ('less_is_better','more_is_better'))
);
create table hb_auto_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, habit_id uuid not null references hb_habits(id) on delete cascade,
  rule_kind text not null check (rule_kind in ('expense_logged_daily','category_within_cap','bill_paid_before_due','quit_category_clean')),
  params jsonb not null default '{}'::jsonb, active boolean not null default true
);
create table hb_templates (
  id uuid primary key default gen_random_uuid(), slug text unique not null, version int not null default 1,
  title text not null, area text not null, kind text not null, sensitivity text not null default 'normal',
  cue_suggestion text, minimum_suggestion text, why_it_works text, auto_rule jsonb, active boolean not null default true
);
```

### 4.4 Segurança de dados (RLS e RPC)
- RLS: `using (user_id = auth.uid())` em todas, `with check` idêntico. `hb_templates` leitura para autenticados.
- **Escrita só por RPC** `SECURITY DEFINER` (sem `insert` direto): `hb_create_habit`, `hb_update_habit`, `hb_log` (idempotente,
  valida janela de edição retroativa de 7 dias), `hb_rest`, `hb_pause`, `hb_reset_cycle`, `hb_craving`, `hb_answer_automaticity`.
  Cada RPC valida limites (máx. 5 hábitos ativos, textos, `rest_per_week`) e grava `product_events`.
- Teste de RLS por tabela (como as suítes existentes) e `get_advisors` sem alertas novos.
- Inclusão obrigatória das tabelas `hb_*` em `user-data-export` e `account-deletion-processor` (seção 11).

### 4.5 Volume e custo
8 contas reais: irrelevante hoje. Projeção para 10 mil pessoas com 3 hábitos: ~1,1 milhão de `hb_logs`/ano e ~1,1 milhão de
`hb_daily_facts`/ano. Particionar só acima de ~20 milhões de linhas. Índices acima bastam.

---

## 5. Sinais: o que capturamos e para quê

| Classe | Sinal | Origem | Uso | Sensibilidade |
|---|---|---|---|---|
| Explícito | Marcou feito/mínimo/folga/pulou | App, WhatsApp | Adesão, sequência, força | Normal a saúde |
| Explícito | Hora do registro em relação ao gatilho | `logged_at` | "Melhor momento"; timing de lembrete | Normal |
| Explícito | Automaticidade 1 a 7 | Check-in | Fase, graduação, redução de lembretes | Normal |
| Explícito | "Bateu a vontade", tags de recaída | App/WhatsApp | Plano de vontade, janela de risco | **Saúde/vício** |
| Automático | Lançou gasto no dia; gasto da categoria; conta paga | `behavioral_*`, `transactions` | Hábitos medidos pelo Nino; estimativa de dinheiro | Financeiro |
| Contexto | Dia da semana, fase do mês, fim de semana, feriado | Calendário local | Explicar padrões; antecipar dias fracos | Normal |
| Implícito | Latência entre notificação e resposta | `communication_deliveries.interacted_at` | Fadiga, melhor horário | Normal |
| Implícito | Notificação silenciada/ignorada; pausa; arquivamento | Preferências | Redução de envio, parada automática | Normal |
| Auto-relato | Contexto da recaída ("estresse") | Tags | Ajuste sugerido do plano | **Saúde/vício** |

**Não capturamos**: localização, saúde de sensores, conteúdo de conversas além do necessário para entender a frase,
peso corporal, calorias. (Risco de transtorno alimentar: ver seção 11.)

**Retenção** [proposta]: `hb_logs` e derivadas enquanto a conta existir; `hb_cravings` e tags de recaída 12 meses;
texto livre das notas e frases do WhatsApp com a política de retenção atual de `inbound_messages`.

---

## 6. Indicadores: definições canônicas

Regra do projeto (vinda do refinamento anterior): **uma definição por conceito**. Todas as fórmulas moram em
`src/lib/habits/engine` e são espelhadas para o servidor por script (mesmo padrão do `finance-core`), com teste de paridade.

### 6.1 Por hábito
- **Dia previsto** (`expected`): dia dentro da cadência, desde `started_on`, fora de pausa.
- **Resultado do dia** (`outcome`): `done`, `minimum`, `rest`, `missed` (dia previsto, sem registro, já fechado),
  `unlogged` (dia previsto de hoje, ainda aberto), `not_expected`.
- **Adesão (janela N)** = (`done` + `minimum`·0,6 + `rest`·**exclui**) ÷ (dias previstos fechados com registro ou `missed`).
  - Folga sai do numerador e do denominador. `unlogged` não conta (fica aberto).
  - Peso de `minimum` = 0,6 [proposta, calibrar].
  - Janelas oficiais: 7, 30, 90 dias.
- **Sequência** = dias previstos consecutivos terminando hoje/ontem em que o resultado é `done`, `minimum` ou `rest`.
  `missed` quebra. Dia corrigido depois (`backfill`) recalcula a sequência.
- **Recorde** = maior sequência histórica (guardada, nunca diminui).
- **Força do hábito** (**estimada**): média móvel exponencial sobre os dias previstos fechados.
  `s_t = s_(t-1) + α·(x_t − s_(t-1))`, com `x = 1 (done)`, `0,6 (minimum)`, `0 (missed)`; `rest` não atualiza.
  `α = 1 − 2^(−1/14)` (meia-vida de 14 dias). Só é exibida após 7 dias previstos fechados.
  Faixas de exibição: `< 33%` Começando, `33–66%` Criando raiz, `≥ 66%` Firme. **Calibrar com dados reais** (premissa).
- **Automaticidade** (**autorrelatada**): último `score` e variação em relação ao primeiro. Fase `maintenance` quando
  `score ≥ 6` em 3 check-ins consecutivos **e** força ≥ 66%.
- **Fase** (derivada, função pura): `starting` (força < 33% ou < 14 dias), `rooting`, `firm`, `maintenance`.
  Regressão de fase é permitida (força cai); a UI nunca usa o verbo "perdeu".
- **Taxa de uso da versão mínima** = `minimum` ÷ (`done` + `minimum`) nos últimos 30 dias. Muito alto (> 70%) sugere ajustar
  o hábito (ele está grande demais).

### 6.2 Hábitos de largar (`quit`)
- **Dias sem** = dias entre `started_on` do ciclo atual e hoje.
- **Recorde**, **total de dias sem** (soma dos ciclos), **recomeços** = nº de ciclos encerrados por `relapse`.
- **Taxa de vontade resolvida** = `handled = true` ÷ vontades respondidas (30 dias).
- **Dinheiro que ficou com a pessoa** (**estimado**):
  `est = max(0, baseline_daily_cost × dias_sem − gasto_real_no_escopo_durante_o_ciclo)`.
  - `baseline_daily_cost` = média diária do escopo (categoria/estabelecimentos vinculados) nos **90 dias anteriores** ao
    início do ciclo, com *winsorize* no percentil 95 para um dia atípico não inflar.
  - Mínimo de 28 dias de histórico com pelo menos 3 lançamentos no escopo; abaixo disso, a UI pede valor informado
    (`baseline_source = 'user_informed'`) ou mostra "sem base para estimar".
  - Texto fixo: "Estimativa. Só vira dinheiro guardado quando você move para uma meta."

### 6.3 Por pessoa (tela Progresso)
- **Dias cumpridos (janela)** = soma ponderada de todos os hábitos previstos (mesma fórmula da adesão, agregada).
- **Variação** vs. janela anterior de mesmo tamanho, em pontos percentuais (só com ≥ 14 dias em cada janela).
- **Hábitos firmes** = nº de hábitos em fase `firm` ou `maintenance`.
- **Melhor momento**: adesão por dia da semana e por faixa de horário do registro; só com ≥ 4 semanas.
- **Carga**: nº de hábitos ativos. Acima de 3, o Nino sugere pausar um (sobrecarga é a causa nº 1 de abandono em hábitos).

### 6.4 Insights (padrões estimados)
Regras para qualquer insight de hábito × hábito ou hábito × dinheiro:
1. Janela mínima de 8 semanas e ≥ 4 semanas em cada grupo comparado; abaixo disso a UI diz "amostra pequena" e **não** gera texto de padrão.
2. Diferença mínima: ≥ 20% relativo **e** tamanho de efeito d de Cohen ≥ 0,5 sobre a variável de gasto semanal.
3. Máximo de **1 insight novo por semana por pessoa** (controla comparações múltiplas; a escolha é o de maior força).
4. Linguagem fixa: "Nas semanas em que… aconteceu…". Nunca "porque", "causa", "faz você".
5. Feedback "fez sentido / não fez" grava em `hb_insight_events` e sobe/desce o limiar para aquele tipo.
Para a conta dona, com 13 semanas de dados, quase nenhum insight de dinheiro passará nessa régua. Isso é desejado.

### 6.5 Produto (visão admin, agregada, sem texto de hábito)
- **North Star**: *pessoas ativas com pelo menos um hábito que chegou a 28 dias ativo com adesão ≥ 60%* ÷ pessoas que criaram
  um hábito há ≥ 28 dias.
- **Funil**: abriu Hábitos -> criou o 1º hábito -> 1º registro -> 7º dia com registro -> 28 dias ativo.
- **Retenção do modo**: D1/D7/D28 de pessoas com ≥ 1 registro em Hábitos.
- **Tempo até o 1º registro** após criar (mediana). Meta [proposta]: < 24 h.
- **Qualidade**: razão `minimum`/`done`; hábitos por pessoa (mediana e P90); pausas e arquivamentos por motivo.
- **Atenção (guardrails)**: notificações de hábito por pessoa/dia; taxa de resposta em 2 h; taxa de silenciar o tipo;
  **abandono pós-falha** (parou de registrar nos 7 dias após um `missed`); **tempo para recomeçar** após falha (mediana).
- **Dano**: pessoas com hábito de saúde/vício e ≥ 3 recaídas em 14 dias (aciona revisão do texto de apoio; seção 11).
- **IA**: acerto do interpretador em frases de hábito (conjunto sintético), custo por pessoa/dia, taxa de recusa por guarda de números.

Todas as visões moram em views SQL canônicas (`hb_v_*`) lidas pelo admin; nenhum painel define métrica por conta própria.

### 6.6 Medição com 8 pessoas
Não há poder estatístico para A/B. Estratégia [proposta]:
1. **Intra-pessoa**: antes/depois dentro da conta (por ex., adesão antes e depois de reduzir lembretes).
2. **Séries curtas** com decisão documentada (não declarar vitória em < 4 semanas).
3. **Usuários sintéticos** (já existentes) para o agente e para a lógica de notificação (simulação de 60 dias por persona).
4. **Qualitativo**: 5 pessoas observadas (mesmo protocolo de `habitos-v2-validacao.md`).

---

## 7. Onde usar IA (e onde não)

### 7.1 Regra geral
`deterministic_first_v2` continua valendo: se existe função pura que responde, não chama modelo. A IA nunca grava um número
derivado (sequência, adesão, força, dinheiro). Toda saída de modelo passa por **esquema JSON validado** e, para texto ao
usuário, pela **guarda de números** (grounding) já existente.

### 7.2 Casos de uso

| # | Uso | Modelo/classe | Entrada | Saída (esquema) | Quem decide | Guarda |
|---|---|---|---|---|---|---|
| A1 | **Entender frases de hábito no WhatsApp** ("treinei 40 min", "não rolou hoje", "meditei de novo") | Interpretador V3 (já existe), novas intenções | frase + lista de hábitos ativos | `HabitTurnSpec`: `log_done|log_minimum|log_skip|rest|query_status|craving|relapse`, `habit_ref`, `quantity?` | Executor determinístico grava | Ambiguidade -> pergunta de volta; confiança < limiar -> não grava |
| A2 | **Ajudar a criar o hábito** (conversa curta) | Modelo médio | objetivo livre + hábitos ativos + horários típicos de registro | `HabitDraft`: título, gatilho sugerido (3 opções), versão mínima, cadência | A pessoa edita e aprova | Limites de tamanho, lista de palavras proibidas, sem metas de peso/calorias |
| A3 | **Redigir mensagens** (lembrete, resumo, dia seguinte) | Modelo pequeno, **só variação de tom em campos fixos** | tipo de mensagem + variáveis já calculadas | texto curto | Modelo escolhe entre frases/ordem | Guarda de números; *lint* de culpa/ameaça; fallback para modelo de texto fixo |
| A4 | **Explicar um insight** | Modelo pequeno | `hb_insights.evidence` | 2 frases com ressalvas obrigatórias | Estatística calculada em código | Guarda de números; ressalva "padrão, não causa" injetada pelo código |
| A5 | **Classificar o motivo de uma recaída** (texto livre -> tags) | Modelo pequeno | frase | `trigger_tags[]` + confiança | Se baixa confiança, oferece chips | Só tags de lista fechada |
| A6 | **Sugerir próximo hábito** | Recuperação sobre `hb_templates` + sinais financeiros | padrões do `behavioral_*` | até 2 templates + motivo por regra | Regra de elegibilidade em código | Nunca sugere hábito de saúde sem consentimento |
| A7 | **Resumo semanal narrado** | Camada de narrativa (existe) | métricas da semana | parágrafo curto | Números fixos do código | Guarda de números |

### 7.3 Onde **não** usar IA
Cálculo de adesão/sequência/força/fase; decisão de enviar ou não notificação; janela de horário; elegibilidade de insight;
qualquer aconselhamento clínico (parar de fumar, beber, dieta, medicação).

### 7.4 Roteamento e custo
Usa `model_routing_v2`: classificação e variação de tom no modelo mais barato; criação de hábito no médio; nada no maior.
Orçamento [proposta]: ≤ R$ 0,02 por pessoa/dia em uso normal (estimativa; medir em `agent_runs`). Cache de A3 por
(`kind`, variáveis) dentro do mesmo dia. Gatilho de corte: se o custo mensal de hábitos > X% do custo total do agente, alerta
no admin.

### 7.5 Avaliação da IA
Estende o **conjunto de usuários sintéticos** (`_shared/synthetic`):
- Famílias novas **HB** (hábito): registrar (variações coloquiais, áudio transcrito, gírias), consultar, corrigir ("não, foi ontem"),
  folga, recaída, vontade, criação guiada, fora do escopo, tentativas de abuso (pedir conselho médico, meta de peso extrema).
- Conjunto **held-out** HB-H (mesma disciplina de antes: não se corrige para uma frase do held-out; prova por cenário novo).
- Juiz: acerto da intenção, hábito certo, **não gravou quando ambíguo**, nenhum número inventado, nenhum conselho clínico.
- Critério de entrada em produção: ≥ 95% de acerto em registro simples, **0** gravações erradas no held-out, 0 conselhos clínicos.

### 7.6 Segurança da IA
- Frases sobre autoagressão, transtorno alimentar, abstinência grave ou uso de substâncias com sinais de crise -> resposta
  fixa de apoio (sem modelo), com orientação para ajuda profissional e serviços de apoio, e **suspensão das notificações
  motivacionais** do hábito.
- Nenhum prompt recebe nome, e-mail ou telefone; só `habit_ref` e texto necessário. Os fornecedores de IA seguem a política
  atual do projeto.

---

## 8. Notificações

### 8.1 Princípios
1. **Atenção própria, teto compartilhado**: novo pilar **`rotina`** no alocador. Hábitos nunca disputam com `proteger`
   (conta a vencer, caixa); `proteger` sempre passa na frente.
2. **Máx. 2 mensagens de hábito por dia** (`hb_preferences.max_nudges_per_day`), sempre dentro do teto de 5/dia existente.
3. **Nunca fora do horário permitido** (política já existente). A decisão é tomada na janela; se estiver fora dela, o item
   **aguarda a próxima janela** (`defer_until`), com validade (`stale_policy`) até o fim do dia local. Não "tenta e é barrado".
4. **No máximo 1 lembrete por hábito por dia** e **parada automática**: 3 lembretes seguidos ignorados -> uma pergunta
   ("Quer pausar este hábito?") e depois silêncio até a pessoa voltar.
5. **Lembrete é reforço do gatilho, não o gatilho**: só sai se o hábito **não foi registrado** até `cue_time + 90 min`.
6. **Tom**: curto, sem culpa, sem ameaça de perda ("sua sequência vai zerar" é proibido), sem emoji obrigatório.
7. **Reduz com o tempo**: hábito em `rooting` com automaticidade ≥ 4 reduz lembretes pela metade; em `maintenance` só o check-in mensal.

### 8.2 Catálogo de tipos (linhas novas em `communication_catalog`, família `rotina`)

| `kind` | Quando | Canais | Prior. | Cooldown | Validade | Exemplo de texto (modelo fixo) |
|---|---|---|---|---|---|---|
| `hb_cue_reminder` | Hábito previsto, não registrado até `cue_time`+90 min | WhatsApp, push, app | média | 20 h por hábito | até 22:00 | "Depois do café: meditar 5 minutos. Já fez?" + botões *Feito / Versão mínima / Hoje não* |
| `hb_daily_recap` | 21:30 se houver pendência e a pessoa tem ≥ 2 hábitos | WhatsApp, app | baixa | 20 h | 23:00 | "Hoje: 3 de 4. Falta dormir antes das 23h." |
| `hb_day_after` | Primeiro dia após `missed` (apenas se a pessoa abrir ou o lembrete for permitido) | app, WhatsApp | média | 48 h por hábito | fim do dia | "Ontem passou em branco. Sem drama. Hoje vale o passo mínimo: 3 respirações." |
| `hb_phase_change` | Mudou de fase (força/automaticidade) | app | baixa | 14 dias por hábito | 3 dias | "Meditar já está criando raiz." |
| `hb_streak_milestone` | 7, 14, 30, 60, 100 dias | app (WhatsApp opcional) | baixa | por marco | 2 dias | "14 dias seguidos. Obrigado por ter voltado nos dias difíceis." |
| `hb_automaticity_due` | A cada 14 dias por hábito | app, WhatsApp | média | 14 dias | 3 dias | "Nesses dias, meditar foi mais fácil? Responda de 1 a 7." |
| `hb_graduation_offer` | Critério de `maintenance` | app | baixa | 30 dias | 7 dias | "Este hábito parece firme. Quer passar para manutenção (menos lembretes)?" |
| `hb_slip_support` | Registro de recaída em `quit` | app, WhatsApp | alta (cuidado) | por evento | 24 h | "Aconteceu. Seus 21 dias de recorde continuam. Quer ajustar o plano?" |
| `hb_craving_window` | **Opt-in**: janela de risco prevista (histórico de recaídas por dia/hora) | WhatsApp | média | 3 dias | 2 h | "Costuma ser difícil por volta das 21h. Seu plano: beber água e esperar 10 minutos." |
| `hb_weekly_review` | Domingo 19:00 (se ≥ 1 hábito ativo há ≥ 7 dias) | app, WhatsApp | baixa | 6 dias | 2 dias | "Semana: 82% dos dias. Melhor dia: terça. Fim de semana pede um passo mínimo." |
| `hb_insight_pattern` | Insight válido (seção 6.4) | app | baixa | 7 dias | 7 dias | "Nas semanas com 3+ treinos, o delivery foi menor (R$ 118 vs R$ 187). Amostra pequena." |
| `hb_overload` | > 3 hábitos ativos com adesão em queda | app | baixa | 21 dias | 7 dias | "Muitos hábitos ao mesmo tempo costumam atrapalhar. Quer pausar um?" |
| `hb_pause_offer` | 3 lembretes ignorados ou 7 dias sem registro | app | média | 14 dias | 7 dias | "Faz uns dias que não nos falamos sobre meditar. Quer pausar, ajustar ou continuar?" |
| `hb_setup_nudge` | Hábito criado sem gatilho há 24 h | app | baixa | 7 dias | 2 dias | "Falta definir *quando* você vai fazer. Quer escolher agora?" |

Marcos (`hb_streak_milestone`) são texto de reconhecimento, não recompensa. Nenhum tipo concede pontos.

### 8.3 Canais e restrições do WhatsApp
- Respostas dentro da janela de 24 h são livres. **Mensagem iniciada pelo Nino fora da janela exige modelo aprovado pela Meta**
  (hoje há modelos como `whatsapp_template_v1` em `communication_deliveries`). Para `hb_cue_reminder`, `hb_daily_recap`,
  `hb_weekly_review` e `hb_automaticity_due` será preciso submeter modelos específicos (D5). Até aprovação, esses tipos saem só
  por app/push ou dentro da janela de 24 h.
- Botões de resposta rápida (*Feito*, *Versão mínima*, *Hoje não*): a resposta cai no interpretador (A1) como intenção
  explícita, sem depender de entendimento de frase.
- Cadência mínima de 2 h do WhatsApp continua valendo; `proteger` pode furar (comportamento atual).

### 8.4 Pipeline
`hb-tick` (job horário, :23, longe do :17 do ciclo financeiro) gera **sinais** em `proactive_signals` com `domain='habits'`;
o pipeline existente transforma em **situações**, o alocador aplica pilar `rotina`, o despachante aplica política, e a entrega
grava `block_context.pillar='rotina'`. Telemetria por pilar já existe (`interacted_at`, `acted_at`).
- `proactive_decisions` registra motivo de cada supressão (mesma taxonomia).
- Indicador de saúde (`feature_health_snapshot`) ganha: `hb_engine` (o job rodou), `hb_delivery` (entregas de hábito), `hb_overdelivery`
  (> 2/dia/pessoa) e `hb_ignore_rate` (taxa de ignorados por tipo). **Retenção por horário/cooldown não alerta** (aprendizado do
  alerta de 10/11).

### 8.5 Preferências e controle
Na tela Mais -> Hábitos: ligar/desligar por tipo, horário de lembretes, máx. por dia, "pausar tudo por N dias" e "só pelo app".
Silenciar Hábitos **não** silencia contas a pagar. Comando no WhatsApp: "pausa os hábitos até domingo".

### 8.6 Medição das notificações
Por tipo: enviadas, entregues, `interacted_at` em 2 h, `acted_at` (registrou), silenciadas, tempo até ação, e **efeito na adesão
nos 3 dias seguintes** (intra-pessoa: dias com lembrete vs. sem lembrete em hábitos comparáveis). Critério de manter um tipo:
resposta em 2 h ≥ 25% **ou** efeito positivo na adesão; abaixo de 10% de resposta por 4 semanas, o tipo é desligado.

---

## 9. Arquitetura e integração

### 9.1 Visão
```
App (rotas /app/h/*, chunk lazy) ──> RPCs hb_* (SECURITY DEFINER, idempotentes)
WhatsApp ──> interpretador V3 ──> HabitTurnSpec ──> executor ──> RPC hb_log
                                                     └─ sem confirmação (D3), com "desfazer"
Jobs: hb-rollup (diário) · hb-strength (após cada log + noturno) · hb-tick (horário :23) · hb-insights (semanal)
      hb-auto (a cada 15 min: regras automáticas) · hb-automaticity (diário)
Núcleo: src/lib/habits/engine  ==(script de sincronização)==>  supabase/functions/_shared/habits-core
Saída: proactive_signals(domain='habits') ──> pipeline ──> alocador (pilar rotina) ──> despachante ──> canais
```

### 9.2 Código
- `src/lib/habits/engine/` funções puras: `outcomeForDay`, `adherence`, `streak`, `strength`, `phaseOf`, `cycleStats`,
  `moneyEstimate`, `insightCandidates`. 100% testado, com testes de propriedade (monotonia, idempotência, folga neutra, invariância
  ao fuso).
- `src/pages/habits/*` (Hoje, Hábitos, Detalhe, Criar, Largar, Progresso, Mais) e `src/components/habits/*`.
- `supabase/functions/_shared/habits-core` espelho gerado (`scripts/sync-finance-core.mjs` ganha um segundo alvo).
- `supabase/functions/hb-tick`, `hb-rollup`, `hb-auto`: seguem o padrão das funções existentes (JWT de serviço, idempotência).
- Agente: novas ferramentas read/write em `agent/tools.ts` (registro em `CapabilityRegistryV3`) e prompt do interpretador com
  um bloco de hábitos **apenas quando** a flag está ligada e a pessoa tem ≥ 1 hábito ativo (economia de contexto).

### 9.3 Seletor Dinheiro | Hábitos sem alterar as telas financeiras
Hoje cada rota monta o próprio cabeçalho. Para respeitar P1:
1. **`ModeSwitch`**: componente novo, renderizado por `AppLayout` **acima** do `<Outlet/>` somente nas rotas raiz das abas
   (`/app`, `/app/lancamentos`, `/app/metas`, `/app/mais`) e só com a flag ligada. Altura fixa (~40 px). Com flag desligada,
   nada é renderizado e o DOM é idêntico ao atual.
2. **Árvore de rotas separada** `/app/h/*` com `HabitsShell` (cabeçalho próprio, barra inferior própria: Hoje, Hábitos,
   Progresso, Mais). `AppLayout` escolhe o shell pela rota; páginas financeiras não importam nada de hábitos.
3. **Modo lembrado**: `hb_preferences.last_mode` + `localStorage`. Notificação/WhatsApp de hábito abre direto em `/app/h/hoje`;
   de conta, em `/app/...` atual.
4. **Pontes** (um cartão por lado): o cartão de Hábitos na Home é um componente adicional **opcional**; como é uma mudança na tela
   Início, **fica fora do MVP** até você aprovar (P1). No MVP a ponte existe só dentro de Hábitos ("Seu dinheiro hoje").
5. **Portão de qualidade**: capturas de tela (Playwright) das telas financeiras **com flag desligada e ligada**, comparadas
   pixel a pixel (tolerância pequena) no CI; qualquer diferença fora do `ModeSwitch` falha a PR.

### 9.4 Offline e confiabilidade
O app é web/PWA e tem camada resiliente (`resilientClient.ts`). Registro de hábito é a ação mais frequente e a mais sensível a
falha de rede: fila local de registros com `idempotency_key` (UUID gerado no cliente), reenvio automático e estado
"enviando" visível. O servidor recusa duplicata por `unique (user_id, idempotency_key)`.

### 9.5 Tempo e fuso
Todas as regras usam `local_date` do servidor. Mudança de fuso da pessoa não reescreve o passado (guardado no registro).
Horário de verão/viagem: testes com datas de borda.

### 9.6 Desempenho
Tela Hoje: 1 consulta agregada (RPC `hb_today`) com hábitos, estado do dia, 7 últimos dias e força, p95 < 200 ms. Mapa de 20
semanas: consulta por faixa de datas sobre `hb_daily_facts`. Orçamento de bundle do chunk de hábitos: ≤ 120 KB gzip.

---

## 10. Experiência (resumo do que já foi desenhado)
Protótipo no canvas "Nino Hábitos": Primeira vez · Escolher · Montar plano · **Hoje (versão mista)** · Detalhe · Largar ·
Recaída · Automaticidade · Progresso · Hábitos e dinheiro · WhatsApp · Indicadores · Transição entre os dois lados.
Visual: topo com o degradê do `--gradient-hero` do Nino, folha clara, Manrope/Inter. **Pendente**: replicar o visual novo nas
telas restantes e desenhar a tela de celebração de marcos.

---

## 11. Segurança, privacidade e conformidade

- **Dados sensíveis (LGPD, art. 11)**: hábitos de saúde e de substâncias (sono, cigarro, bebida, exercício) são dado pessoal
  sensível quando ligados a uma pessoa. Consentimento **específico e destacado** na primeira criação de hábito com
  `sensitivity != 'normal'` (`hb_preferences.consent_sensitive_at`), com revogação simples. Sem consentimento: só hábitos
  `normal`. (D4)
- **Minimização**: não coletar peso, calorias, localização. Texto livre limitado a 280 caracteres.
- **Admin**: painéis mostram **agregados e contagens**, nunca `title`, `cue_text`, `note`, `trigger_tags` de uma pessoa
  (mascarar em views `hb_v_admin_*`). Ficha do cliente mostra apenas "N hábitos ativos".
- **Exportação e exclusão**: `user-data-export` e `account-deletion-processor` passam a cobrir todas as tabelas `hb_*`
  (teste que lista as tabelas com coluna `user_id` e falha se faltar alguma).
- **RLS e RPC**: ver 4.4. `get_advisors` (segurança) sem alertas novos antes de cada fase.
- **IA**: ver 7.6. Fornecedores recebem apenas o necessário; texto de hábitos sensíveis não vai para logs de depuração.
- **Risco de dano**: não há metas de peso/calorias; textos de apoio para largar substâncias não substituem profissional, com
  link para ajuda; detecção de crise (7.6).
- **Prevenção de coerção**: sem compartilhamento de hábitos com terceiros no MVP (metas conjuntas existem para dinheiro; hábitos
  compartilhados ficam fora).
- **Auditoria**: `hb_habit_revisions` e eventos em `product_events` (com `pseudo_id`).

---

## 12. Qualidade, testes e observabilidade

### 12.1 Testes
- **Unitários e propriedade** do `habits-core` (formulas da seção 6) e **paridade** app × servidor.
- **RLS**: uma pessoa nunca lê/escreve linha de outra (por tabela e por RPC).
- **Contrato do interpretador**: casos de A1 no conjunto de golden do agente (`NINO_GOLDEN_AO_VIVO`) e nos sintéticos HB.
- **Notificações**: simulação de 60 dias por persona (consistente, esporádica, quebra no fim de semana, recaída, sobrecarregada,
  silenciosa) verificando: nunca > 2/dia, nunca fora do horário, parada automática após 3 ignorados, nada em cima de `proteger`.
- **Copy**: *linter* de frases proibidas ("falhou", "perdeu", "vai zerar", "desista", "você deveria") nos modelos e nas saídas de IA.
- **Regressão visual das telas financeiras** (9.3.5) e e2e dos fluxos de hábitos.
- **Migração**: aditiva, sem lock longo, reversível; teste em cópia.

### 12.2 Observabilidade
`feature_health_snapshot` ganha linhas `hb_*` (8.4). Painel admin "Hábitos" com o funil, a North Star e os guardrails (6.5).
Erros de RPC e de interpretação em `ops_alerts` só quando persistentes (mesma regra de amostra mínima do resto).

---

## 13. Plano de entrega (fases, flags e critérios de aceite)

Tudo atrás de `habits_v1` (por usuário, desligada). Cada fase termina com **portão**: testes, regressão visual verde,
`get_advisors` limpo, replay/simulação quando houver notificação.

| Fase | Entrega | Critério de aceite | Porte* |
|---|---|---|---|
| **F0 Fundação** | Esquema `hb_*` + RLS + RPCs; `habits-core` com testes; flag; `ModeSwitch` + `HabitsShell` vazios; regressão visual das telas financeiras | RLS provada; paridade verde; capturas financeiras idênticas com flag on/off | M |
| **F1 Núcleo no app** | Criar (templates e livre), Hoje, Detalhe, registrar/folga/mínimo/corrigir, Progresso básico; sem notificações, sem IA | A conta dona usa 14 dias sem bug de dado; p95 de `hb_today` < 200 ms | G |
| **F2 WhatsApp** | A1 (registrar e consultar por frase e botões), `hb_cue_reminder` e `hb_daily_recap` (modelos Meta), pilar `rotina`, `hb-tick`, preferências | ≥ 95% no sintético simples; 0 gravação errada no held-out; simulação de 60 dias sem violar teto/horário | G |
| **F3 Largar** | `quit`, ciclos, vontade, recaída sem culpa, estimativa de dinheiro, `hb_slip_support`, consentimento sensível | Estimativa auditada em 3 casos reais da conta dona; textos revisados; detecção de crise testada | M |
| **F4 Automaticidade e fases** | Check-in 1–7, fase, graduação, redução de lembretes, `hb_automaticity_due`, `hb_graduation_offer` | Calibração da força/fases em dados reais (ajusta α e limiares com registro em doc) | M |
| **F5 Dinheiro** | Hábitos medidos pelo Nino (`hb_auto_rules`), "Hábitos e dinheiro", insights (6.4) com régua estatística | Nenhum insight acima da régua com amostra pequena; regra automática concorda com marcação manual ≥ 95% | M |
| **F6 IA de criação e narrativa** | A2, A3, A4, A5, A6, A7; custo medido | Custo ≤ orçamento; 0 conselho clínico; guarda de números 0 violações | M |
| **F7 Abertura gradual** | 5 pessoas observadas; depois lista de acesso; painel admin completo; decisão sobre cobrança (D6) | Passa critérios de `habitos-v2-validacao.md` adaptados; guardrails (6.5) saudáveis por 4 semanas | M |

*Porte relativo: M ≈ 1–2 semanas de trabalho focado de uma pessoa com agente; G ≈ 2–4 semanas. Estimativa **[premissa]**, sem base
histórica para Hábitos; ajustar após F0.

**Dependências**: F2 depende da aprovação de modelos Meta (D5) e de decisão D3; F5 depende de ≥ 8 semanas de dados para
qualquer insight; F7 depende de D4 e D6.

---

## 14. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Colisão de nome com "Hábitos v2" gera confusão na UI e no código | Alta | Média | D1; prefixo `hb_`; renomear a página atual para "Padrões" |
| Notificação em excesso causa abandono (já vimos fadiga e alertas falsos) | Média | Alta | Pilar próprio, teto 2/dia, parada automática, medir silenciar; simulação antes de ligar |
| Dado sensível vaza ou é visto pelo admin | Baixa | Muito alta | RLS, views mascaradas, consentimento, teste de exportação/exclusão |
| Estimativa de dinheiro "parece garantia" | Média | Alta | Rótulo fixo "estimativa", base mínima, fórmula contrafactual com gasto real |
| IA grava marcação errada | Média | Média | Só grava com confiança alta; senão pergunta; "desfazer"; held-out com 0 erro |
| Sobrecarga: pessoa cria muitos hábitos | Alta | Média | Limite de 5, sugestão de pausa > 3, onboarding de "um por vez" |
| Efeito não comprovável com 8 usuários | Certa | Média | Medição intra-pessoa + qualitativo; não declarar vitória cedo |
| Regressão visual nas telas financeiras | Baixa | Alta | Captura pixel a pixel no CI; flag; shell separado |
| Meta recusa modelos de WhatsApp | Média | Média | Lançar F2 só com janela de 24 h e app/push |
| Fórmula de força mal calibrada (muito lenta ou rápida) | Alta | Média | Calibrar na F4; versão da fórmula gravada (`formula_version`) em `hb_daily_facts` |

---

## 15. Decisões em aberto

- **D1. Nome e rota.** Hoje "Hábitos" é a página de padrões financeiros (flag `habits_v2_access`). Opções: (a) novo lado se chama
  **Hábitos** e a página atual vira **Padrões**; (b) novo lado se chama **Rotina**. *Recomendo (a)*, com a página atual
  mantida igual até a F7.
- **D2. Gamificação legada.** `xp_events`, `Desafios`, `user_gamification` e a família `achievement` contradizem o princípio.
  Opções: (a) manter como está e **nunca** ligar nada de hábitos a XP; (b) aposentar com registro histórico (padrão B7). *Recomendo
  (a) agora, (b) depois da F7.* Não toco em nada de Desafios neste projeto.
- **D3. Marcar sem confirmação no WhatsApp.** Marcar hábito é de baixo risco e frequente; a regra atual (rascunho + confirmação)
  deixaria o fluxo pesado. *Recomendo gravar direto com "desfazer" e confirmar só quando houver ambiguidade.*
- **D4. Dado sensível.** Consentimento específico (recomendo) e admin só com agregados (recomendo). Validar com assessoria
  jurídica antes da F7.
- **D5. Modelos do WhatsApp (Meta).** Preciso do processo que vocês já usam para aprovar modelos novos e do prazo típico.
- **D6. Plano.** Hábitos pago, gratuito ou parte do plano? (hoje não há cobrança integrada.)
- **D7. Ponte na Home.** O cartão "Hábitos de hoje" na tela Início é uma mudança na tela financeira. Fica fora até você aprovar.
- **D8. Quem entra primeiro.** Recomendo só a conta dona até o fim da F2.

---

## 16. O que não foi verificado
- Padrões de RLS e nome exato de políticas nas tabelas existentes (usar `get_advisors` e uma tabela recente como molde na F0).
- Quantos modelos de WhatsApp aprovados já existem e como é o fluxo de aprovação.
- Se o app tem camada nativa (push nativo) com as mesmas regras de silêncio; a doc cita push web/nativo.
- Custo real por pessoa/dia da IA de hábitos (só há estimativa; medir na F2).
- Impacto de `ModeSwitch` em telas desktop (`DesktopSidebar`): no desktop o seletor pode viver na barra lateral; desenhar na F0.
- Qualquer efeito comportamental de hábitos sobre finanças: **não há dado nem estudo definitivo**. O texto de produto promete
  apenas "mostrar o que aconteceu com você".

---

## Apêndice A. Eventos de produto (`product_event_types`)
`hb_mode_switched`, `hb_onboarding_viewed`, `hb_habit_created` (área, tipo, via template/livre/IA), `hb_log_recorded`
(status, origem, latência até o registro), `hb_log_undone`, `hb_rest_used`, `hb_habit_paused`, `hb_habit_archived` (motivo),
`hb_cycle_reset`, `hb_craving_logged`, `hb_automaticity_answered`, `hb_phase_changed`, `hb_nudge_sent|interacted|acted|muted`,
`hb_insight_shown|useful|not_useful`, `hb_ai_intent_recognized` (intenção, confiança em faixas), `hb_ai_refused_guard`.
Sem texto livre nem título nos eventos. `pseudo_id` como nos demais.

## Apêndice B. Pseudocódigo da força e da adesão
```ts
// habits-core/strength.ts (puro)
const ALPHA = 1 - Math.pow(2, -1 / 14);
const X = { done: 1, minimum: 0.6, missed: 0 } as const;
export function strengthSeries(days: Array<{ outcome: Outcome }>): number[] {
  let s = 0; const out: number[] = [];
  for (const d of days) {
    if (d.outcome === 'rest' || d.outcome === 'not_expected' || d.outcome === 'unlogged') { out.push(s); continue; }
    s = s + ALPHA * (X[d.outcome] - s);
    out.push(s);
  }
  return out;
}
export function adherence(days: Array<{ outcome: Outcome }>) {
  let num = 0, den = 0;
  for (const d of days) {
    if (d.outcome === 'done') { num += 1; den += 1; }
    else if (d.outcome === 'minimum') { num += 0.6; den += 1; }
    else if (d.outcome === 'missed') { den += 1; }
  }
  return den === 0 ? null : num / den;
}
```

## Apêndice C. Taxonomia de recaída e de vontade (lista fechada)
`cansaco`, `estresse`, `fome`, `tedio`, `convite_social`, `emocao_forte`, `rotina_quebrada`, `outro`.

## Apêndice D. Frases proibidas e tom
Proibido: "falhou", "perdeu", "vai zerar", "desista", "fraco", "você deveria", "último aviso", contagem regressiva de perda de
sequência, comparação com outras pessoas, promessas de resultado de saúde ou financeiro.
Preferido: "ontem passou em branco", "hoje vale o passo mínimo", "continua com você", "retomar".

## Apêndice E. Consultas de exemplo (métricas)
```sql
-- North Star (28 dias): pessoas com ao menos 1 hábito ativo há 28 dias e adesão >= 60%
with h as (
  select h.user_id, h.id, h.started_on
  from hb_habits h where h.status = 'active' and h.started_on <= (current_date - 28)
), a as (
  select f.habit_id,
         sum(case f.outcome when 'done' then 1 when 'minimum' then 0.6 else 0 end)
         / nullif(count(*) filter (where f.outcome in ('done','minimum','missed')), 0) as adh
  from hb_daily_facts f where f.local_date >= current_date - 28 group by 1
)
select count(distinct h.user_id) filter (where a.adh >= 0.6) * 1.0 / nullif(count(distinct h.user_id), 0) as north_star
from h left join a on a.habit_id = h.id;

-- Abandono pós-falha: parou de registrar nos 7 dias seguintes a um dia 'missed'
select count(*) filter (where not exists (
         select 1 from hb_logs l where l.habit_id = f.habit_id and l.local_date between f.local_date + 1 and f.local_date + 7))
       * 1.0 / count(*) as abandono_pos_falha
from hb_daily_facts f where f.outcome = 'missed' and f.local_date < current_date - 7;
```

---

## Apêndice F. Atualização do M1 (F0 + F1): o que foi construído e o que mudou em relação ao plano

Construído e testado: tabelas `hb_access`, `hb_preferences`, `hb_templates` (6 modelos), `hb_habits`, `hb_logs`, `hb_habit_revisions`;
RPCs `hb_enabled`, `hb_local_today`, `hb_set_mode`, `hb_create_habit`, `hb_update_habit`, `hb_set_status`, `hb_log`, `hb_unlog`,
`hb_snapshot`; motor `src/lib/habits/engine` (32 testes) e agregação (`aggregate.ts`, 6 testes); lado Hábitos em `/h/*`
(Hoje, Hábitos, Detalhe, Novo, Progresso, Mais) e o seletor Dinheiro | Hábitos. A migração é `20261111150000_habitos_nucleo.sql`
(aplicada e validada em transação com desfazer: idempotência, janela de 7 dias, orçamento de folgas, limite de 5 hábitos,
consentimento sensível, RLS entre pessoas, insert direto negado).

Diferenças deliberadas em relação ao desenho original:

| Item | Plano | M1 | Motivo |
|---|---|---|---|
| Liberação | flag `habits_v1` em `agent_runtime_flags` | tabela `hb_access` + `hb_enabled()` | Padrão do projeto para liberar por pessoa (como `habits_v2_access`); `agent_runtime_flags` é global |
| Rotas | `/app/h/*` | `/h/*`, fora do `AppLayout` e do bloco `/app` | Zero contato com o registro de navegação financeiro; teste de contrato garante |
| `hb_daily_facts`, `hb_user_daily` | materializadas por job | **não existem**; o motor calcula a partir de `hb_logs` | Com poucos dados, calcular na leitura é mais simples e evita divergência; materializar quando houver volume ou jobs (F2+) |
| Espelho no servidor (`habits-core` em `_shared`) | no F0 | **adiado para o F2** | Ainda não há consumidor no servidor (lembretes, WhatsApp) |
| Pausar hábito | previsto no F1 | **só arquivar** | Pausar exige guardar os intervalos de pausa (`hb_pauses`) para os dias parados não virarem falha; entra com uma segunda migração |
| Sequência e folga | folga contava na sequência | folga **não quebra e não soma** | Evita inflar a sequência com folgas |
| Virada do dia | 03:00 (proposta) | 03:00, calculada no servidor (`hb_local_today`) | Registrar "dormi cedo" às 00:30 vale para o dia anterior |
| Telemetria `product_events` | nas RPCs | **adiada** | O funil do M1 já sai das próprias tabelas `hb_*`; a gravação em `product_events` exige o mapeamento `pseudo_id` |
| Regressão visual (capturas) | Playwright com flag ligada/desligada | **testes de contrato** (só `AppLayout` e `App.tsx` importam Hábitos; `ModeSwitch` não renderiza nada sem liberação) | Cobre o risco estrutural; capturas de tela ficam como reforço antes de abrir a mais pessoas |
| Ponte na Home | dentro do M1 | **fora** (D7) | É mudança na tela Início |
| Abrir o lado ao ficar `habits` | "abre onde parou" | só lembra o modo (`hb_set_mode`); **não redireciona** ao abrir o app | Não altera a experiência atual de quem abre o Nino |

Para ligar para uma pessoa: `insert into hb_access(user_id, note) values ('<uuid>', 'piloto');`

---

## Apêndice G. Atualização do F2 (WhatsApp e lembretes): o que foi construído e o que mudou

Construído e testado (127 testes de Hábitos; suítes de política de envio e pilares seguem verdes):

- **Espelho do motor no servidor** (`_shared/habits-core`, gerado por `scripts/sync-habits-core.mjs`, com teste de paridade).
- **Migração 2** (`20261111210000_habitos_f2_whatsapp_lembretes.sql`): preferências (`nudges_enabled`, `whatsapp_logging`,
  `max_nudges_per_day`), `hb_set_prefs`, `hb_log_as` / `hb_unlog_as` / `hb_snapshot_as` (só para o serviço; a `hb_log` do app
  passa a delegar para a mesma regra) e as duas linhas de catálogo (`hb_cue_reminder`, `hb_daily_recap`).
- **Marcar e consultar pelo WhatsApp** (`_shared/habits/interpret.ts` + `whatsappReply.ts`, gancho no `whatsapp-webhook` logo depois da
  resposta do fim de semana): "meditei", "li 12 páginas", "caminhei ontem", "feito", "hoje não", "folga", "só o mínimo",
  "como estão meus hábitos?", "desfaz". **Determinístico, sem IA**: casa a frase com os hábitos ativos da pessoa e **falha fechado**
  (dúvida, pergunta, assunto de dinheiro ou erro devolvem a conversa ao agente, como antes). Empate entre hábitos vira pergunta.
- **Lembretes** (`_shared/habits/reminders.ts` + `reminderSuggestions.ts`, plugados no `ProactiveEngineV2`): lembrete do gatilho
  (só 90 min depois do horário, só se não foi registrado, um por horário do dia, nunca depois das 22h), resumo do dia (21:30–23:00,
  com 2+ hábitos e pendência), máximo pessoal por dia (padrão 2, teto 3) e **parada automática** depois de 3 lembretes seguidos
  ignorados (a menos que a pessoa tenha registrado algo nas últimas 24 h).
- **Escopo próprio na política de envio** (`intelligence/habitKinds.ts`, `communicationPolicy.ts`, `CommunicationDispatcherV3.ts`):
  descobri no código três regras que travariam hábitos e foram tratadas só para os tipos `hb_*` (o comportamento dos demais tipos
  não muda; as suítes existentes seguem verdes): (1) intervalo fixo de 24 h **por tipo** (`kind_cooldown_24h`), que só deixaria
  passar um lembrete por dia; (2) cota diária e semanal **compartilhada com os alertas financeiros**; (3) piso de materialidade em
  reais ("below_materiality"), que descartaria qualquer aviso sem valor em dinheiro. Também: consentimento de insight financeiro não
  se aplica a hábitos (a pessoa liga/desliga em Hábitos) e o texto é fixo (nunca passa pela camada de linguagem).
- **Tela Mais**: chaves para ligar/desligar lembretes e "marcar pelo WhatsApp".

Diferenças em relação ao plano e pendências:

| Item | Plano | F2 | Motivo |
|---|---|---|---|
| Entendimento das frases | interpretador V3 (LLM) | **regras determinísticas** | Menos risco, custo zero e sem mexer no núcleo do agente; cobre os casos comuns. Frases fora do padrão continuam indo ao agente e **não** registram. Se a cobertura for baixa na prática, o passo seguinte é um classificador pequeno (F6) |
| Pilar `rotina` próprio | novo pilar | tipos tratados como **rotina assinada** (`ROUTINE_KINDS`) + escopo próprio na política | Não toca a taxonomia de pilares; o teto de 5/dia do WhatsApp continua valendo |
| Botões de resposta rápida | Feito / Mínimo / Hoje não | **resposta por texto** ("feito", "mínimo", "hoje não") | O envio atual é texto; botões exigiriam o formato interativo da Meta |
| Modelos de WhatsApp (D5) | modelos novos aprovados | **reaproveita o envio proativo existente** | O despachante já entrega fora da janela de 24 h com o modelo genérico aprovado; confirmar na primeira entrega real |
| `hb_streak_milestone`, `hb_day_after`, `hb_weekly_review`, `hb_phase_change`, `hb_automaticity_due` etc. | no F2 (parte) | **não incluídos** | Ficam para F4/F3; F2 entrega só os dois tipos que fecham o ciclo diário |
| Medição de resposta | `interacted_at` / `acted_at` | o webhook já chama `recordInteraction`; o registro por WhatsApp chama `recordAction("habit_log_*")` | Mesma telemetria dos demais tipos |

**Antes de ligar para alguém**: aplicar a migração 2 (as funções `hb_*_as` e as preferências não existem sem ela; o webhook e os
lembretes tratam a ausência como "sem Hábitos" e seguem o caminho normal, e a tela Mais mostra erro ao salvar preferências).
