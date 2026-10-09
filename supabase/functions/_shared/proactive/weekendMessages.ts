// nino_weekend_messages.v1 — como a previsão do fim de semana vira mensagem.
//
// Princípios (decididos com o produto):
//  - UMA ideia por mensagem: o que a pessoa costuma gastar, para onde o mês vai e
//    o que muda se ela ficar num limite neste fim de semana. O resto fica em "detalhes".
//  - Valores sempre em reais (nunca só percentual) e sempre com a unidade dita:
//    "por fim de semana" (sexta a domingo), "no mês", "acima da meta".
//  - O efeito do limite é RECALCULADO (projeção − esperado + limite), nunca estimado.
//  - WhatsApp: título em negrito, blocos curtos, negrito nos números que decidem,
//    um emoji por bloco e uma única pergunta (bloco sem asteriscos, porque o
//    renderizador do WhatsApp deixa a pergunta inteira em negrito).
//  - App: o mesmo conteúdo em texto simples (sem asteriscos) e sem o convite de resposta.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { isWeekdayNudgeWindow } from "./weekdayNudge.ts";
import { WEEKEND_FORECAST_VERSION, type WeekendForecast } from "./weekendForecast.ts";

export const WEEKEND_MESSAGES_VERSION = "nino_weekend_messages.v1";

/** Reais inteiros: o que decide não precisa de centavos. */
export function money0(value: number): string {
  return `R$ ${Math.round(Math.abs(Number(value) || 0)).toLocaleString("pt-BR")}`;
}

const bold = (text: string) => `*${text}*`;
const plain = (text: string) => text.replace(/\*/g, "");

export type WeekendOffer = {
  category: string;
  friday: string;
  target: number;
  expected: number;
  projected_before: number;
  projected_if_target: number;
  anchor: WeekendForecast["anchor"];
};

export type WeekendMessage = {
  title: string;
  /** Texto simples (app e fila de prioridades). */
  body: string;
  whatsapp: { title: string; body: string };
  /** Resposta de "detalhes" (todas as categorias). */
  detail: string;
  /** Presente quando a mensagem convida a um limite para este fim de semana. */
  offer: WeekendOffer | null;
};

function anchorLabel(f: WeekendForecast): string {
  return f.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses";
}

function leftText(f: WeekendForecast): string {
  const n = Math.max(1, Math.ceil(f.weekend_units_left - 0.01));
  return n === 1 ? "só este fim de semana" : `${n} fins de semana contando este`;
}

function habitBlock(f: WeekendForecast): string {
  return `Você costuma gastar uns ${bold(money0(f.expected_per_weekend))} por fim de semana com ${f.category}.`;
}

function projectionBlock(f: WeekendForecast): string {
  const over = f.projected_month - f.anchor.amount;
  return `📈 No ritmo atual, o mês fecha em ${bold(money0(f.projected_month))}, ${bold(`${money0(over)} acima`)} da ${anchorLabel(f)} (${money0(f.anchor.amount)}).`;
}

function stepBlock(f: WeekendForecast): string | null {
  if (f.target == null || f.projected_if_target == null) return null;
  const left = f.projected_if_target - f.anchor.amount;
  const tail = left > 0 ? `, ainda ${bold(`${money0(left)} acima`)} da ${anchorLabel(f)}` : `, dentro da ${anchorLabel(f)}`;
  return `💡 Se neste fim de semana você ficar em ${bold(money0(f.target))}, o mês fecha em ${bold(money0(f.projected_if_target))}${tail}.`;
}

function gapBlock(list: WeekendForecast[]): string | null {
  return list.some((f) => f.data_gap === "card_missing")
    ? "ℹ️ Não encontrei compras de cartão neste mês; se ainda faltam lançar, o valor real pode ser maior."
    : null;
}

/** Resposta de "detalhes": tudo que ficou de fora da mensagem curta. */
export function weekendDetail(list: WeekendForecast[]): string {
  const sections = list.map((f) => {
    const lines = [
      `*${f.category}*`,
      `• Gasto em ${f.active_weekends} dos últimos ${f.weekends} fins de semana, em geral entre ${money0(f.low)} e ${money0(f.high)} (em média ${money0(f.expected_per_weekend)}).`,
      `• Neste mês: ${money0(f.month_to_date)} · ${f.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses"}: ${money0(f.anchor.amount)}.`,
      `• No ritmo atual o mês fecha em ${money0(f.projected_month)} (entre ${money0(f.projected_low)} e ${money0(f.projected_high)}).`,
    ];
    if (f.state === "pressure") {
      lines.push(f.fair_per_weekend > 0
        ? `• Para fechar na ${anchorLabel(f)}: uns ${money0(f.fair_per_weekend)} por fim de semana (${leftText(f)}), ${Math.round((1 - f.fair_per_weekend / Math.max(1, f.expected_per_weekend)) * 100)}% abaixo do seu padrão.`
        : "• Só com os dias úteis o mês já passa da referência.");
    } else {
      lines.push(`• Folga até o fim do mês: ${money0(f.slack)} (${leftText(f)}).`);
    }
    if (f.avg3m != null && f.anchor.kind === "goal") lines.push(`• Média dos últimos 3 meses: ${money0(f.avg3m)}.`);
    return lines.join("\n");
  });
  const gap = gapBlock(list);
  return ["📊 *Detalhes do fim de semana*", ...sections, ...(gap ? [gap] : [])].join("\n\n");
}

