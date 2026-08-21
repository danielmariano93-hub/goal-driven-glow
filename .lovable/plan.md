# Correção sistêmica do Nino: áudio, continuidade e emoção fiel

## Diagnóstico confirmado

Os três incidentes têm causas diferentes e comprovadas:

1. **Áudio não entendido**: o arquivo OGG/Opus foi reconhecido, baixado e enviado para transcrição, mas o gateway respondeu **HTTP 402**. O workspace está com assinatura `past_due` e **0 créditos disponíveis para IA**. Não é falha de download nem de reconhecimento do formato.
2. **“Quanto posso gastar hoje…” → “200”**: a primeira mensagem preserva “hoje”, mas o roteador descarta essa data quando ainda não há valor e pergunta por valor **e data**. A resposta curta `200` não é reconhecida como continuação da simulação; vira tentativa de registrar despesa. O fluxo então chamou dois modelos, ambos receberam 402, e caiu numa resposta incoerente.
3. **“Triste” registrado como “preocupado”**: o parser possui um mapeamento explícito `triste → preocupado`; a ferramenta grava e responde usando o rótulo normalizado. Além disso, respostas curtas não preservam o termo original nas observações.

## Entrega

### 1. Restaurar o canal de IA e aplicar semântica correta de erros

- O desbloqueio operacional exige regularizar a assinatura/créditos do workspace; código não consegue corrigir saldo de créditos.
- Depois do desbloqueio, executar uma chamada real de transcrição e uma chamada real de conversa antes de considerar a entrega concluída.
- Alterar os clientes do gateway para guardar status, mensagem e `props.requires`, sem reduzir tudo a `gateway_402`.
- Tratar `400`, `401`, `402` e `403` como terminais: sem segunda tentativa e sem trocar de modelo dentro do mesmo turno.
- Em `402/403`, persistir o circuito de trabalhos automáticos como pausado e impedir novos jobs de IA; permitir somente retomada explícita ou uma sondagem controlada em execução agendada posterior.
- Manter retentativa limitada somente para `429` e `5xx`, respeitando `Retry-After` e backoff antes de cada tentativa.
- No WhatsApp/App, mostrar a mensagem real e acionável do gateway, sem resposta genérica nem afirmação falsa de que o áudio não foi entendido.

### 2. Continuação estruturada para perguntas incompletas

Criar uma expectativa `before_spending` com os slots já conhecidos e os slots faltantes.

Fluxo corrigido:

```text
Usuário: Quanto posso gastar hoje pra não sair das minhas metas?
Nino: Qual valor você quer avaliar?
Usuário: 200
Nino: executa run_before_spending(amount=200, planned_date=hoje)
```

- Separar a extração dos slots `amount`, `planned_date`, `category`, `method`, `card` e `installments`; nunca apagar “hoje” só porque o valor ainda falta.
- Persistir a intenção e os slots conhecidos na memória conversacional, em vez de reconstruir o pedido concatenando texto livre.
- Reconhecer valor isolado (`200`, `R$ 200`, `duzentos`) como resposta ao slot de simulação, antes do classificador de lançamento.
- Perguntar somente o slot realmente necessário.
- Garantir que uma expectativa de simulação nunca gere `create_transaction_draft` e nunca dependa de modelo para decidir se o valor cabe.
- Limpar a expectativa após execução, cancelamento, mudança explícita de assunto ou expiração.

### 3. Emoção declarada como verdade do usuário

Evoluir o catálogo emocional para preservar **Triste** como emoção própria, sem apresentar “preocupado” ao usuário.

- Adicionar `triste` ao catálogo canônico, com label `Triste`, emoji próprio e mood analítico compatível.
- Remover os aliases `triste → preocupado`, `meio triste → preocupado` e os equivalentes de choro que apagam a emoção declarada.
- Unificar a fonte do catálogo usada pelo frontend e pelas funções para impedir divergência futura.
- Fazer o parser devolver também o trecho declarado que produziu a classificação.
- Adicionar campos aditivos ao check-in para preservar o texto/termo declarado; manter `mood`, `emotion_key` e colunas atuais para compatibilidade.
- Gravar a fala original mesmo quando ela tiver uma única palavra.
- O recibo deve repetir a emoção declarada: “Registrei: hoje você se sentiu triste”.
- Corrigir apenas o registro comprovadamente afetado pelo incidente, vinculando a reparação à mensagem original; não reclassificar históricos em massa por inferência.

### 4. Áudio com diagnóstico e recuperação honestos

- Diferenciar falha de mídia, ausência de configuração, bloqueio por créditos/política, limite de taxa e falha transitória.
- Para `402/403`, não pedir que a pessoa repita o áudio: informar indisponibilidade temporária do recurso e a ação necessária ao responsável.
- Para `429/5xx`, aplicar retentativa limitada com espera; depois estacionar o processamento sem loop.
- Manter o áudio já baixado associado ao evento para reprocessamento idempotente após a recuperação, sem criar mensagem duplicada.
- Preservar a transcrição como entrada do mesmo pipeline textual do App/WhatsApp.

### 5. Testes e prova de funcionamento

**Unitários/contrato**
- “hoje” fica preservado quando só o valor está ausente.
- `200`, `R$ 200` e `duzentos` retomam `before_spending`; nenhum cria rascunho de despesa.
- `triste`, `estou triste`, `😢` e áudio transcrito com “triste” gravam e respondem `Triste`.
- Catálogo do frontend e do backend tem uma única fonte/contrato.
- `400/401/402/403` não fazem fallback de modelo; `429/5xx` aguardam e respeitam limite de tentativas.
- Mensagem de erro do gateway chega à superfície sem vazar fornecedor/modelo.

**Integração/E2E real**
- Executar no simulador e no WhatsApp a sequência “Quanto posso gastar hoje…” → “200” e comprovar chamada de `run_before_spending`, resposta baseada no snapshot e zero escrita financeira.
- Enviar nota de voz OGG/Opus real, comprovar download, transcrição e encaminhamento ao AgentCore.
- Fazer check-in “Triste nino”, ler novamente o registro e comprovar `emotion_key=triste`, texto declarado preservado e recibo fiel.
- Simular respostas `402`, `429` e `5xx` no cliente do gateway e validar circuito, backoff e mensagem ao usuário.
- Conferir `agent_runs`, `agent_decisions` e eventos do pipeline para provar caminho, ferramenta, ausência de escrita indevida e ausência de retries proibidos.

## Arquivos e backend

- `supabase/functions/_shared/agent/core/ConversationExpectation.ts`
- `supabase/functions/_shared/agent/core/CapabilityRouter.ts`
- `supabase/functions/_shared/agent/core/AgentCore.ts`
- `supabase/functions/_shared/agent/core/ActionPlanner.ts`
- `supabase/functions/_shared/agent/llm.ts`
- `supabase/functions/_shared/intelligence/emotionParse.ts`
- `supabase/functions/_shared/agent/tools.ts`
- `supabase/functions/_shared/messaging/wahaMedia.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
- catálogo emocional compartilhado e consumidores no frontend
- migration aditiva para emoção declarada e estado do circuito de IA, com grants explícitos e RLS
- testes de unidade, contrato, integração e E2E dos três incidentes

## Critério de encerramento

A entrega só será marcada como concluída quando houver evidência real dos três fluxos funcionando. Enquanto o workspace permanecer com 0 créditos de IA, as correções determinísticas e de erro podem ser implantadas, mas áudio e conversa por modelo ficam explicitamente bloqueados — nunca serão declarados como testados ou concluídos.
