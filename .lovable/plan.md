# Correção definitiva do áudio do Nino no WhatsApp

## Diagnóstico confirmado

- Os áudios chegam ao webhook e são classificados corretamente como `audio/ogg; codecs=opus`.
- A falha acontece **antes da transcrição**, no download da mídia: o último evento registrou `direct:unsafe_url:invalid_scheme` e `provider:download_failed:status_401` em 16/08/2026 às 12:49:22 UTC.
- A configuração necessária existe no runtime (`api_url`, chave e sessão presentes).
- O downloader atual rejeita a URL recebida quando ela não é HTTPS e depois fabrica rotas a partir do ID da mensagem. Ele não reaproveita de forma segura o caminho real informado pelo provedor.
- A tentativa de três formatos diferentes de autenticação também mascara o diagnóstico: uma rota inexistente pode responder primeiro `404`, mas o resultado final registrado vira o `401` da última variação de header.
- Nenhuma chamada de transcrição foi alcançada nesse caso; portanto, trocar modelo ou prompt não resolveria o incidente.

## Implementação

### 1. Recuperar a mídia pela rota real, sem abrir brecha de SSRF

Em `wahaMedia.ts`:

- Interpretar a URL de mídia recebida apenas como **descritor de caminho** quando ela for interna, relativa ou usar origem não pública.
- Aceitar somente caminhos conhecidos de mídia do provedor, rejeitando traversal, credenciais embutidas, query insegura e qualquer destino arbitrário.
- Rebasear esse caminho na origem HTTPS já validada de `WAHA_API_URL` e fazer o download autenticado nela.
- Prioridade final: base64 embutido → URL HTTPS pública válida → caminho real rebaseado na origem confiável → fallbacks compatíveis por ID.
- Nunca enviar a chave do provedor a uma origem diferente da origem configurada.

### 2. Corrigir autenticação e diagnóstico da cascata

- Usar `X-Api-Key`, que já é o contrato utilizado com sucesso pelas demais chamadas do projeto, como autenticação principal.
- Remover tentativas redundantes que transformam um erro de rota em falso diagnóstico de credencial.
- Registrar por candidato apenas dados sanitizados: família da rota, status HTTP, método de autenticação e resultado; nunca URL completa, chave, áudio ou identificador pessoal.
- Preservar o erro mais informativo: `401/403` na rota canônica será `provider_unauthorized`; `404` em todos os candidatos será `media_not_found`; falha de rede continuará distinta.

### 3. Usar todos os identificadores corretos do payload

Em `wahaInbound.ts` e `wahaMedia.ts`:

- Preservar o caminho de mídia e o identificador interno do arquivo quando vierem em `media`, `audioMessage`, `pttMessage` ou `_data.message`.
- Não assumir que `provider_message_id` é também nome/ID do arquivo.
- Manter `chatId`, sessão e mensagem apenas como fallback compatível.

### 4. Impedir respostas de erro repetidas

Em `whatsapp-webhook/index.ts`:

- Manter uma única resposta idempotente por áudio.
- Agrupar reentregas do mesmo evento pelo ID canônico antes de enfileirar falha.
- Quando o download falhar, devolver uma mensagem única e curta; quando funcionar, seguir silenciosamente para o pipeline textual normal.

### 5. Transcrição dedicada e compatível

- Depois do download, converter OGG/Opus para um arquivo WAV completo e decodificável antes da transcrição, evitando dependência do suporte direto a Opus.
- Enviar o WAV ao endpoint dedicado de voz em modo streaming e concatenar os deltas até o evento final.
- Validar arquivo vazio, tamanho e duração antes do envio; erros do serviço permanecem visíveis na telemetria e nunca viram sucesso vazio.
- O texto transcrito entra no mesmo Agent Core de uma mensagem digitada, sem criar lógica financeira paralela.

## Testes obrigatórios

- URL interna/relativa com caminho válido é rebaseada na origem confiável e baixa com `X-Api-Key`.
- URL arbitrária, traversal ou origem externa nunca recebe credencial.
- `404` não é mascarado por `401`; credencial inválida é identificada corretamente.
- `audioMessage`, `pttMessage`, `root_media` e `_data.message` preservam o descritor necessário.
- OGG/Opus real é convertido para WAV e transcrito.
- Reentrega do mesmo áudio gera no máximo uma resposta.
- Texto transcrito percorre o pipeline normal e produz a resposta do Nino.

## Homologação e implantação

1. Executar testes unitários da extração, download seguro, conversão e idempotência.
2. Implantar `whatsapp-webhook`.
3. Enviar uma nota de voz real curta.
4. Confirmar nos logs a sequência: `audio_detected → media_downloaded → audio_transcribed → agent_started → outbound_queued`.
5. Confirmar no WhatsApp uma única resposta coerente com o conteúdo falado, sem mensagem intermediária de erro.
6. Se a rota canônica ainda responder `401`, interromper a homologação e apontar a configuração exata do provedor que rejeitou a credencial; não declarar sucesso parcial.

## Escopo

- Sem migrations e sem alteração em ledger, motores financeiros, autenticação ou app autenticado.
- Arquivos principais: `wahaInbound.ts`, `wahaMedia.ts`, `whatsapp-webhook/index.ts` e testes relacionados.