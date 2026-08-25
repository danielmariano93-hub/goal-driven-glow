# Sistema de Comunicação do Nino (nino_comm.v1)

Objetivo: o usuário entende em 3 segundos "estou bem ou mal, por quê, o que faço agora" — sem mudar uma única fórmula financeira e sem aumentar consumo de IA.

## 1. Diagnóstico AS-IS (verificado no projeto)

**Copy problem**
- `supabase/functions/_shared/reports-core/narrative.ts:11-41`: `deterministicSummary` empilha 6–8 frases com todos os números (receita, despesa, resultado, delta %, categoria líder, dias com gasto, média/dia, projeção, nota). É exatamente o parágrafo denso citado. `deterministicClosing:44-50` usa `highlight.title.toLowerCase()` + body inteiro como "próximo passo".
- `PCT` usa 1 decimal e o delta vem como `60,47%` da fonte — falsa precisão em headline.
- `ReceiptBuilder.buildActionReceipt:76-111` monta recibo com até 7 linhas (descrição, categoria, cartão, competência, vencimento, parcelas, como corrigir) para qualquer lançamento, inclusive R$ 5,40.

**Information hierarchy problem**
- `NinoSituationCard.tsx:24`: `details` concatena `cause_summary + consequence_summary + forecast_summary` e ainda exibe "Confiança: X%" na UI do usuário.
- Todas as situações de severidade alta renderizam o mesmo card, mesmo tom, mesmo peso: 4 "riscos" simultâneos competem igualmente. Já existem `severity`, `priority`, `narrative_role` e `consolidated_count` — a UI não usa isso para degradar sinais secundários.
- `NinoPrimaryInsightCard.tsx` já é o "primary" correto (badge "o que mais importa agora", `impact_amount`, "Como calculamos" colapsado). O problema é que os secundários não são visualmente subordinados a ele.

**Conversational design problem**
- WhatsApp proativo: o corpo vem de `diagnosisToCommunication.ts:103` (`summary + explanation` concatenados) dentro de um `frame_template` do banco (`communication_templates`), ex.: "Um ponto do seu caixa que vale sua atenção agora. … Se quiser, eu simulo o efeito de um ajuste antes de você decidir." Resultado: título de dashboard + parágrafo analítico + convite genérico.
- `prompt.ts` bloco `analytics:105-111` obriga TODA resposta analítica a 3 partes com "EVIDÊNCIA E CONFIANÇA" ("Base: 01/07 a 30/07, 128 lançamentos, confiança alta") — isso empurra o agente para o formato relatório em perguntas simples. O bloco `style:112-118` permite até ~7 linhas + 4 bullets sempre.

**Architecture problem**
- Copy de situação nasce dentro de funções SQL (`nino_diag_put_situation`, ex. migration `20260816175133…:180-187` escreve headline/cause/consequence/forecast em texto). Texto em SQL é o ponto mais caro de iterar.
- Existem 4 camadas de copy paralelas sem contrato comum: SQL de diagnóstico, `insights/detectors.ts` (title/body prontos), `reports-core/narrative.ts`, `communication_templates` (frame por canal). Nenhuma delas separa "fato" de "frase".

## 2. Root causes

1. **Fato e frase colados na origem.** Motores/SQL já entregam texto final, então o canal só pode envelopar — nunca resumir.
2. **Ausência de contrato de comunicação.** Não há campo canônico para "conclusão principal", "por que importa", "ação". A UI recebe 3 resumos equivalentes e mostra os 3.
3. **Falta de hierarquia de atenção na apresentação.** A priorização existe nos dados, mas cada card se renderiza como protagonista.
4. **Prompt otimiza prova, não compreensão.** Regras de evidência e formato pesado valem para todo turno analítico.
5. **Formatação numérica sem política por contexto.** Só existe `brl()` (`src/lib/nino/format.ts`) — nada de valor compacto nem arredondamento de percentual por superfície.

## 3. Camada alvo (sem segunda verdade)

```text
FINANCIAL TRUTH (intocado: SQL, engines, snapshots)
        ↓  facts estruturados já existentes
COMMUNICATION INTENT  (novo, derivado — nunca calcula)
        ↓
CHANNEL RENDERER  (app card | relatório | whatsapp | push | recibo)
        ↓
FINAL COPY (determinístico por padrão; LLM só quando agrega)
```

`CommunicationIntent` é **derivação**, não nova fonte: monta-se a partir de campos que já existem (`title/headline`, `summary`, `impact_amount`, `severity`, `priority`, `confidence`, `evidence`, `primary_action`). Campos: `conclusion`, `why_it_matters`, `action`, `supporting[]` (máx. 2), `severity`, `priority`, `confidence`, `detail`, `provenance`. Nenhum número novo pode entrar — guard de teste garante que todo valor citado exista na evidência de origem.

