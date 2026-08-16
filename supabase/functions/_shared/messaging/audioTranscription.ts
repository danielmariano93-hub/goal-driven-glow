// Rota de áudio inbound: a implementação vive em `wahaMedia.ts` (mesmo módulo
// do downloader) e é reexportada aqui para manter o ponto de importação
// estável em testes e chamadas existentes.
export {
  audioFailureReply,
  isAudioMedia,
  transcribeInboundAudio,
  type AudioHint,
  type AudioTranscriptionCode,
  type AudioTranscriptionResult,
} from "./wahaMedia.ts";
