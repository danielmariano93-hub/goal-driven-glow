# Nino Editorial Decision Layer — uma decisão, uma história

Objetivo: acabar com a sensação de "dois motores falando ao mesmo tempo" na Home, na tela do Nino, na proatividade e no WhatsApp. Nenhum cálculo financeiro muda.

## Causa confirmada do problema

Hoje a Home renderiza dois cards independentes, cada um lendo uma fonte diferente:

- `NinoGuidanceCard` lê o diagnóstico (`my_nino_home_context`) e mostra a situação principal. No caso real, o texto vem de SQL do detector de metas: "A meta ... pede mais do que sua sobra média comporta" + "o ritmo necessário é R$ 1.554,14 por mês".
- `NinoNextStepCard` lê a recomendação canônica (`nino_change_recommendations`) e mostra o texto do `behaviorWealth.ts`, estágio `fund_goal`: "Transformar folga em avanço da meta ..." + "O valor é limitado pela sua capacidade sustentável, não pelo desejo da meta." + R$ 290,14 + CTA "Ver como fazer".

Nenhuma camada relaciona os dois números, porque hoje não existe camada editorial: cada card é um adaptador direto do seu motor. Além disso, o valor "necessário para o prazo" (`requiredMonthly`) é calculado dentro do `behaviorWealth.ts` mas **não é persistido** na recomendação — então a UI não tem como explicar a relação nem hoje nem depois. O CTA atual é só um link (`/app/metas`); o aceite do compromisso existe só como ferramenta do agente (`commitLatestRecommendation`), sem caminho para o app.

## O que vai ser feito

### 1. Camada editorial canônica (função pura, sem cálculo)

Nova função `composeNinoDecisionNarrative()` em `src/lib/nino/decisionNarrative.ts`, espelhada para as Edge Functions pelo mesmo mecanismo já usado pelo `finance-core` (script de sync + teste de paridade), para que Home, tela do Nino, proatividade e WhatsApp derivem da **mesma** narrativa.

Entrada: situação principal do diagnóstico, recomendação canônica (título, detalhe, valor, papel do valor, estágio, meta, valor necessário), severidade e confiança. Saída única:

```text
{ eyebrow, headline, context, diagnosis, recommendation,
  primary_amount, secondary_amount, primary_cta, secondary_cta,
  tone, source_refs, variants: { home, nino_detail, whatsapp, proactive } }
```

Regras da camada:
- não recalcula dinheiro; só escolhe, ordena e escreve;
- monta o texto a partir dos números que recebe, com fallback honesto quando um deles não existe;
- nunca expõe confidence, stage, truth gate, priority score, versão de fórmula, "capacidade sustentável", "desejo da meta".

### 2. Regra de consolidação (um card por decisão)

A narrativa marca situação + próximo passo como **a mesma decisão** quando ambos apontam para o mesmo objeto canônico (mesma meta, mesmo cartão/dívida, mesmo caixa) ou quando o estágio do próximo passo é a consequência direta do tipo de situação. Nesse caso a Home renderiza **um** card. Quando são decisões distintas (ex.: risco crítico de caixa + passo patrimonial), continuam dois cards, com risco crítico sempre primeiro.

Prioridade editorial da Home: crítico/risco → decisão (próximo passo) → sinais de apoio → progresso → aprendizados. No máximo uma orientação principal.

### 3. Regra "necessário vs sustentável"

Quando existirem os dois valores, a narrativa **sempre** explica a relação em uma frase, com termos fixos: "necessário para cumprir o prazo" e "o ritmo que cabe hoje". O valor destacado é o recomendado (o que cabe); o necessário aparece só no texto. O mesmo valor não se repete em body + destaque + CTA.

Para isso, `behaviorWealth.ts` passa a **carregar** o valor necessário já calculado (`requiredMonthly`) no payload da recomendação (`required_amount` / `required_amount_role`) e o texto do estágio `fund_goal` é reescrito em linguagem humana. Nenhuma fórmula muda — é transporte e redação.

### 4. CTA que executa a ação

CTA primário do card de decisão deixa de ser "Ver como fazer" e passa a ser a ação recomendada ("Quero seguir esse plano" / "Resolver isso" / "Ajustar meu prazo", conforme o estágio), acionando o aceite real:

- nova Edge Function fina `nino-next-step` com ações `accept` e `dismiss`, reaproveitando `commitLatestRecommendation` e `registerChangeDismissal` do `changeLoop.ts` (revalidação material, compromisso único e ledger de aprendizado continuam sendo do motor existente);
- CTA secundário é textual e de menor peso visual (ex.: "Ajustar meta").

Microcopy após o aceite: "Combinado. Vou acompanhar esse passo com você e te aviso se o cenário mudar." Progresso, estagnado e concluído ganham as frases humanas equivalentes no acompanhamento.

### 5. Visual e semântica de cor

Card único e enxuto: eyebrow pequeno, headline forte (até 2 linhas), contexto, recomendação identificável, valor, CTA primário, ação secundária discreta. Quatro tons distintos por tokens já existentes: `critical/risk`, `attention`, `opportunity`, `progress` — decisão de meta deixa de ser "alerta laranja".

### 6. Guardrail do dia 1 mantido

Sem amostra suficiente, a Home não inventa insight; se houver próximo passo relevante, ele aparece sozinho.

## Superfícies

- **Home**: card único consolidado (headline + contexto + recomendação + valor + CTA).
- **Tela do Nino**: mesma conclusão, com o detalhe e a evidência abaixo.
- **WhatsApp**: variante curta em 4 linhas, mesma conclusão e mesma pergunta de aceite.
- **Proatividade**: variante curta derivada da mesma narrativa.

## Detalhes técnicos

Arquivos previstos:
- `src/lib/nino/decisionNarrative.ts` (novo, puro) + espelho em `supabase/functions/_shared/nino-editorial/decisionNarrative.ts` via `scripts/sync-finance-core.mjs` e teste de paridade.
- `src/lib/nino/homeGuidance.ts` — passa a delegar à narrativa em vez de escolher texto de apoio.
- `src/components/home/NinoGuidanceCard.tsx`, `src/components/home/NinoNextStepCard.tsx` — consolidados em um `NinoDecisionCard` quando é a mesma decisão; rotação de leituras secundárias preservada.
- `src/lib/nino/nextStep.ts` — passa a ler `required_amount`/`goal_name` e expõe as mutações de aceite/dispensa.
- `src/pages/Index.tsx`, `src/pages/Nino.tsx` — hierarquia editorial única.
- `supabase/functions/_shared/agent/behaviorWealth.ts` — transporta `required_amount` e usa redação humana.
- `supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts` e caminho proativo — usam a variante WhatsApp/proativa da narrativa.
- `supabase/functions/nino-next-step/index.ts` (novo, fino).
- Migration: colunas `required_amount` e `required_amount_role` em `nino_change_recommendations`.
- Bump de `AGENT_RUNTIME_VERSION` e redeploy das funções de `DEPENDENTS.md` (mudança em `_shared/agent`).

Testes (`src/test/nino-editorial-decision.test.ts`): explicação da diferença 1.554 vs 290; um único card para a mesma decisão; CTA primário = ação recomendada; ausência de "desejo da meta"/"capacidade sustentável"/confidence/stage/truth gate no texto do usuário; Home e WhatsApp com a mesma conclusão; próximo passo acima de situação secundária; risco crítico mantém prioridade; estabilidade só sem decisão material. Mais o caso real ponta a ponta.

Verificação final: testes, typecheck, build e conferência visual mobile (440px) na Home e na tela do Nino, com checklist de clareza, coerência, ação, tom, redundância e hierarquia.