## 4. Communication Design System

1. Uma conclusão por bloco; headline é conclusão, não indicador.
2. Progressive disclosure: conclusão → 1 frase de contexto → detalhes sob demanda.
3. Máx. 2 números no nível 1; máx. 4 no nível 2.
4. Precisão por contexto: headline/resumo compacta (`R$ 4,2 mil`, `60%`); extrato/detalhe/contabilidade sempre exato (`R$ 4.229,83`, `60,47%`). Nunca compactar valor de confirmação, recibo, fatura, parcela ou saldo.
5. Confiança nunca aparece como número na UI do usuário — vira frase ("leitura firme" / "primeiro palpite").
6. Hierarquia: 1 primary + até 2 supporting rebaixados (linha compacta, sem parágrafo, sem CTA próprio) + "ver todos".
7. WhatsApp = conversa: até 4 linhas, 1 pergunta final derivada do fato (nunca "se quiser eu simulo" genérico).
8. Sem alarmismo: vermelho reservado ao primary crítico; supporting em tom neutro.

## 5. Voice & Tone do Nino (arquivo único)

Novo `src/lib/copy/ninoVoice.ts` + espelho em `supabase/functions/_shared/copy/ninoVoice.ts` (via `scripts/sync-finance-core.mjs`): léxico permitido/proibido, tamanho por superfície, política de emoji (0 no app, máx. 1 no WhatsApp), traduções de jargão ("gastos flexíveis" → "gastos que dão pra ajustar"; "projeção de caixa" → "como seu mês deve fechar"; "comprometimento" → "quanto da sua renda já está comprometido"), e padrões de alerta/elogio/erro/confirmação/follow-up.

## 6. Before → After (8 casos reais)

| Superfície | Hoje | Depois |
|---|---|---|
| Leitura/relatório (`narrative.ts`) | parágrafo com 8 números | "Você gastou R$ 4,2 mil a mais do que recebeu neste mês." + "Seus gastos caíram 60% em relação a julho." + "O maior espaço de ajuste está nos R$ 1,5 mil de gastos que dão pra ajustar." (detalhes em bloco estruturado abaixo) |
| Card primary | "Você gastou R$ 4.229,83 acima do que recebeu" + 3 parágrafos | mesma headline, 1 frase de contexto, CTA "Ver onde ajustar", detalhes em "Como calculamos" |
| Cards secundários | 3 cards de risco iguais | linhas compactas: "Cartão: R$ X pesando no mês" · "Dívidas acima de um mês de renda" · "Ver todos os sinais" |
| WhatsApp proativo | frame + parágrafo analítico | "Seus gastos subiram, mas quase tudo veio de lançamentos sem categoria. Foram R$ 2.566 contra R$ 167 no período anterior. Quer revisar comigo antes de eu concluir que você gastou mais?" |
| Resposta do agente ("como estou?") | fato + delta + linha de evidência | conclusão + 1 contexto + "Quer que eu mostre onde dá pra ajustar?" (evidência só se pedirem ou se a confiança for baixa) |
| Recibo | 7 linhas + "a categoria eu ajusto sozinho" | "Anotado: R$ 5,40 na Autopass, hoje. ✅" (detalhes só quando houver ambiguidade real: cartão, parcelas, competência ≠ hoje) |
| Meta/planejamento | "Você passou o teto de Alimentação em R$ 137,42" + mensagem longa | "Alimentação passou do teto em R$ 137." + "Faltam 6 dias no mês." + CTA "Ver plano" |
| Erro/fallback | "Não foi possível registrar" | "Faltou só uma coisa: em quê foi esse gasto de R$ 50?" |

## 7. Escopo de arquivos (impacto)

**Novo:** `src/lib/copy/ninoVoice.ts`, `src/lib/copy/numbers.ts` (compact/exact), `src/lib/comm/intent.ts` (+ espelhos em `supabase/functions/_shared/copy|comm/`), `src/components/nino/NinoSupportingSignalRow.tsx`.

