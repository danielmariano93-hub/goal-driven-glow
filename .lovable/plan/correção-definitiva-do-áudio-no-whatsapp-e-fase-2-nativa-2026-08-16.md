# Correção definitiva do áudio no WhatsApp e Fase 2 nativa

## Objetivo

Entregar em uma única implementação dois resultados independentes e verificáveis:

1. Fazer notas de voz reais do WhatsApp chegarem ao mesmo pipeline textual do Nino, sem mensagens técnicas ou falhas silenciosas.
2. Criar a casca nativa do Meu Nino com Capacitor para iOS e Android, incluindo integração segura com sessão, deep links, câmera e gravação de áudio.

## Diagnóstico confirmado

- Os eventos mais recentes mostram que a mídia chega e é baixada, mas a conversão OGG/Opus falha antes da transcrição com `audio_unsupported_format` e detalhe `decode_failed`.
- A regressão está na conversão obrigatória com `ogg-opus-decoder`; os testes atuais cobrem download e cabeçalho WAV, mas não decodificam uma nota de voz OGG/Opus real.
- A Fase 2 nativa ainda não foi iniciada: não há Capacitor, configuração nativa, projetos iOS/Android, armazenamento seguro ou biometria.
- O app já possui manifesto PWA, metadados mobile, layout responsivo e uso parcial de safe areas; essa base será preservada.

## Frente 1 — Áudio do WhatsApp

### 1. Remover a conversão frágil do caminho principal

- Enviar OGG/Opus original, já aceito pelo endpoint de transcrição, sem converter obrigatoriamente para WAV.
- Manter normalização apenas como fallback explícito para formatos realmente incompatíveis.
- Remover a dependência de runtime do decoder se ela deixar de ter uso válido.

### 2. Robustez de formato e resposta

- Determinar o formato pelos bytes reais do arquivo, sem confiar apenas no MIME informado pelo WhatsApp.
- Preservar o pipeline único: áudio transcrito entra no mesmo roteador usado por mensagens digitadas.
- Classificar separadamente falhas de download, formato, transcrição, timeout e áudio sem fala.
- Garantir uma única resposta amigável ao usuário e impedir que códigos, fornecedores ou nomes técnicos apareçam na conversa.

### 3. Telemetria operacional

- Registrar estágios próprios: detectado, baixado, formato identificado, enviado para transcrição, transcrito e entregue ao agente.
- Registrar apenas metadados seguros: tamanho, MIME detectado, duração, latência e código de falha; nunca URL, chave, bytes ou conteúdo integral.
- Manter idempotência por mensagem inbound para impedir dupla transcrição e dupla resposta.

### 4. Validação obrigatória

- Adicionar fixture curta de OGG/Opus real e teste que percorra detecção, download, preparação e chamada simulada de transcrição.
- Cobrir também MP3/M4A, áudio vazio, arquivo corrompido, timeout e reentrega duplicada.
- Implantar a função e validar com uma nova nota de voz real no WhatsApp.
- Considerar a correção concluída somente quando os eventos mostrarem `audio_transcribed` e o Nino responder ao conteúdo falado.

## Frente 2 — Fase 2 com Capacitor

### 1. Casca nativa

- Instalar `@capacitor/core`, `@capacitor/ios`, `@capacitor/android` e `@capacitor/cli` como dependência de desenvolvimento.
- Inicializar com App ID `app.lovable.p73db6dbefc9046e48278b978492e7f92`, nome `goal-driven-glow` e diretório web `dist`.
- Configurar hot reload nativo pela URL de sandbox fornecida, com `cleartext: true` somente na configuração de desenvolvimento.
- Adicionar scripts seguros para sincronização e abertura das plataformas; os projetos `ios` e `android` serão gerados no ambiente local do proprietário, onde Xcode/Android Studio estão disponíveis.

### 2. Runtime nativo e áreas seguras

- Criar uma camada de detecção de plataforma para manter o comportamento web/PWA intacto.
- Integrar status bar, teclado, ciclo de vida e abertura de URLs.
- Completar safe areas superior, inferior e laterais, reaproveitando os tokens e o layout existentes.
- Tratar retorno do background e reconexão sem duplicar listeners ou requisições.

### 3. Deep links e autenticação

- Definir scheme/app links para rotas públicas de autenticação e rotas internas permitidas.
- Capturar links no runtime nativo, validar destino e navegar somente para caminhos internos autorizados.
- Manter o retorno OAuth/reset em uma rota pública de callback, hidratando a sessão antes de seguir para a rota desejada.
- Não alterar os arquivos de integração auto-gerados; a adaptação ocorrerá em uma camada própria ao redor do fluxo de autenticação.

### 4. Sessão segura e biometria opcional

- Criar storage nativo com Keychain no iOS e Keystore no Android, mantendo fallback web compatível.
- Migrar a sessão existente uma única vez e apagar a cópia insegura somente depois de confirmar a gravação segura.
- Usar biometria apenas como desbloqueio local opcional; ela nunca substituirá a autenticação do backend nem definirá permissões.
- Incluir fallback por login normal quando biometria estiver indisponível, for cancelada ou tiver sido alterada no dispositivo.

### 5. Câmera e gravação de áudio no app

- Integrar câmera/galeria ao fluxo já existente de documentos do Assessor, preservando revisão em lote antes de salvar.
- Integrar gravação nativa ao mesmo pipeline textual do Assessor, com permissão contextual, indicador de gravação, cancelar, ouvir e enviar.
- Manter upload e processamento no backend; nenhum dado financeiro será decidido apenas no dispositivo.
- Tratar negação de permissão, interrupção, arquivo grande, ausência de conexão e retomada do app.

## Segurança e compatibilidade

- Não alterar identidade visual, núcleo financeiro, banco ou autenticação além da camada estritamente necessária à sessão nativa.
- Nunca registrar tokens, áudios, URLs privadas ou credenciais.
- Restringir deep links a uma lista explícita de rotas internas.
- Preservar integralmente navegador desktop, mobile web e PWA.
- Solicitar permissões de câmera/microfone apenas no momento de uso, com justificativas em português.

## Critérios de aceite

- Uma nota de voz OGG/Opus real enviada pelo WhatsApp é transcrita e respondida pelo Nino uma única vez.
- Nenhuma mensagem ao usuário contém código de erro ou nome de fornecedor/ferramenta.
- Build web continua funcional e o projeto pode ser sincronizado pelo Capacitor para iOS e Android.
- Notch, status bar, teclado e barra inferior não sobrepõem conteúdo.
- Deep links de autenticação e do Assessor funcionam sem abrir rotas arbitrárias.
- Sessão nativa fica protegida por armazenamento seguro; biometria pode ser ativada e desativada sem bloquear a conta.
- Câmera e áudio nativos alimentam os fluxos existentes com estados de permissão, erro e cancelamento testados.

## Entrega e validação local

Após as alterações, exportar/puxar o projeto, executar `npm install`, adicionar as plataformas desejadas com `npx cap add ios` e/ou `npx cap add android`, compilar e executar `npx cap sync`. Depois de cada novo `git pull` que envolva recursos nativos, executar novamente `npx cap sync` antes de abrir ou rodar o projeto no Xcode/Android Studio.