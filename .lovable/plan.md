# Documentos no Assessor: correção P0 + pipeline para documentos grandes

Mais o fechamento definitivo dos 6 itens pendentes das Ondas A, B e C.

## O que a investigação mostrou (verificado no código e no banco)

Confirmado:

- **Truncamento silencioso é real.** A última importação (PDF, 00:20) terminou em `partial`: o motor detectou 9 fragmentos, processou 4 e parou ao bater o teto de 240 itens por documento (`resolveDocMaxItems`, hard cap 800). Os fragmentos restantes foram marcados `skipped` com `max_items_reached`, e `partial` está em `TERMINAL_STATUSES` — ou seja, **o documento nunca volta a ser retomado sozinho**.
- **Nenhuma importação nova foi criada depois disso** e nenhum incidente foi registrado em `edge_incidents`. Isso prova que a falha atual acontece **antes** de o servidor criar o registro — no cliente.
- Os únicos pontos do cliente que barram um arquivo antes de chamar o servidor são: a lista fixa `["image/jpeg","image/png","image/webp","application/pdf"]` (arquivo com `type` vazio ou `image/heic`, comum no iPhone, é recusado), o limite de 20 MB no anexo, e 12 MB na câmera nativa.
- Há um caminho de falha adicional já no servidor: o anexo declara sempre `image/jpeg` para imagens; se a conversão no navegador falhar (HEIC não decodifica no canvas), os bytes originais sobem com rótulo errado e o servidor derruba o job com `mime_mismatch`.
- A retomada automática de documentos travados existe (`documents-cleanup`), mas roda **de 6 em 6 horas** — o que na prática parece "nada acontece".

O que **não** está confirmado: qual desses gates recusou o arquivo específico do usuário. Por isso a primeira entrega inclui telemetria de rejeição do cliente, para que a causa deixe de ser inferência.

## O que será feito

### 1. Desbloquear o envio (P0)

- Aceitar qualquer arquivo cuja **extensão** seja de documento financeiro, mesmo com `type` vazio (iOS/Safari), e aceitar HEIC/HEIF explicitamente no seletor e na câmera.
- Converter HEIC/HEIF para JPEG no cliente; se a conversão falhar, **enviar os bytes originais com o MIME correto** em vez de mentir `image/jpeg`.
- O servidor passa a aceitar HEIC/HEIF e, quando os magic bytes discordarem do rótulo, **corrigir o rótulo** em vez de matar o job (só recusa o que realmente não é documento).
- Toda rejeição no cliente passa a registrar um evento de diagnóstico com motivo, tamanho e tipo — nunca mais uma falha invisível.

### 2. Documentos grandes de verdade (500–1000+ lançamentos)

- Fim do teto que trunca: o limite por documento deixa de cortar a extração e passa a ser apenas um teto de segurança alto e configurável; documento acima do teto vira aviso explícito, não silêncio.
- Processamento **contínuo por fragmento**, com retomada automática: cada fragmento é um checkpoint independente (já existe) e um worker de 1 minuto retoma qualquer documento com fragmento pendente ou batimento parado — incluindo os que hoje estão presos em `partial`.
- Um documento só é considerado concluído quando **todos** os fragmentos estão concluídos ou explicitamente falhados; `partial` deixa de ser estado final e passa a ser "em andamento com resultado parcial já disponível".
- Persistência incremental: os lançamentos de cada fragmento continuam salvos na hora, então a revisão já mostra o que foi lido enquanto o resto processa.
- Deduplicação por assinatura (data + valor + descrição) mantida e ampliada para o reprocessamento entre fragmentos, para reenvio do mesmo arquivo não duplicar nada.

### 3. Cobertura e honestidade do resultado

- A revisão passa a mostrar **cobertura do documento**: páginas lidas, fragmentos concluídos, lançamentos extraídos e, quando o extrato/fatura traz totais oficiais, a diferença entre o total oficial e a soma do que foi lido.
- Quando houver divergência, o Nino diz o que faltou e oferece continuar a leitura — em vez de apresentar número incompleto como verdade.

### 4. Observabilidade e UX

- Painel admin de documentos: fila por status, fragmentos travados, taxa de truncamento, tempo médio por fragmento e motivos de rejeição no cliente.
- No Assessor: progresso real ("página 12 de 48"), aviso de que pode fechar a tela, e um botão de continuar leitura quando o documento parou.

### 5. Fechamento das Ondas A, B e C

- **Harness E2E de escrita** cobrindo todas as entidades mutáveis (transação, dívida, meta, cartão, fatura, parcelamento, recorrência, compromisso, investimento, emoção, Divisão do Rolê), com relatório salvo em `docs/`.
- **Slots universais persistidos** por capability (`operation`, `capability`, `missing_slot`, `partial_payload`, `expires_at` com TTL), substituindo a expectativa conversacional isolada.
- **Observabilidade da fila de categorização** por status (queued/processing/completed/review/failed).
- **`docs/NINO_CAPABILITY_MATRIX.md` gerado automaticamente** (feature × capability × tool × motor × teste × status).
- **Ações interativas no recibo** (editar, excluir, desfazer) onde o canal suporta.
- **Dry run do backfill de categorização** com relatório por usuário antes de executar, e **aliases de merchant** com resolução hierárquica (UBER / UBER *TRIP / ON UBER TRIP).

## Detalhes técnicos

Arquivos principais:

- `src/components/assessor/AssessorAttachButton.tsx` — validação por extensão + MIME, conversão HEIC, MIME honesto, telemetria de rejeição.
- `src/components/native/NativeCaptureButton.tsx` — aceita HEIC da câmera do iPhone.
- `supabase/functions/_shared/documents/types.ts` — `ALLOWED_MIME` com HEIC/HEIF, novos tetos.
- `supabase/functions/assistant-ingest-document/index.ts` — MIME auto-corrigido, remoção do corte por teto, loop por fragmento com orçamento de tempo e reinvocação encadeada, `partial` não-terminal, cobertura.
- `supabase/functions/documents-cleanup/index.ts` + novo cron de 1 minuto — retomada de fragmentos pendentes com trava de execução única e teto de trabalho por rodada.
- Banco: colunas de cobertura em `document_imports`, tabela de aliases de merchant, tabela de slots do agente, view de fila de categorização.
- Testes: uploader (HEIC/type vazio), fragmentação de documento de 1000 itens, idempotência de reenvio, retomada após timeout, harness E2E de escrita.

Nenhuma alteração de identidade visual, paleta ou autenticação. Sem publicação em produção.
