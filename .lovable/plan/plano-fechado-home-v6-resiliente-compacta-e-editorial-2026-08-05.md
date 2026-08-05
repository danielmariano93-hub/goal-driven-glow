# Plano fechado — Home v6 resiliente, compacta e editorial

## Diagnóstico comprovado

### Causa do desaparecimento dos dados

O problema não está nos cálculos de saldo ou ritmo. Ele ocorre antes do motor financeiro:

- `src/lib/hooks/useFinancialSnapshot.ts:53-61` consulta `recurring_rules.next_due_date`.
- O schema real de `public.recurring_rules` não possui essa coluna; ele possui `start_date`, `end_date`, `day_of_month`, `weekday` e os demais campos da regra.
- A mesma consulta foi executada diretamente no banco durante a auditoria e retornou `42703: column "next_due_date" does not exist`.
- Em `useFinancialSnapshot.ts:119-126`, o primeiro erro entre 14 consultas alimenta `error`, e `if (loading || error) return null` descarta o snapshot inteiro.
- `Index.tsx:79-95` então converte a ausência do snapshot em `0` ou `null`, produzindo “Resumo indisponível agora”, “— /dia” e a perda do gráfico.
- A Orientação do Nino continua porque usa outra fonte, `my_nino_diagnosis_context`, independente do hook financeiro.

Não há evidência de falha de RLS ou de concessão de leitura: as tabelas auditadas têm RLS ativo, políticas por proprietário e `authenticated` possui `SELECT`. Os campos consultados em cartões, parcelas, faturas e movimentos de investimento existem. A falha atual comprovada é a coluna inexistente em `recurring_rules`.

### Outras fragilidades confirmadas

- `partial` é calculado pelo hook, mas nunca permite gerar dados parciais e não é consumido pela Home.
- `loading` também agrega as 14 fontes, então uma fonte complementar lenta prolonga o bloqueio total.
- `refetch` repete indiscriminadamente todas as fontes.
- As query keys `recurring_rules_active` e `investment_movements_all` não estão alinhadas às chaves centrais de invalidação.
- A Home passa zeros para campos ausentes, confundindo “zero real” com “fonte indisponível”.
- O período atual é formatado como duas datas longas com ano repetido.
- O card do Nino imprime quase todo o contrato na primeira camada.
- O CTA real do usuário está persistido como `Revisar a formação do saldo`, com rota genérica `/app/relatorios`.

## Arquitetura de dados resiliente

### 1. Corrigir a consulta regressiva sem migration

Substituir o uso de `next_due_date` em `useFinancialSnapshot` pelo contrato real de recorrência:

- consultar `start_date`, `end_date`, `day_of_month`, `weekday`, `frequency`, `status`, `kind` e `amount`;
- derivar a próxima ocorrência com o utilitário determinístico já existente em `src/lib/recurring/schedule.ts`;
- não alterar nenhuma fórmula financeira nem criar uma nova RPC.

Também revisar as duas referências equivalentes em `insights-generate` e `financial-reports-generate`, porque elas repetem o mesmo campo inexistente e podem causar falhas fora da Home.

### 2. Classificar fontes explicitamente

**Críticas para saldo e ritmo**

| Fonte | Capacidades dependentes |
|---|---|
| `accounts` | existência das contas e saldo |
| `account_balance_snapshots` | âncora confiável de saldo |
| `transactions` | saldo após a âncora, ritmo, série e comparação |

Somente erro nessas fontes torna o resultado `unavailable`. A ausência legítima de linhas continua sendo estado vazio, não erro.

**Complementares**

- `recurring_rules`: compromissos e entradas futuras;
- `credit_cards`, `credit_card_statements`, `credit_card_installments`: fatura e exposição de cartão;
- `categories`: nomes, breakdown e refinamento do ritmo típico;
- `investments`, `investment_movements`, `debts`: patrimônio e pontes patrimoniais;
- `category_spending_goals`, `goals`, `goal_contributions`: metas e progresso.

