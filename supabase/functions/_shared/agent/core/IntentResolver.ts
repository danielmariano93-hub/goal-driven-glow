// Fachada de intenção para separar fluxo de caixa de renda operacional.
// "Entrou/saiu" em contexto bancário deve consultar o snapshot de caixa; já
// "renda/receita/ganhei" continua seguindo os motores operacionais existentes.
import * as legacy from "./IntentResolverImpl.ts";

export * from "./IntentResolverImpl.ts";

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCashFlowRead(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  // Se o usuário explicitou renda/receita/salário, preservamos a leitura operacional.
  if (/\b(renda|receita|salario|salarios|ganhei|faturamento)\b/.test(t)) return false;

  const explicitCash = /\b(fluxo de caixa|entrada(?:s)? de caixa|saida(?:s)? de caixa)\b/.test(t)
    || /\b(?:entrou|saiu|recebi)\b.{0,35}\b(?:conta|caixa|banco|pix|transferencia)\b/.test(t)
    || /\b(?:conta|caixa|banco)\b.{0,35}\b(?:entrou|saiu|recebi)\b/.test(t);
  if (explicitCash) return true;

  // Forma curta e inequívoca do card da Home: "quanto entrou/saiu [no período]?"
  return /^quanto(?: que)? (?:entrou|saiu)(?: (?:esse|este|no|neste|nesse) (?:mes|periodo))?\??$/.test(t);
}

export function resolveReadIntent(text: string): ReturnType<typeof legacy.resolveReadIntent> {
  if (isCashFlowRead(text)) {
    return {
      name: "financial_snapshot",
      required_tool: "get_financial_snapshot",
      allowed_tools: ["get_financial_snapshot"],
      score: 1,
      matched: "fluxo de caixa bancario",
    };
  }
  return legacy.resolveReadIntent(text);
}