**Alterados (apresentação apenas):** `reports-core/narrative.ts` (+ `src/lib/reports/intelligent/*`), `NinoSituationCard.tsx`, `NinoPrimaryInsightCard.tsx`, `NinoCardShell.tsx`, `NinoItemCard.tsx`, `src/pages/Nino.tsx`, `src/pages/RelatorioInteligenteDetalhe.tsx`, `src/pages/ProactiveAlertDetail.tsx`, `src/components/home/*` (Resumo/Pulse/Guidance), `insights/detectors.ts` (titles/bodies), `diagnosisToCommunication.ts:103` (usar `conclusion` em vez de `summary+explanation`), `ReceiptBuilder.ts`, `messageTemplates.ts`, `ReplyHumanizer.ts` (comprimento/jargão), `prompt.ts` (blocos `style`/`analytics`/`advisory`).

**Dados (só texto de moldura):** `communication_templates` — reescrever `frame_template` de WhatsApp por tipo (conversa curta + pergunta específica). Sem mudança de schema.

**Intocado:** engines financeiros, `canonicalFacts`, `metrics`, snapshots, cache de Home, RLS, cálculo de SQL de diagnóstico (só os campos de texto serão deixados de lado na renderização, sem alterar fatos).

## 8. Centralização (evitar 50 strings soltas)

Quatro pontos cobrem quase todo o produto: `intent.ts` (o que dizer), `ninoVoice.ts` + `numbers.ts` (como dizer), `NinoCardShell`/`NinoSupportingSignalRow` (como mostrar no app), `communication_templates` (como soar no WhatsApp). Textos SQL passam a ser fallback, não a fonte exibida.

## 9. Impacto em tokens

Tende a **reduzir**: prompt encurta (bloco de evidência passa a condicional), respostas ficam menores (limite de linhas por intenção), narrativa de relatório passa a ter nível 1 determinístico — a LLM só reescreve quando há interpretação real. Nenhuma superfície hoje determinística passa a chamar LLM.

## 10. Test plan

- Verdade financeira: suíte atual completa (1400+ testes) sem alteração de valores; `numeric-guard`/`claimValidator` seguem verdes.
- Novo `nino-comm-contract.test.ts`: todo número em `conclusion` existe na evidência; nenhum valor compactado em recibo/extrato/confirmação.
- `nino-comm-length.test.ts`: limites por superfície (card ≤ 2 frases nível 1; WhatsApp ≤ 4 linhas; recibo simples ≤ 2 linhas).
- `nino-comm-hierarchy.test.ts`: no máximo 1 primary crítico + 2 supporting por superfície.
- `result-wording.test.ts` estendido: vocabulário proibido + jargão banido.
- Degraded mode: sem IA, nível 1 e 2 continuam corretos (renderer determinístico).

## 11. Rollout

Uma entrega, em ondas dentro da mesma rodada, cada onda validada por testes: (A) `numbers.ts` + `ninoVoice.ts` + `intent.ts` com testes; (B) app cards e hierarquia; (C) relatório e leitura do Nino; (D) WhatsApp proativo (`frame_template` + `diagnosisToCommunication`); (E) agente (prompt/ReplyHumanizer) e recibos. Flag `nino_comm_v1` em `FeatureFlags.ts` para reverter apresentação sem tocar em dados.

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Simplificar demais / esconder risco real | supporting sempre visível + "ver todos"; nada é removido, só rebaixado |
| Arredondar valor que muda decisão | `numbers.ts` proíbe compactação em recibo, confirmação, fatura, parcela, saldo e extrato (teste) |
| Divergência App × WhatsApp | ambos consomem o mesmo `CommunicationIntent`; teste compara conclusão entre canais |
| Aumento de LLM | teste estático: superfícies determinísticas não podem importar `llm.ts` |
| Segunda verdade | `intent.ts` não faz aritmética; guard de números na evidência |

## 13. Achados financeiros (documentar, não corrigir agora)

- `NinoSituationCard` expõe confiança percentual como se fosse precisão financeira.
- Delta de despesa com 2 decimais (`60,47%`) sugere precisão inexistente em base parcial do mês.
- Nada mais foi encontrado: nenhuma correção de fórmula entra nesta rodada.

## 14. Critérios de aceite

1. Relatório abre com conclusão executiva de no máximo 3 frases e 3 números.
2. Nenhuma superfície mostra mais de 1 card crítico protagonista.
3. Leitura do Nino não repete números já exibidos nos cards vizinhos.
4. Mensagem de WhatsApp proativo ≤ 4 linhas, com pergunta específica ao fato.
5. Recibo de lançamento simples ≤ 2 linhas.
6. Zero percentual com 2 decimais em headline; zero valor compactado em recibo/extrato.
7. Confiança nunca aparece como número ao usuário.
8. Tokens médios por turno iguais ou menores que a média atual medida no painel admin.
9. Todas as fórmulas e testes financeiros inalterados.
10. Modo degradado (sem IA) mantém conclusão + contexto corretos.