Categorias ausentes não impedem o ritmo bruto ou a série diária; apenas tornam indisponíveis os refinamentos que dependem da classificação. Investimentos e dívidas não impedem saldo ou ritmo.

### 3. Novo contrato do hook

```ts
type SnapshotSource =
  | "accounts" | "accountSnapshots" | "transactions"
  | "recurringRules" | "creditCards" | "cardStatements"
  | "cardInstallments" | "categories" | "investments"
  | "investmentMovements" | "debts" | "categoryGoals"
  | "goals" | "goalContributions";

type SnapshotSourceError = {
  source: SnapshotSource;
  critical: boolean;
  kind: "permission" | "schema" | "network" | "timeout" | "unknown";
};

type SnapshotAvailability = {
  balance: "available" | "unavailable";
  rhythm: "available" | "unavailable";
  rhythmComparison: "available" | "unavailable";
  projection: "available" | "partial" | "unavailable";
  cardExposure: "available" | "unavailable";
  netWorth: "available" | "partial" | "unavailable";
  goals: "available" | "unavailable";
};

type FinancialSnapshotResult = {
  data: FinancialSnapshot | null;
  loading: boolean;
  criticalError: Error | null;
  partialErrors: SnapshotSourceError[];
  completeness: "complete" | "partial" | "unavailable";
  missingSources: SnapshotSource[];
  availability: SnapshotAvailability;
  refetchCritical: () => Promise<void>;
  refetchMissing: () => Promise<void>;
  refetchAll: () => Promise<void>;
};
```

O motor `computeFinancialSnapshot` permanece intacto. Um adaptador de apresentação da Home aplicará `availability` antes de expor valores: número calculado com fonte ausente não será mostrado como zero. Assim, saldo e ritmo continuam disponíveis, enquanto projeção, fatura, patrimônio ou metas ficam explicitamente parciais/indisponíveis conforme suas dependências.

### 4. Diagnóstico estruturado e seguro

Em desenvolvimento, registrar um evento por falha:

```text
[financial-snapshot-source-error]
source, critical, queryKey, errorCode, errorKind, periodKind
```

Não registrar `user_id`, valores, descrições, contas, lançamentos, payloads nem mensagens brutas que possam conter dados financeiros. Em produção, manter apenas a classificação agregável da fonte/erro. Erros nunca serão engolidos: ficam no contrato e são apresentados de forma não técnica.

## UX por estado

### Disponível hoje

- **Com dados — até 175 px:** rótulo, valor, entradas/compromissos apenas quando disponíveis e relevantes, “Ver composição”.
- **Parcial — 110–130 px:** manter saldo atual quando as três fontes críticas estão válidas; aviso curto “Algumas informações ainda não foram atualizadas” e ação “Atualizar”. Não exibir projeção ou composição dependente de fonte ausente.
- **Indisponível — 110–130 px:** “Não foi possível atualizar seu saldo”, “Seus outros dados continuam disponíveis” e “Tentar novamente”. Remover divisória, ícone decorativo e espaços da composição.
- Não implementar cache de “último saldo confiável” nesta rodada sem timestamp e proveniência já existentes. Se o React Query ainda tiver dado válido anterior, ele só será exibido como desatualizado com `dataUpdatedAt` visível e sem misturá-lo a dados novos.

### Ritmo de gastos

- **Com dados atuais e anteriores — até ~280 px:** média atual, comparação, típico, gráfico e legenda.
- **Com dados atuais, sem período anterior:** manter valor e série atual; texto curto de comparativo indisponível; não ocultar o gráfico.
- **Sem dados atuais — 140–170 px:** mensagem compacta, sem área reservada de 120/150 px para gráfico.
- **Erro parcial:** manter ritmo/série atual se transações carregaram; omitir apenas o comparativo ou refinamento afetado e oferecer “Atualizar”.
- A presença de uma série com dias zerados não será confundida com movimentação real; o estado usa total/contagem elegível, não apenas `series.length`.

