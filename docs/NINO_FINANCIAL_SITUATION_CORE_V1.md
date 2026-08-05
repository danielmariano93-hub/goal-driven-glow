# Nino Financial Situation Core v1

## Objetivo

Substituir o fluxo `detector -> card` por `fatos -> situações -> diagnóstico -> superfícies`.

O patch mantém a base financeira e comportamental existente, mas altera o núcleo de decisão:

- `financial_situations` passa a representar o que está acontecendo com o usuário;
- `financial_situation_evidence` explica por que a situação foi criada;
- `financial_situation_actions` define uma ação executável;
- `nino_diagnosis_snapshots` consolida e preserva um payload imutável da leitura principal e das situações de apoio;
- `src/lib/nino/diagnosis.ts` define o contrato TypeScript/Zod canônico;
- `nino_intelligence_items` permanece somente como read model para compatibilidade da UI atual;
- Home, Nino, Relatórios, conversas no App/WhatsApp e comunicação proativa passam a consumir o mesmo diagnóstico;
- fontes legadas continuam disponíveis para histórico e rollback, mas deixam de produzir a verdade atual.

## Situações implementadas

- mudança do ritmo de gastos;
- categoria responsável pela mudança;
- desequilíbrio entre renda operacional e consumo;
- uso de resgates de investimento para sustentar o caixa;
- pressão de fatura;
- viabilidade de meta;
- progresso de dívida;
- pressão de compromissos recorrentes;
- padrões comportamentais com qualidade mínima;
- antecipações já validadas;
- lançamentos sem categoria;
- possíveis duplicidades agrupadas;
- pagamentos da Divisão do Rolê aguardando confirmação.

## Regras contábeis importantes

O consumo usa exclusivamente transações confirmadas com:

- `type = expense`;
- `movement_kind = transaction`.

Portanto, pagamento de fatura, dívida, aplicação, resgate, transferência e estorno não são promovidos a consumo ou recomendação de corte.

## Conexão com o agente

`AgentCore` recebe um recorte compacto do diagnóstico canônico antes de planejar a resposta. Esse contexto mantém App e WhatsApp alinhados com Home e Relatórios, mas não substitui as tools factuais: valores, períodos, listas e gráficos continuam vindo das fontes financeiras canônicas.

## Aprendizado e auditoria

Ações e feedbacks da UI são propagados para `financial_situation_actions`, `financial_situation_feedback` e, quando aplicável, `anticipation_outcomes`. O snapshot mantém um payload imutável para auditoria histórica.

## Rollout de comunicação

A migration inicializa o núcleo em `shadow`, valida todos os usuários dentro da mesma transação e só então muda para `active`. A comunicação nasce em `app_only`, evitando disparo proativo imediato no WhatsApp. Depois da homologação dos diagnósticos e rotas:

```sql
update public.nino_diagnosis_config
set communication_mode = 'full', updated_at = now()
where singleton = true;
```

O modo `full` preserva as políticas existentes de canal, horário, frequência e deduplicação.

## Compatibilidade e rollback

A migration renomeia e preserva:

- `nino_rebuild_items` como `nino_legacy_rebuild_items`;
- `nino_intelligence_tick` como `nino_legacy_intelligence_tick`;
- `my_nino_refresh` como `my_nino_refresh_legacy`.

Rollback operacional:

```sql
select public.nino_diagnosis_rollback();
```

O rollback requer usuário com papel administrativo (`admin`/`platform_admin`).

## Homologação histórica

```sql
select public.nino_diagnosis_backtest(
  '<USER_ID>'::uuid,
  current_date - 120,
  current_date,
  7
);
```

O backtest usa `run_mode = backtest` e não altera as superfícies atuais. Para evitar vazamento temporal, situações dependentes apenas do estado presente — como saldo atual de dívida, meta e recorrências — não são reconstruídas retroativamente sem snapshots históricos.

## Smoke checks

```sql
select * from public.nino_diagnosis_config;

select situation_type, status, severity, relevance_score, headline
from public.financial_situations
where user_id = '<USER_ID>' and run_mode = 'live'
order by relevance_score desc;

select overall_state, confidence, primary_situation_id, supporting_situation_ids
from public.nino_diagnosis_snapshots
where user_id = '<USER_ID>' and run_mode = 'live' and is_current;

select source, kind, category, title, priority
from public.nino_intelligence_items
where user_id = '<USER_ID>' and status = 'active'
order by priority desc;
```

## Aplicação

```bash
git apply --check MEU_NINO_FINANCIAL_SITUATION_CORE_V1.patch
git apply MEU_NINO_FINANCIAL_SITUATION_CORE_V1.patch
npm test
npx tsc --noEmit
npm run build
```

Depois do merge, aplique as migrations e publique normalmente pelo pipeline já usado pelo projeto.
