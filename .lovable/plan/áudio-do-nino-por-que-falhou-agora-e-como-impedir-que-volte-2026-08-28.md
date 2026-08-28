# Áudio do Nino: por que falhou agora e como impedir que volte a falhar assim

## O que realmente aconteceu (verificado)

Seu áudio de hoje 16:47 (19:47 UTC) chegou normalmente ao Nino:

- Evento de pipeline registrado: `inbound_persisted` com `error_code: audio_ai_blocked`, `detail: status_403`, `mime: audio/ogg` — ou seja, o áudio foi recebido e identificado.
- A transcrição nem chegou a ser tentada: o circuito de IA (`ai_runtime_circuit`) está **pausado desde hoje 05:37 (08:37 UTC)** com `blocked_status: 403` e `requires: admin_action`.
- Nos logs do gateway, a última chamada do dia é exatamente esse 403 às 08:37 UTC; depois disso nenhuma chamada saiu.
- Contexto de faturamento: a assinatura está `past_due` desde 16/08 e o saldo diário/mensal está zerado (só resta saldo de top-up), o que é a origem do bloqueio 403 no gateway.

Portanto: não foi o áudio, não foi o formato e não foi o WhatsApp. O Nino ficou sem acesso a IA e respondeu com a mensagem de falha.

Dois defeitos de produto ficaram evidentes:

1. **O circuito não se recupera sozinho.** Uma vez pausado, ele fica pausado indefinidamente — mesmo depois de os créditos voltarem — porque nada reabre o circuito.
2. **O áudio é perdido.** Quando o bloqueio ocorre, o áudio não é guardado nem reprocessado depois; o usuário precisa gravar de novo e nunca sabe quando "de novo" vai funcionar.

## O que vou implementar

### 1. Circuito de IA com recuperação automática (sem intervenção manual)
- Sondagem controlada: passado um intervalo mínimo desde a pausa, o próximo turno faz **uma única** chamada de teste. Se passar, o circuito volta para `ok` e o produto normaliza; se falhar, a pausa é renovada (sem loop, sem enxurrada de tentativas).
- Registro auditável de cada pausa/retomada, para o painel admin mostrar desde quando e por quê.
- Nada de retry imediato: 402/403 continuam terminais no turno, conforme a política já adotada.

### 2. Áudio nunca mais é jogado fora
- Ao bloquear por IA, o áudio recebido é guardado (bytes já baixados, com prazo de expiração curto) junto do vínculo com a mensagem.
- Quando o circuito volta, o áudio pendente é transcrito e entra no pipeline textual normal, com o Nino respondendo em seguida — sem pedir para o usuário repetir.
- Se expirar sem destravar, aí sim o Nino avisa de forma honesta e encerra o pendente.

### 3. Mensagem honesta e específica
- Hoje a resposta de bloqueio se confunde com "não entendi seu áudio". Vou separar claramente: bloqueio de IA diz que o áudio **foi recebido e será processado assim que possível**, sem sugerir problema na gravação.
- Falhas reais de gravação/formato mantêm suas mensagens atuais.

### 4. Redução de desperdício que ajudou a esgotar o saldo
- As chamadas de fundo `google/gemini-2.5-pro` aparecem repetidamente **canceladas (499)** após 15–23s, já tendo consumido tokens: cada execução paga e não entrega nada.
- Vou alinhar esse caminho de fundo aos tiers atuais (modelo de análise, sem cancelamento por prazo curto) e torná-lo idempotente por execução, para não repetir o mesmo trabalho de hora em hora.

### 5. Testes de regressão
- Áudio com circuito pausado: sem chamada ao gateway, áudio guardado, mensagem correta.
- Retomada do circuito: sonda única, reabertura, reprocesso do áudio pendente.
- Expiração do pendente: mensagem final honesta e nenhum registro financeiro criado.
- Nenhuma chamada de fundo cancelada por prazo artificial.

## Fora de escopo
Landing page, identidade visual, autenticação, schema financeiro e qualquer nova "verdade financeira". Nada é publicado em produção sem sua autorização explícita.

## Ação sua, em paralelo
Enquanto o código não destrava o passado, o desbloqueio real depende de regularizar a assinatura `past_due` em Settings → Plans & credits. Com as correções acima, quando o saldo voltar o Nino volta a ouvir áudios **sozinho**, sem novo deploy e sem reset manual.

## Detalhes técnicos
- `supabase/functions/_shared/aiCircuit.ts`: adicionar `shouldProbeAiCircuit`/`resumeAiCircuit` com janela mínima entre sondas e colunas de controle (`probe_after`, `resumed_at`, contador de sondas) via migration.
- `supabase/functions/_shared/messaging/wahaMedia.ts`: no caminho `ai_blocked`, persistir o áudio pendente em vez de descartar; manter a checagem de circuito antes do `fetch`.
- Nova tabela `pending_audio_transcriptions` (RLS + GRANT explícitos, acesso apenas por service_role) com expiração e limpeza.
- Worker de retomada: reaproveitar o cron existente do WhatsApp para drenar pendentes quando o circuito estiver `ok`.
- `ActionPlanner.ts`/`aiCircuit.ts`: manter deterministic-first e Evidence Pack intactos; a sonda entra antes do planejamento apenas quando a janela expirou.
- Caminho de fundo do `gemini-2.5-pro`: mover para o tier de análise e remover o prazo que gera 499.