### Período

Criar formatador puro e testável:

- mesmo mês/ano atual: `1–5 de agosto`;
- meses diferentes no ano atual: `28 de julho–5 de agosto`;
- mês inteiro: `Agosto de 2026`;
- ano apenas quando necessário;
- o seletor mantém as datas completas internamente.

### Ações rápidas

- reduzir para 72–82 px;
- remover a grande superfície contínua de cada atalho;
- manter ícone em superfície suave, label com quebra natural e alvo de toque de 44 px;
- não competir com o card de orientação.

## Orientação do Nino

### Adaptador editorial determinístico

Criar `buildHomeGuidancePresentation(diagnosis, projectionAvailability)` em `src/lib/nino/homeGuidance.ts`:

```ts
type HomeGuidancePresentation = {
  severity: "informative" | "attention" | "critical";
  title: string;
  supportingText: string | null;
  action: FinancialSituationAction | null;
  hasDetails: boolean;
};
```

Regras:

1. título = `one_line_summary` ou `headline`;
2. selecionar no máximo um texto de apoio, compondo apenas trechos complementares na ordem causa/contraponto → consequência → forecast;
3. limite semântico de 240 caracteres, com corte por sentença/palavra no adaptador — nunca apenas CSS;
4. remover repetição normalizada entre título, causa, consequência e forecast;
5. não mostrar metodologia, confiança, timestamp, evidências, composição de projeção ou feedback na primeira camada;
6. não usar forecast/projeção quando a disponibilidade correspondente estiver parcial ou indisponível;
7. expor no máximo uma ação e não fabricar botão quando ela não for confiável;
8. mover metodologia, evidências, projeção, confiança qualitativa, feedback e timestamp para “Entender análise”.

O texto hoje usado como `cause_summary` — “O cálculo considera apenas renda operacional...” — passará automaticamente para o detalhe por ser metodologia, sem alterar a verdade do diagnóstico.

### Ação canônica e coerência entre canais

A fonte atual é `financial_situation_actions`, preenchida por `nino_diag_select_action`/`nino_evaluate_financial_situations` e projetada para App, Nino e WhatsApp. O banco confirma que a ação ativa do usuário real ainda contém:

- título: `Revisar a formação do saldo`;
- rota: `/app/relatorios`;
- explicação: ausente.

O seletor mais recente já contém uma versão melhor para `cash_flow_imbalance`, mas ações persistidas anteriormente não foram atualizadas. A execução fará uma migration pequena e idempotente para:

- consolidar a ação canônica por `situation_type` com título, explicação e rota contextual;
- atualizar apenas ações ativas geradas pelo motor que ainda tenham copies internas antigas;
- preservar ações editadas/concluídas e o histórico;
- regenerar/projetar o diagnóstico afetado para que Home, Nino e WhatsApp recebam o mesmo contrato.

Para `cash_flow_imbalance`:

- título interno da ação: `Revisar os gastos que pressionaram o mês`;
- explicação: `Veja quais categorias e lançamentos mais contribuíram para a diferença entre receitas e despesas.`;
- CTA curto: `Revisar gastos` somente se o contrato passar a possuir rótulo curto explícito; caso contrário usar o mesmo título canônico sem transformação local;
- rota: `/app/relatorios?foco=categorias&periodo=atual`, já reconhecida pela tela de destino.

Outros tipos manterão um catálogo explícito: classificar lançamentos, revisar fatura, ajustar meta, planejar o mês, revisar recorrências. Ficam proibidos os rótulos genéricos listados no pedido.

### Severidade

