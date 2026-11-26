// Pedidos e comandos de resumo pelo WhatsApp (determinístico, sem IA).
import { mondayOf, addDays, shiftMonth } from "./format.ts";

export type SummaryIntent =
  | { kind: "request"; type: "weekly"; weekStart: string; label: "current" | "previous" }
  | { kind: "request"; type: "monthly"; month: string; label: "current" | "closed" }
  | { kind: "resend" }
  | { kind: "clarify"; question: string }
  | { kind: "prefs"; weekly?: boolean; monthly?: boolean; hour?: number; reply: string };

const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s:]/g, " ").replace(/\s+/g, " ").trim();

export function parseSummaryIntent(text: string, today: string): SummaryIntent | null {
  const t = norm(text);
  if (!t || t.length > 120) return null;
  const mentions = /\b(resumo|resumos|relatorio|relatorios|fechamento)\b/.test(t);

  // Preferências.
  if (/\b(pare|para|parar|cancela|cancelar|cancele|nao quero mais)\b.*\b(resumos?|relatorios?)\b/.test(t) && !/\b(semanal|mensal)\b/.test(t)) {
    return { kind: "prefs", weekly: false, monthly: false, reply: "Combinado: não envio mais resumos automáticos. Para voltar, é só dizer \"ative resumo semanal\" ou \"ative resumo mensal\"." };
  }
  const toggle = t.match(/\b(ative|ativa|ativar|ligue|liga|ligar|desative|desativa|desativar|desligue|desliga|desligar)\b(?:.*\b(resumo|relatorio)s?\b)?.*\b(semanal|mensal|semanais|mensais)\b/);
  if (toggle) {
    const on = /^(ativ|lig)/.test(toggle[1]);
    const which = toggle[3].startsWith("seman") ? "weekly" : "monthly";
    const name = which === "weekly" ? "semanal (toda segunda às 8h)" : "mensal (todo dia 2 às 8h)";
    return { kind: "prefs", [which]: on, reply: on ? `Pronto: resumo ${name} ativado.` : `Pronto: resumo ${which === "weekly" ? "semanal" : "mensal"} desativado.` } as SummaryIntent;
  }
  const hourM = t.match(/\b(mude|muda|mudar|altere|altera|troque|troca)\b.*\bpara\s+(?:as\s+)?(\d{1,2})\s*(?:h|horas?|:00)\b/);
  if (hourM && (mentions || t.split(" ").length <= 5)) {
    const h = Number(hourM[2]);
    if (h >= 6 && h <= 22) return { kind: "prefs", hour: h, reply: `Pronto: seus resumos passam a chegar às ${h}h.` };
    return { kind: "clarify", question: "Consigo enviar os resumos entre 6h e 22h. Qual horário você prefere?" };
  }

  if (/\b(reenvi\w*|manda de novo|mande de novo|envia de novo|envie de novo)\b/.test(t) && (mentions || t.split(" ").length <= 4)) return { kind: "resend" };
  if (!mentions) return null;
  // Pergunta analítica que só cita "relatório" fica com o agente (ex.: "relatório de gastos com mercado").
  if (/\b(quanto|gast\w*|categori\w*|cartao|fatura|lancament\w*|mercado|compar\w*)\b/.test(t)) return null;
  // Precisa ser um pedido (não uma pergunta sobre outra coisa que cita "relatório").
  if (!/\b(manda|mande|me envia|me envie|envia|envie|quero|queria|gera|gere|ver|mostra|mostre|meu|minha|cade)\b/.test(t) && !/^(resumo|fechamento)\b/.test(t)) return null;

  const m = t.match(/\b(?:fechamento|resumo|relatorio)\s+(?:financeiro\s+)?(?:de|do mes de)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?(\d{4}))?/);
  if (m) {
    const curYm = today.slice(0, 7);
    const year = m[2] ? Number(m[2]) : Number(today.slice(0, 4));
    let ym = `${year}-${String(MONTHS[m[1]]).padStart(2, "0")}`;
    if (!m[2] && ym > curYm) ym = shiftMonth(ym, -12);
    if (ym > curYm) return { kind: "clarify", question: "Esse mês ainda não começou. Quer o resumo do mês atual?" };
    return { kind: "request", type: "monthly", month: ym, label: ym === curYm ? "current" : "closed" };
  }
  if (/\b(ultima semana|semana passada|semana anterior)\b/.test(t)) return { kind: "request", type: "weekly", weekStart: addDays(mondayOf(today), -7), label: "previous" };
  if (/\b(semana|semanal)\b/.test(t)) return { kind: "request", type: "weekly", weekStart: mondayOf(today), label: "current" };
  if (/\b(mes passado|mes anterior|ultimo mes)\b/.test(t)) return { kind: "request", type: "monthly", month: shiftMonth(today.slice(0, 7), -1), label: "closed" };
  if (/\b(mes|mensal|financeiro)\b/.test(t)) return { kind: "request", type: "monthly", month: today.slice(0, 7), label: "current" };
  return { kind: "clarify", question: "Você quer o resumo da semana ou do mês? Responda \"resumo da semana\" ou \"resumo do mês\"." };
}
