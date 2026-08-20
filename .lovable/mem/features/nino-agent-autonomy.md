---
name: Nino agente autônomo — prova de escrita e autonomia
description: Recibo só existe com read-after-write provado; registry de capacidades e política de autonomia por risco
type: feature
---

`nino_agent.v1`:

- `PersistenceProof.ts`: o Nino só diz "registrado" depois de LER de volta a linha escrita (mapa kind → tabela, filtro por `user_id`). Sem prova, resposta honesta (`unprovenMessage`), nunca recibo.
- `PendingConfirmations.executeConfirmation` é o ÚNICO caminho para chamar os RPCs de confirmação (`p_confirmation_id`, `p_source_message_id`). Nunca chamar `sb.rpc(confirmationExecutor(...))` direto.
- `CapabilityRegistry.ts`: matriz única de capacidades (domínio, tool canônica, escreve?, risco, superfície, frase pt-BR).
- `AutonomyPolicy.ts`: leitura executa sozinha; escrita de risco médio/alto, valor ≥ R$ 1.000 ou gatilho proativo SEMPRE passa por rascunho + confirmação.