- O frontend não reclassificará a situação: apenas mapeará `info/positive → informative`, `attention → attention`, `critical → critical`.
- Acento lateral de 3 px, respeitando o raio; roxo, âmbar ou vermelho; fundo branco.
- A auditoria confirmou que a severidade é definida por detectores no backend. Antes de mudar limiares, serão criados testes para magnitude, confiança, duração, caixa disponível e recorrência. Nesta rodada, não promover automaticamente novos casos a crítico; somente corrigir inconsistências comprovadas e manter a regra financeira existente.

## FAB do assessor

Adotar a solução B, de menor risco funcional:

- manter FAB global de 52–54 px;
- reservar uma zona real sem conteúdo acionável no fim da Home, além da bottom bar e safe area;
- incluir `safe-area-inset-right`;
- adicionar `scroll-padding-bottom`/padding contextual suficiente para que qualquer CTA possa ser rolado acima da zona ocupada pelo FAB;
- validar geometricamente via Playwright que o retângulo do FAB não intersecta links, botões, textos relevantes ou check-in em 360×800, 390×844 e 430×932.

Não ocultar durante a rolagem nesta rodada, pois isso introduziria estado/animacão e reduziria previsibilidade de acesso ao assessor.

## Arquivos previstos

### Frontend e contratos

- `src/lib/hooks/useFinancialSnapshot.ts`
- `src/lib/db/queryKeys.ts`
- `src/lib/db/invalidation.ts`
- `src/lib/recurring/schedule.ts` apenas se for necessário ampliar o adapter tipado já existente
- `src/lib/nino/homeGuidance.ts` (novo adaptador puro)
- `src/pages/Index.tsx`
- `src/components/home/HeroDisponivelCard.tsx`
- `src/components/home/AvailableBalanceDetails.tsx`
- `src/components/home/RitmoUnificadoCard.tsx`
- `src/components/home/NinoGuidanceCard.tsx`
- `src/components/home/PeriodPicker.tsx`
- `src/components/home/QuickActions.tsx`
- `src/components/home/EmotionalCheckinCard.tsx`
- `src/components/assessor/AssessorFab.tsx`
- `src/components/AppLayout.tsx` somente para a zona segura global/contextual do FAB

### Correções do mesmo campo inválido fora da Home

- `supabase/functions/insights-generate/index.ts`
- `supabase/functions/financial-reports-generate/catalogHighlights.ts`

### Fonte canônica da ação

- nova migration idempotente, com `create or replace` da função canônica e atualização restrita das ações ativas antigas;
- nenhum novo RPC ou tabela.

### Testes

- novo teste unitário do resultado parcial do snapshot;
- novo teste unitário do adaptador editorial;
- ampliar `src/test/home-composition-privacy.test.ts`;
- ampliar testes de ritmo e contratos financeiros existentes;
- novos cenários Playwright/screenshot em `/tmp/browser`, sem artefatos no repositório salvo se a suíte E2E existente exigir.

## Matriz de testes

### Funcionais

- falhas simuladas isoladamente em investimentos, metas, recorrências, faturas, parcelas e cartões não apagam saldo/ritmo;
- falha em contas, snapshots ou transações produz `unavailable` conforme a capacidade afetada;
- transações disponíveis + período anterior vazio mantêm série atual;
- zero real permanece `0`; fonte ausente nunca é mostrada como `0`;
- projeção fica `partial/unavailable` quando recorrências ou cartões necessários falham;
- `refetchMissing` repete somente fontes ausentes; `refetchCritical` somente as críticas; `refetchAll` todas;
- query keys são invalidadas após mutações de recorrência e investimento;
- contrato real de recorrência não consulta `next_due_date`.

### Editoriais e ações

- primeira camada tem um título, até 240 caracteres e no máximo um CTA;
- metodologia não aparece fechada;
- ausência de ação não fabrica botão;
- causa/contraponto/consequência/forecast não se repetem;
- projeção parcial não gera frase de forecast completa;
- catálogo canônico não contém “Revisar a formação do saldo”, “Resolver agora”, “Ver detalhes”, “Avaliar exposição” ou equivalentes internos;
- rota do CTA abre o contexto filtrado esperado;
- a mesma ação é observável na Home, aba Nino e projeção de comunicação.

