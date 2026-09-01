# Latência, tokens e aprendizado do Nino no admin — correção real

## O que eu verifiquei agora (não é suposição)

**Os gráficos existem no código e estão em produção.** O bundle publicado em meunino.com.br já contém `admin_v3_ai_history`. Eles ficam em **Nino & IA → aba "Custo e uso"**, no topo. O problema é que estão praticamente vazios e mal sinalizados:

- `ai_usage_ledger` tem **60 linhas no total**. Só **10** são conversa do Nino (`AGENT_CONVERSATION`), todas de **31/08**, com 94.965 tokens. As outras 50 são categorização de fundo com **tokens = 0**. Nenhum registro em 01/09.
- `agent_runs` tem **316 execuções nos últimos 30 dias**, com latência ponta a ponta em todas, mas tokens em pouquíssimas.
- A tela filtra a série de tokens por `tokens_total > 0`. Com um único dia útil, a área fica invisível — parece "sem gráfico".
- O gráfico rotulado "Latência de IA (tempo do modelo)" cai silenciosamente para a latência ponta a ponta de `agent_runs` quando não há registro de IA no dia. O rótulo diz uma coisa, a linha mostra outra.

**Causa raiz do vazio:** só o passo de conversa (`_shared/agent/llm.ts`) e a categorização registram consumo. Ficaram sem registro: `insights-generate`, `financial-reports-generate`, `native-audio-transcribe`, transcrição de áudio do WhatsApp (`messaging/wahaMedia.ts`) e a rota conversacional (`agent/core/Conversational.ts`). A categorização registra a chamada, mas grava tokens zerados.

**Aprendizado em branco:** `admin_nino_learning_overview` **exige um `user_id`**. O painel só aparece depois de você buscar um usuário no inspetor — não existe visão global. E o ledger tem apenas **19 eventos**, de 3 usuários, todos de observação (estabelecimento, categoria, memória anterior): nenhuma correção, compromisso ou dispensa registrada.

## O que vou fazer

### 1. Registrar todo consumo de IA (fim do gráfico vazio)
- Um único ponto de registro obrigatório para chamadas ao gateway, com tokens, latência, modelo e workload reais tirados da resposta.
- Instrumentar as chamadas hoje sem registro: insights, relatórios do consultor, áudio (app e WhatsApp) e rota conversacional.
- Corrigir a categorização para gravar os tokens reais em vez de zero.
- Nada é estimado: quando o provedor não devolve uso, a linha é gravada como "uso não informado" e a tela diz isso.

### 2. Gráficos honestos e legíveis
- Série de tokens contínua por dia (dia sem chamada = zero explícito), com ponto visível quando houver um só dia.
- Separar duas linhas nomeadas no gráfico de latência: **latência de IA** (ledger) e **ponta a ponta** (execuções). Sem substituição silenciosa.
- Cada gráfico ganha rodapé com a fonte e a data em que aquela telemetria começou a existir.
- Estado vazio explícito: "sem chamada de IA registrada neste recorte e neste tipo de uso" com atalho para trocar o filtro, em vez de área invisível.
- Aba renomeada para **"Custo e latência"** e os dois gráficos como primeiro bloco da página.

### 3. Aprendizado do Nino visível sem precisar buscar usuário
- Nova visão global (sem PII, só agregados e pseudônimo): total de eventos, aplicados, correções, dispensas, compromissos ativos/concluídos, distribuição por tipo e por origem, os aprendizados recentes em linguagem clara ("aprendeu que X é transporte") e desde quando o ledger existe.
- Ela entra no topo do bloco de aprendizado; o painel por usuário continua no inspetor.
- Fechar os furos de registro de aprendizado: correção de categoria pelo usuário, preferência de estabelecimento confirmada e decisão de duplicidade passam a gerar evento auditável, como já acontece na conversa.
- Quando não houver nada aprendido no recorte, a tela diz o motivo (aquecendo x pipeline a verificar), nunca fica em branco sem explicação.

## Detalhe técnico

- Edge: novo wrapper de registro em `_shared/aiUsageLedger.ts` usado por `insights-generate`, `financial-reports-generate`, `native-audio-transcribe`, `messaging/wahaMedia.ts`, `agent/core/Conversational.ts` e correção de tokens em `category-engine`.
- Banco: `admin_v3_ai_history` passa a expor `ai_*` e `e2e_*` sem coalesce na série principal, mais `coverage` por métrica; nova RPC `admin_v3_nino_learning_global(_days)` protegida por `cockpit.read`, sem e-mail/nome.
- Frontend: `AiEfficiencyHistoryBoard.tsx` (séries, estados vazios, rodapé de fonte), `NinoLearningBoard.tsx` + novo board global, `NinoIA.tsx` (rótulo da aba), `IAInteligencia.tsx` (ordem dos blocos).
- Testes: suíte de contrato garantindo que nenhuma chamada ao gateway exista sem registro no ledger e que a tela não some com dia zerado.
- Requer redeploy das funções afetadas; publicação em produção só com sua autorização.
