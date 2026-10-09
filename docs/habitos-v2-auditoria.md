# Hábitos v2 — auditoria, arquitetura e decisões

Especificação de referência: *Nino — Redesenho da Experiência Comportamental* (PDF, 09/10/2026).
Escopo: `/app/emocoes` ("Seus hábitos com dinheiro"). Fora do escopo e preservado: lógica contábil,
metas, dados históricos, experimentos já iniciados, demais telas.

## 1. Auditoria do que existia

### 1.1 Origem de cada nota (`behavior_observed.v2`) e o problema

| Dimensão | O que alimentava a nota (v2) | Problema (frente à especificação) |
|---|---|---|
| Consciência | 45% dias de acesso ao app, 20% consultas a Movimentos, 25% check-ins, 10% cobertura de categorização | 65% era volume de uso; categorização é em boa parte automática. Dava 10,0 por "abrir o app". |
| Planejamento | 45% nº de metas, 30% nº de recorrências, 25% acessos a telas de planejamento | Intenção e uso, sem execução. Real: 6 metas + 0 recorrências + 87 acessos = **8,0**. |
| Controle | ciclos fechados, metas atuais, "variação diária média" | Variação diária não mede controle; sem ciclo fechado ainda gerava nota (teto 7). |
| Consistência | estabilidade do gasto, semanas com check-in, **dias de acesso** | Acesso ao app como "hábito". |
| Segurança | reserva/despesa, folga futura, **dívida/ativos** (10 sem dívida), **saldo projetado** (8/5/2 mesmo sem projeção) | Ausência de dívida virava segurança; ausência de dado virava valor. |
| Patrimônio | aportes, taxa, poupança, **constante 7** se há patrimônio | Constante arbitrária; um aporte único já pontuava. |
| Tranquilidade | check-ins diretos + estimativas antigas | Estimativa legada misturada à nota. |
| Dívidas | tendência + carga; **9,5 quando não há dívida**; (histórico real chegou a **0,0**) | Ausência de dado → nota extrema. |

### 1.2 Componentes da página anterior

HabitDiscoveryCard, BehaviorWheel (Recharts, notas 0 para "sem dado"), NextStepCard (compromisso pressuposto),
VerdictStrip, WhatChanged (tabela de deltas), BehavioralInsightsCard (hipótese "gastos impulsivos"), MoneyImpactCard
(R$ 244 × R$ 85), experimentos ativos + experimentos opcionais de 30 dias, EmotionalCheckinCard, MoneyMoodTimeline
(linha contínua misturando estimativa e medição), evolução semana a semana, "Como o Nino calcula".

## 2. Decisão por componente

| Componente anterior | Decisão | Destino na v2 |
|---|---|---|
| HabitDiscoveryCard | **Substituir** | "O que o Nino descobriu": um padrão recorrente (evidência + significado + alternativas + ação); sem padrão, a leitura da roda ocupa o lugar |
| BehaviorWheel | **Evoluir** | `HabitsWheel`: 2 séries (Você / Nino), "sem leitura confiável" no lugar de 0, terceira série só em "Ver evolução"; painel por dimensão |
| NextStepCard | **Substituir** | Ação dentro do padrão (limite sugerido com conta, edição e aceite explícito) ou um passo pequeno por dimensão |
| VerdictStrip / WhatChanged | **Consolidar** | Mudança de método → "primeira referência"; deltas só em detalhes, e só quando comparável |
| ContestScore | **Evoluir** | "Isso representa minha realidade? Sim / Em parte / Não" + contexto |
| BehavioralInsightsCard (hipóteses) | **Remover da principal** | Substituída pelo motor de padrões; dados preservados |
| MoneyImpactCard | **Reescrever e mover** | `EmotionAssociationCard` (detalhes): associação ≠ causa, sem "extra por dia", sem percentual, pergunta de contexto |
| Experimentos (ativos e opcionais) | **Pausar na principal, preservar** | Só em detalhes, apenas os iniciados (progresso, vínculos, histórico), sem iniciar novos |
| EmotionalCheckinCard | **Mover** | Detalhes (coleta opcional), âncora `#checkin` |
| MoneyMoodTimeline | **Mover** | Detalhes (já diferencia medição direta de estimativa) |
| Evolução semana a semana | **Mover** | Detalhes |
| momentSignal ("antes de comprar") | **Remover da página** | Já coberto pela inteligência proativa |

## 3. Arquitetura

```
transações / metas / check-ins ──► motor v3 (behaviorObservedV3)  ──► roda + painel (evidência, limite, fontes)
                                   estados: sufficient | partial | none
transações / metas ──► motor de padrões (habitPatterns) ──► tela (≤2) ─┐
                         reaproveita weekendForecast/weekdayNudge      ├─► WhatsApp (mesmos números)
aceite explícito (RPC habit_limit_accept) ──► weekend_commitments ─────┘   fechamento de segunda mede o combinado
```