### Visuais/E2E

- 390×844 com dados: Hero completo e início significativo do ritmo na primeira dobra;
- Hero: dados ≤175 px; parcial/erro ≤130 px;
- Ritmo: dados ~≤280 px; vazio/erro ≤170 px;
- orientação padrão entre 280–360 px, sem ultrapassar 240 caracteres expostos;
- dois estados vazios consecutivos permitem ver o início da orientação com pouca rolagem;
- nenhuma rolagem horizontal;
- privacidade ligada oculta todos os valores;
- FAB sem interseção em 360×800, 390×844 e 430×932, incluindo safe area;
- estados: completo, complementar em erro, crítico em erro, sem período anterior, com período anterior e baixa confiança.

## Validação com dados reais

Após implementação e antes de qualquer publicação:

1. autenticar na prévia com o usuário dos prints;
2. validar 1–5 de agosto de 2026, que possui transações reais no banco;
3. confirmar no diagnóstico estruturado que `recurringRules` deixou de retornar `42703`;
4. comparar saldo e ritmo antes/depois sem alterar as fórmulas;
5. simular uma fonte complementar em erro e confirmar `completeness="partial"`;
6. validar todos os cenários pedidos e capturas responsivas;
7. confirmar que Home e Orientação usam o mesmo snapshot/diagnóstico válido, sem cálculo paralelo.

O navegador de auditoria não recebeu uma sessão autenticada nesta etapa, portanto a falha de rede do usuário foi comprovada por execução direta da consulta e schema, não por captura autenticada. A validação visual autenticada é critério obrigatório da implementação futura.

## Ordem de implementação

1. adicionar testes que reproduzem `42703` e o colapso por fonte complementar;
2. corrigir o contrato de recorrências e as referências irmãs;
3. implementar classificação, disponibilidade, erros estruturados e retries seletivos;
4. adaptar `Index.tsx` sem alterar o motor financeiro;
5. separar os estados compactos de Hero e Ritmo;
6. criar o adaptador editorial e reduzir a primeira camada do Nino;
7. corrigir a ação na fonte canônica e atualizar somente ações ativas legadas;
8. compactar período, ações rápidas e check-in;
9. reservar zona segura e validar o FAB;
10. executar testes unitários, de contrato, integração, Playwright e dados reais;
11. apresentar evidências para revisão; publicar somente mediante autorização explícita posterior.

## Riscos e guardrails

- **Parcial parecer completo:** toda seção dependente de fonte faltante consulta `availability`; teste impede zero substituto.
- **Drift entre canais:** copy/rota muda na fonte canônica e ações ativas são reprojetadas; nenhum patch local na Home.
- **Ação histórica alterada:** atualização restrita a status ativos e copies legadas conhecidas.
- **Regressão contábil:** `computeFinancialSnapshot`, `facts.ts`, `spendingRhythm.ts` e fórmulas v4/v5 não serão reescritos.
- **Retry excessivo:** ações de retry usam grupos explícitos e mantêm `refetchAll` apenas como opção global.
- **Layout testado só por presença:** aceite exige dimensões e interseções medidas no DOM, além de screenshots.

## Confirmações de escopo

- Nenhuma regra financeira será alterada, duplicada ou recalculada na UI.
- Nenhuma fonte ausente será convertida em zero para apresentação.
- Não haverá nova tabela nem nova RPC; a única mudança de banco prevista é a correção idempotente da ação canônica, após aprovação deste plano.
- Landing page, autenticação e demais áreas ficam fora do escopo.
- Não houve implementação, migration, deploy ou publicação nesta etapa.
- Não haverá publicação durante a execução futura sem autorização explícita posterior.