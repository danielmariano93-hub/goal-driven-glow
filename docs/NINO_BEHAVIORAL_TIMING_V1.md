# Nino Behavioral Timing v1

Contrato: `nino_behavioral_timing.v1`

## Pergunta que este contrato responde

O Nino já sabia O QUE importa (`priority_score`). Passa a saber se é AGORA:
`timing_score` é um score separado, determinístico e auditável.

## Peças

- `_shared/proactive/behavioralTiming.ts` — motor puro: gatilho, janela,
  princípios candidatos, elegibilidade, adiamento e razão. Não calcula dinheiro
  e não chama IA.
- `_shared/proactive/behavioralTimingRuntime.ts` — leitura dos eventos gravados,
  contexto de timing a partir do canônico, geração das situações, marcação de
  eventos processados e ledger de aprendizado.
- `nino_behavioral_events` — evento econômico capturado por triggers de banco
  (lançamento, fatura, aporte, pagamento de dívida, investimento). Sem cópia de
  dado sensível: guarda tipo, momento, materialidade e referência.
- `nino_behavioral_timing_windows` — política de janela por gatilho
  (abertura, validade, amostra mínima, piso relativo, liga/desliga).
- `admin_v3_behavioral_timing` + `BehavioralTimingBoard` — auditoria de quando
  falou, quando adiou, por quê e o que a pessoa fez depois.

## Fórmula do `timing_score` (0..100)

```text
40 * posição na janela      (imediata > mesmo dia > atrasada > fechada)
25 * acionabilidade         (existe ação executável agora)
20 * suficiência de amostra (amostra mínima + piso relativo de materialidade)
15 * ajuste aprendido       (taxa histórica de ação em gatilho x janela)
 -  penalidades             (retrospectivo sem ação, repetição, dispensa recente)
```

Fila real: `effective_score = priority * (0.55 + 0.45 * timing/100)`.

## Guardrails

- Momento do EVENTO manda: compra de sábado postada segunda pertence a sábado.
- Transferência entre contas próprias, estorno e resgate não são renda nova e
  nunca disparam `pay_yourself_first`.
- Caixa projetado negativo, truth gate bloqueado, ausência de capacidade
  sustentável ou pressão de dívida dominante trocam crescimento por
  `margin_of_safety`.
- Momento fraco ADIA (decisão `defer`, com `defer_until`), não descarta.
- Risco crítico nunca é adiado por timing.
- Detector antigo não é bloqueado por timing: recebe o score apenas como ordem.
- Um evento econômico gera uma intervenção por princípio e janela (fingerprint).
- Reframe usa fração aritmética do compromisso canônico
  (`computeCommitmentAlternative`), nunca valor novo.
- Continua havendo um único governador de atenção e um único dispatcher.

## Aprendizado

`nino_learning_events` com `event_type = 'timing_outcome'` registra entrega,
ação e dispensa por gatilho x janela x princípio, com `hours_to_action`. Esse
histórico realimenta o fator aprendido do próprio score.

## Deploy

Alterou `_shared/agent` ou `_shared/proactive`? Redeploy do lote inteiro de
`supabase/functions/_shared/agent/DEPENDENTS.md` e bump de
`AGENT_RUNTIME_VERSION` (atual: `nino-agent-p0.2026-09-02.2`).
