// ChannelGuard — decide o que pode ser entregue por canal (app vs whatsapp).
// Regras:
//  - App: artefatos visuais renderizados inline (ChartArtifactRenderer), mensagens longas OK.
//  - WhatsApp: prefere texto compacto + imagem PNG do artefato (via artifact-render).
//    Se o render falhar, cai para fallback_text determinístico (nunca prometer gráfico).
// Uso: chame `resolveDelivery(channel, artifact)` antes de compor a resposta.
export type Channel = "app" | "whatsapp";

export type ArtifactRef = {
  id: string;
  media_url?: string | null;
  fallback_text?: string | null;
  summary_text?: string | null;
};

export type Delivery = {
  channel: Channel;
  attachImage: boolean;
  inlineChart: boolean;
  textOnly: boolean;
  reason: string;
};

export function resolveDelivery(channel: Channel, artifact: ArtifactRef | null): Delivery {
  if (channel === "app") {
    return {
      channel,
      attachImage: false,
      inlineChart: Boolean(artifact?.id),
      textOnly: !artifact,
      reason: artifact ? "app_inline_chart" : "app_text_only",
    };
  }
  // whatsapp
  if (artifact?.media_url) {
    return { channel, attachImage: true, inlineChart: false, textOnly: false, reason: "wa_image_ok" };
  }
  return {
    channel,
    attachImage: false,
    inlineChart: false,
    textOnly: true,
    reason: artifact ? "wa_image_missing_fallback_text" : "wa_no_artifact",
  };
}

/** Sanitiza copy para WhatsApp quando o render falhou: nunca afirmar "veja o gráfico". */
export function sanitizeWhatsappReply(text: string, delivery: Delivery): string {
  if (delivery.channel !== "whatsapp") return text;
  if (delivery.attachImage) return text;
  // Remove promessas de gráfico/imagem/anexo quando não há imagem.
  return text
    .replace(/(veja|olha|confira|segue|preparei|gerei|montei)\s+(o\s+)?(gr[áa]fico|imagem|visual|anexo)[^.\n]*\.?/gi, "")
    .replace(/\bem anexo\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
