# Templates de mensagem, fila honesta e Nino estrategista de metas

Três frentes, uma entrega.

## 1. Fluxos sem mensagem para editar

O que confirmei no banco: existem 38 tipos de comunicação ativos, mas só 8 deles (os de família "template") têm texto publicado nos dois canais. Os outros 30 são gerados em tempo de execução — por isso, ao clicar em editar, você vê os chips de variáveis e um campo vazio. Não é bug de tela: é ausência de texto base.

Sim, faz sentido separar os dois mundos, e é assim que vamos fazer:

- **Texto fixo com variáveis (template):** lembretes, recorrências previstas, check-in emocional, fatura, dívida a vencer/atrasada, progresso de meta, cobrança de divisão, categorizar lançamento, queda de engajamento. Toda a redação passa a vir do painel; a IA não escreve nada.
- **Texto com leitura da IA (híbrido):** casos que dependem de interpretação — pico de gasto, mudança de ritmo, risco de concentração, oportunidade de economia, padrão emocional, reincidência. Aqui o painel define a **moldura fixa** (abertura, ordem dos dados, fechamento e a ação sugerida) e a IA só preenche a frase de leitura, dentro do limite de caracteres.

Entregas:
- Publicar texto inicial (WhatsApp + app) para **todos** os tipos ativos, no tom do Nino, usando apenas variáveis já disponíveis em cada fluxo.
- Editor mostra claramente o modo do fluxo ("texto fixo" ou "moldura + leitura da IA"), com o campo da moldura quando for híbrido.
- Prévia com valores de exemplo reais em vez de `[variavel]`, para você ler a mensagem como o cliente lê.
- Aviso no editor quando o fluxo não tem texto no canal selecionado, com botão "usar texto sugerido" para partir de uma base em vez da folha em branco.
- O motor de envio passa a exigir template no modo fixo: sem texto publicado, o fluxo é retido com motivo explícito ("sem mensagem publicada") em vez de improvisar.

## 2. "Na fila" que já foi enviado

Confirmei a causa: quando o Nino enfileira a mensagem no WhatsApp, o registro de comunicação nasce como "na fila" e **nunca é atualizado** depois que o WhatsApp confirma a entrega. Hoje há 9 registros nesse estado — 7 deles têm entrega confirmada (14/08 e 16/08) e apenas 2 são realmente pendentes (de hoje, 11:17).

Entregas:
- Reconciliação automática: quando a mensagem é entregue, lida ou falha, o registro do fluxo passa a "entregue" ou "falhou", com data/hora.
- Correção do histórico: os registros antigos com entrega confirmada passam a aparecer como entregues.
- Painel deixa de dizer só "na fila": mostra "aguardando envio (há X min)" e destaca em separado o que está preso além do tempo esperado, com o motivo.
- Envio pendente antigo passa a ser tratado como incidente na aba de Saúde, em vez de ficar silenciosamente parado.

## 3. Nino estrategista de metas

Hoje o Nino calcula projeção e ritmo da meta, mas não diz **o que fazer**. Vamos adicionar a camada de estratégia.

Para cada meta, o Nino monta um **plano de ataque** com:
- **Quanto:** aporte mensal e semanal necessário para bater o prazo, e o que muda se o prazo for esticado.
- **Onde:** as categorias flexíveis do próprio histórico com maior folga, com o valor realista que pode sair de cada uma (baseado na mediana pessoal, não em corte genérico).
- **Como:** táticas com respaldo em literatura de finanças comportamentais e pessoais — pagar-se primeiro no dia do salário, automatizar o aporte, meta em passos curtos, regra de espera antes de compra por impulso, ancoragem do valor em unidades do dia a dia, revisão semanal curta.
- **Ordem:** o que fazer primeiro quando há dívida caro conviva com meta (juros da dívida acima do rendimento da meta muda a prioridade, e o Nino explica por quê).
- **Próximo passo único:** uma ação verificável para esta semana.

Regras de honestidade: todo número sai dos motores determinísticos do Nino; nada de estimativa de cabeça. Quando o histórico não sustenta o corte, o Nino diz o que falta em vez de inventar. As referências aparecem como princípio ("pagar-se primeiro", "metas em passos curtos"), sem virar citação acadêmica na conversa.

Onde isso aparece:
- **Tela de Metas:** bloco "Plano do Nino" em cada meta, com quanto/onde/como e o próximo passo, e botão para conversar sobre o plano.
- **Conversa (app e WhatsApp):** "como eu chego nessa meta?", "de onde tiro esse dinheiro?", "consigo antecipar?" passam a cair no estrategista.
- **Acompanhamento proativo:** avisos de meta fora do ritmo, aporte do mês ainda não feito, marco alcançado e "sobrou folga, dá para adiantar" — todos com o texto editável no painel (frente 1) e sujeitos aos limites de convivência já existentes.
- **Highlights e notificações** do andamento da meta, com feedback de utilidade para o Nino aprender o que funciona com aquela pessoa.

## Detalhes técnicos

- `communication_templates`: migration de seed idempotente por `kind`+`channel` para todos os tipos ativos; nova coluna de modo (`fixed` | `ai_framed`) derivada de `communication_catalog.content_mode`, com moldura em campo próprio.
- `CommunicationDispatcherV3.ts`: exigir template no modo fixo (retenção com `reason: no_published_template`); registrar `template_id`/`version` já existente permanece.
- Reconciliação: gatilho/rotina que atualiza `communication_deliveries` a partir de `outbound_messages` (delivered/read/failed) via `context_id`; migration de correção do passivo; `admin_v2_proactive_summary` e `admin_ops_health` passam a distinguir "aguardando envio" de "preso".
- `TemplateEditor.tsx`: modo do fluxo, moldura, prévia com amostra e ação "usar texto sugerido"; `FlowsBoard.tsx` sinaliza fluxos sem texto publicado.
- Novo motor `src/lib/engine/goalStrategy.ts` (espelhado em `supabase/functions/_shared` via `scripts/sync-finance-core.mjs`): consome `canonicalFacts`, `costStructure`, `incomeProjection`, `savingsOpportunities` e `debtStatus`; retorna envelope `nino_engines.v1` com plano, fontes de folga, táticas e confiança.
- Nova tool determinística `build_goal_strategy` + rota `goal_strategy` no `CapabilityRouter.ts` e formatador em `DeterministicAnswers.ts`; persona ganha regra de "estratégia sempre via motor".
- Detectores de meta (`goal_progress`, `goal_at_risk`, `goal_feasibility`) passam a carregar o próximo passo do plano na evidência.
- UI: `GoalStrategyCard.tsx` em `src/components/metas/`, integrado em `src/pages/Metas.tsx`.
- Testes: seed/validação de templates, reconciliação de status, e suíte do motor de estratégia (aporte necessário, folga por categoria, prioridade dívida × meta, dados insuficientes).
- Sem alteração de identidade, paleta ou landing page. Sem publicação em produção.