export function composeWeekendMessage(list: WeekendForecast[]): WeekendMessage | null {
  if (!list.length) return null;
  const f = list[0];
  const extras = list.slice(1, 3).filter((x) => x.state === "pressure");
  const gap = gapBlock(list);
  const extraBlocks = extras.map((x) => `⚠️ ${bold(x.category)} também passa da ${anchorLabel(x)} (${money0(x.projected_month - x.anchor.amount)} acima).`);
  const detailHint = list.length > 1 || f.state === "pressure" ? "Para ver o resto, responda *detalhes*." : null;

  let title: string;
  const content: string[] = [];
  let question: string | null = null;
  let reply: string | null = null;
  let offer: WeekendOffer | null = null;

  if (f.state === "pressure" && f.misaligned) {
    title = `🧭 Sextou! Sobre a meta de ${f.category}`;
    content.push(habitBlock(f), projectionBlock(f));
    const avg = f.avg3m != null ? ` (média de ${bold(money0(f.avg3m))} nos últimos 3 meses)` : "";
    content.push(`A meta está bem abaixo do seu padrão${avg}: cumpri-la pediria uns ${bold(money0(f.fair_per_weekend))} por fim de semana.`);
    question = "Quer revisar a meta?";
    reply = detailHint;
  } else if (f.state === "pressure") {
    title = `🎯 Sextou! Antes do fim de semana: ${f.category}`;
    content.push(habitBlock(f), projectionBlock(f));
    const step = stepBlock(f);
    if (step) content.push(step);
    if (f.target != null && f.projected_if_target != null) {
      offer = { category: f.category, friday: f.friday, target: f.target, expected: f.expected_per_weekend, projected_before: f.projected_month, projected_if_target: f.projected_if_target, anchor: f.anchor };
      question = "Topa tentar?";
      reply = `Responda ${bold("topo")} e eu te conto na segunda como foi.${detailHint ? ` ${detailHint}` : ""}`;
    } else {
      reply = detailHint;
    }
  } else {
    title = `✅ Sextou! Quanto cabe de ${f.category} neste fim de semana`;
    content.push(habitBlock(f));
    content.push(`Você está dentro da meta: restam ${bold(money0(f.slack))} até o fim do mês (${leftText(f)}).`);
    if (f.target != null && f.projected_if_target != null) {
      content.push(`💡 Para fechar o mês na meta, dá uns ${bold(money0(f.fair_per_weekend))} por fim de semana.`);
      offer = { category: f.category, friday: f.friday, target: f.target, expected: f.expected_per_weekend, projected_before: f.projected_month, projected_if_target: f.projected_if_target, anchor: f.anchor };
      question = `Topa ficar em ${money0(f.target)} neste fim de semana?`;
      reply = `Responda ${bold("topo")} e eu te conto na segunda como foi.${detailHint ? ` ${detailHint}` : ""}`;
    }
  }

  const shared = [...content, ...extraBlocks, ...(gap ? [gap] : [])];
  const waBody = [...shared, ...(question ? [question] : []), ...(reply ? [reply] : [])].join("\n\n");
  return {
    title: plain(title),
    body: shared.map(plain).join("\n\n"),
    whatsapp: { title: plain(title), body: waBody },
    detail: weekendDetail(list),
    offer,
  };
}

export function weekendForecastSituation(
  forecasts: WeekendForecast | WeekendForecast[] | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  const list = Array.isArray(forecasts) ? forecasts : forecasts ? [forecasts] : [];
  if (!list.length) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const message = composeWeekendMessage(list);
  if (!message) return null;
  const f = list[0];
  const shown = [f, ...list.slice(1, 3)];
  const confidence = Math.min(0.9, 0.55 + (f.active_weekends / f.weekends) * 0.3) - (list.some((x) => x.data_gap) ? 0.1 : 0);

  return {
    fingerprint: `${WEEKEND_FORECAST_VERSION}:${f.category}:${f.friday}`,
    type: "weekend_forecast",
    communication_kind: "weekend_spending_risk",
    severity: list.some((x) => x.state === "pressure") ? "attention" : "info",
    title: message.title,
    body: message.body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: f.state === "pressure" ? Math.round(Math.max(0, f.projected_month - f.anchor.amount) * 100) / 100 : f.slack,
    days_until: 0,
    confidence: Math.round(confidence * 100) / 100,
    actionable: true,
    route: "/app/relatorios",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: WEEKEND_FORECAST_VERSION,
      messages_version: WEEKEND_MESSAGES_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      // Guardado para o fechamento de segunda: previsto x realizado de cada categoria mostrada.
      forecast: f,
      forecasts: shown,
      // Texto do WhatsApp (negrito, emoji, convite de resposta) e resposta de "detalhes".
      whatsapp: message.whatsapp,
      detail: message.detail,
      offer: message.offer,
    },
  };
}
