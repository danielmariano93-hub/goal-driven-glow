# Plano: Sincronizar main, deployar função e publicar

Sem alterações de código, sem migrations, sem reescrita de componentes.

## Passos

1. **Deploy da Edge Function** `assistant-ingest-document`
   - Usar `supabase--deploy_edge_functions` com `["assistant-ingest-document"]`.
   - Inclui automaticamente as dependências atuais de `supabase/functions/_shared` (cors, documents/types).
   - Confirmar sucesso do deploy antes de publicar o frontend.

2. **Verificação pré-publicação**
   - Rodar `security--get_scan_results` para checar findings críticos pendentes.
   - Se houver findings críticos, reportar ao usuário antes de publicar.

3. **Publicar frontend** (commit mais recente da main)
   - Usar `preview_ui--publish` sem alterar slug, sem tocar em metadados.
   - Informar ao usuário que a publicação foi agendada e ficará no ar em ~1 minuto.

## O que NÃO será feito
- Nenhuma edição de arquivo.
- Nenhuma migration nova.
- Nenhum redeploy de `whatsapp-*`, `agent-chat` ou outras funções.
- Nenhuma mudança de visibilidade, domínio ou configuração.

## Saída esperada
- Status do deploy de `assistant-ingest-document`.
- URL publicada retornada pelo `preview_ui--publish`.