* **Flag por usuário**: `habits_v2_access` + `habits_v2_enabled()` (mesmo padrão do Open Finance). Falha fechada.
* **Motor v3** (`src/lib/engine/behaviorObservedV3.ts`, espelhado em `_shared/finance-core`): nota só com evidência
  suficiente; base parcial = sinal qualitativo sem nota; sem base = "ainda não sei". Cada dimensão carrega
  `record` (fontes classificadas em direto/calculado/declarado, janela, cobertura, versão, até 3 fatos observados,
  o que falta, o que não prova, motivo da indisponibilidade).
* **Comparabilidade**: `isMethodologyBreak` — v2↔v3 nunca vira melhora/piora; o painel diz "primeira referência".
  O job semanal grava v3 só para quem tem a flag.
* **Padrões** (`_shared/proactive/habitPatterns.ts`, ação `habit_patterns` da `nino-insights`): candidato → testes
  (confiança mínima, categoria de data fixa, repetição, recusa) → ranking (relevância × confiança × oportunidade)
  → no máximo 2. Reaproveita `buildWeekendForecasts` (agora com `anyDay` para leitura sob demanda; o disparo
  proativo continua só na sexta) e `detectWeekdayPatterns`.
* **Compromisso**: nasce só em `habit_limit_accept`; recusa é registrada (`declined`) e respeitada; a oferta do
  WhatsApp não repete categoria já decidida no app.
* **Feedback**: `behavior_observed_feedback.verdict` (yes / partially / no); "Sim" não vira incerteza.

## 4. Existe / parcial / corrigido / construído

| Item | Situação |
|---|---|
| Roda com 8 dimensões, snapshots semanais, contestação 30 dias | existia — preservado e evoluído |
| Previsão de fim de semana, recap de segunda, "topo" no WhatsApp | existia — reaproveitado pela tela |
| Notas explicáveis | parcial (fatores/pesos) → **construído** (observei / não sei / como você se percebe / não prova / fontes) |
| Estados de evidência e "sem leitura confiável" | **construído** (v3) |
| Remoção de proxies de acesso, constantes e ausência→valor | **corrigido** (v3) |
| Versão do método e ruptura de comparabilidade | parcial (chaves de fatores) → **corrigido** (versão explícita) |
| Padrões comportamentais com evidência e alternativas | **construído** |
| Limite sugerido com conta, edição e aceite | **construído** (antes: combinado pressuposto) |
| Emoção como associação | **reescrito** |
| Pausa de experimentos | **feito** (principal sem novos; dados preservados) |
| Assessor conversacional alimentado pelos padrões | **parcial**: mesmo motor/números e mesmo compromisso; ferramenta dedicada no assessor fica como próximo passo |
| Contador de experimentos (frequência × alocação líquida; mesmo dia duplicado) | **adiado** (decisão anterior do produto); experimentos pausados na principal |

## 5. Rollout

1. Flag ligada só para a conta do dono do produto (feito). 2. Validação com dados reais e evidências (este PR e relatório).
3. Ampliação gradual inserindo usuários em `habits_v2_access`; 4. depois da confirmação do produto, trocar o
`habits_v2_enabled()` por "todos" e remover a página anterior.

## 6. Revisão pós-feedback (camada de decisão)

Feedback externo sobre a primeira entrega: a página repetia relatório financeiro (metas, médias, projeções) em vez de
ajudar a entender decisões. Mudanças:

| Ponto do feedback | O que foi feito |
|---|---|
| Dois cards iguais (Lazer e Transporte) | Um insight consolidado por conjunto de categorias (`weekend:Lazer+Transporte`) |
| Padrão ≠ descoberta | O insight diz "o que ainda não sei" e faz UMA pergunta de contexto (Já planejo / Decido na hora / Envolve outras pessoas / Depende), só quando a resposta muda a recomendação; padrão sem ação possível não pergunta |
| Recomendação só pela média | Ação depende da resposta: planejado → rever a meta; na hora → limite opcional (com conta e aceite); outras pessoas → dividir a conta; depende → só observa. Silêncio nunca vira resposta ("Prefiro não responder") |
| Combinado sem aceite visível | Mostra origem (WhatsApp/app), data e hora, com Alterar valor e Desfazer |
| Projeção protagonista | Uma única linha de consequência (hipótese); a conta completa só aparece depois da resposta |
| Experimentos | Removidos da interface (inclusive do histórico); tabelas e progresso preservados; o recálculo em segundo plano continua |
| Money Mood | Fora do estado aberto: resumo "medições diretas × estimativas" e gráfico sob demanda |
| Roda subaproveitada | Leitura da diferença "você × Nino" sem juízo + pergunta opcional "o que mais pesa para você" (opções fechadas), que vira evidência declarada |
| Consciência 10,0 | Só check-ins não passam de 7,0; reconhecer padrões (respostas) libera o teto; o painel explica |
| Página sempre cheia | `minUtility`: sem insight relevante, nada é mostrado |
| Validação | `habit_insight_events` + roteiro e métricas em `docs/habitos-v2-validacao.md` |

Integração: as respostas viram memória do assessor (texto de modelo, 45 dias) e o WhatsApp deixa de pressionar por
limite em categorias respondidas como "planejado" ou "outras pessoas".
