// ComparisonPresentation — canonical deterministic wording for financial comparisons.
// Keeps monetary deltas, percentages and window semantics aligned with the
// evidence emitted by the analytical engines. Percentages are only shown when
// the baseline is non-zero; a zero baseline has no finite percentage change.
// deno-lint-ignore-file no-explicit-any

import type { ComparisonEvidenceRow } from "./ConversationReferenceStore.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function money(value: unknown): string {
  return BRL.format(Number(value ?? 0));
}

function directionWord(delta: number): "acima" | "abaixo" {
  return delta >= 0 ? "acima" : "abaixo";
}

function percentText(deltaPct: unknown): string | null {
  if (deltaPct == null || deltaPct === "") return null;
  const ratio = Number(deltaPct);
  if (!Number.isFinite(ratio)) return null;
  return `${PCT.format(Math.abs(ratio) * 100)}%`;
}

export function comparisonDeltaLabel(row: {
  delta_abs?: unknown;
  delta_pct?: unknown;
  total_a?: unknown;
}): string {
  const delta = Number(row.delta_abs ?? 0);
  const pct = percentText(row.delta_pct);
  if (pct) return `${money(Math.abs(delta))} (${pct})`;
  if (Math.abs(Number(row.total_a ?? 0)) < 0.005 && Math.abs(delta) > 0.005) {
    return `${money(Math.abs(delta))} (base anterior zerada; % não aplicável)`;
  }
  return money(Math.abs(delta));
}

export function formatComparisonEvidenceRow(row: ComparisonEvidenceRow): string {
  const delta = Number(row.delta_abs ?? 0);
  return `*${row.name}* ficou ${comparisonDeltaLabel(row)} ${directionWord(delta)} da referência: ${money(row.total_b)} versus ${money(row.total_a)}.`;
}

export function formatComparisonRankLine(row: ComparisonEvidenceRow, rank: number): string {
  const delta = Number(row.delta_abs ?? 0);
  return `${rank}. *${row.name}* — ${comparisonDeltaLabel(row)} ${directionWord(delta)}`;
}

function averageSemantics(result: any, months: number) {
  const alignment = String(result?.comparison_alignment ?? "");
  if (alignment === "preceding_rolling_window") {
    return {
      aboveHeading: `Em *${String(result?.target_label ?? "o período analisado")}*, ficaram acima da *média mensal da janela de ${months} meses imediatamente anterior*:`,
      belowHeading: `Em *${String(result?.target_label ?? "o período analisado")}*, ficaram abaixo da *média mensal da janela de ${months} meses imediatamente anterior*:`,
      compareHeading: `Comparando a média mensal de *${String(result?.target_label ?? "o período analisado")}* com a média mensal da *janela de ${months} meses imediatamente anterior*:`,
      targetValueLabel: "média mensal no período",
      baselineValueLabel: "média mensal anterior",
      baselineShort: `média mensal da janela anterior de ${months} meses`,
    };
  }
  if (alignment === "aligned_month_to_date") {
    return {
      aboveHeading: `No período atual, ficaram acima da *média do mesmo recorte de dias nos ${months} meses anteriores*:`,
      belowHeading: `No período atual, ficaram abaixo da *média do mesmo recorte de dias nos ${months} meses anteriores*:`,
      compareHeading: `Comparando o período atual com a média do *mesmo recorte de dias nos ${months} meses anteriores*:`,
      targetValueLabel: "período atual",
      baselineValueLabel: "média do mesmo recorte",
      baselineShort: `média do mesmo recorte nos ${months} meses anteriores`,
    };
  }
  return {
    aboveHeading: `Em *${String(result?.target_label ?? "o período analisado")}*, ficaram acima da média dos *${months} meses completos anteriores*:`,
    belowHeading: `Em *${String(result?.target_label ?? "o período analisado")}*, ficaram abaixo da média dos *${months} meses completos anteriores*:`,
    compareHeading: `Comparando *${String(result?.target_label ?? "o período analisado")}* com a média dos *${months} meses completos anteriores*:`,
    targetValueLabel: "valor mensal",
    baselineValueLabel: "média anterior",
    baselineShort: `média dos ${months} meses completos anteriores`,
  };
}

export function formatAverageComparisonEnhanced(result: any): string {
  const rows: any[] = Array.isArray(result?.by_group) ? result.by_group : [];
  const direction = ["increase", "decrease", "both", "any"].includes(String(result?.requested_comparison_direction ?? "any"))
    ? String(result.requested_comparison_direction)
    : "any";
  const rawLimit = Number(result?.requested_limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : null;
  const months = Math.max(2, Number(result?.baseline_window_months ?? 3));
  const semantics = averageSemantics(result, months);

  const increases = rows
    .filter((row) => Number(row?.delta_abs ?? 0) > 0.005)
    .slice()
    .sort((a, b) => Number(b.delta_abs ?? 0) - Number(a.delta_abs ?? 0));
  const decreases = rows
    .filter((row) => Number(row?.delta_abs ?? 0) < -0.005)
    .slice()
    .sort((a, b) => Number(a.delta_abs ?? 0) - Number(b.delta_abs ?? 0));
  const take = (list: any[]) => limit ? list.slice(0, limit) : list;
  const line = (row: any) => {
    const delta = Number(row?.delta_abs ?? 0);
    const sign = delta >= 0 ? "+" : "−";
    return `• *${String(row.name)}* — ${semantics.targetValueLabel}: ${money(row.total_b)} · ${semantics.baselineValueLabel}: ${money(row.total_a)} · ${sign}${comparisonDeltaLabel(row)}`;
  };

  if (direction === "increase") {
    const selected = take(increases);
    if (!selected.length) return `Nenhuma categoria ficou acima da ${semantics.baselineShort}.`;
    if (limit === 1) {
      const row = selected[0];
      return `A categoria que ficou mais acima foi *${String(row.name)}*: ${comparisonDeltaLabel(row)} acima — ${semantics.targetValueLabel} ${money(row.total_b)} versus ${semantics.baselineValueLabel} ${money(row.total_a)}.`;
    }
    return [semantics.aboveHeading, "", ...selected.map(line)].join("\n");
  }

  if (direction === "decrease") {
    const selected = take(decreases);
    if (!selected.length) return `Nenhuma categoria ficou abaixo da ${semantics.baselineShort}.`;
    if (limit === 1) {
      const row = selected[0];
      return `A categoria que ficou mais abaixo foi *${String(row.name)}*: ${comparisonDeltaLabel(row)} abaixo — ${semantics.targetValueLabel} ${money(row.total_b)} versus ${semantics.baselineValueLabel} ${money(row.total_a)}.`;
    }
    return [semantics.belowHeading, "", ...selected.map(line)].join("\n");
  }

  if (direction === "both") {
    const up = take(increases);
    const down = take(decreases);
    const out = [semantics.compareHeading];
    out.push("", up.length ? "*Acima da referência:*" : "*Acima da referência:* nenhuma");
    out.push(...up.map(line));
    out.push("", down.length ? "*Abaixo da referência:*" : "*Abaixo da referência:* nenhuma");
    out.push(...down.map(line));
    return out.join("\n");
  }

  const changed = rows
    .filter((row) => Math.abs(Number(row?.delta_abs ?? 0)) > 0.005)
    .slice()
    .sort((a, b) => Math.abs(Number(b.delta_abs ?? 0)) - Math.abs(Number(a.delta_abs ?? 0)));
  const selected = take(changed);
  if (!selected.length) return "As categorias ficaram praticamente estáveis nesse comparativo.";
  return [semantics.compareHeading, "", ...selected.map(line)].join("\n");
}

export function formatPeriodComparisonEnhanced(result: any): string {
  const totalA = Number(result?.total_a ?? 0);
  const totalB = Number(result?.total_b ?? 0);
  const delta = Number(result?.delta_abs ?? (totalB - totalA));
  const totalRatio = result?.delta_pct != null
    ? Number(result.delta_pct)
    : totalA > 0 ? delta / totalA : null;
  const byCategory = result?.requested_group_by === "category";
  const rows: any[] = Array.isArray(result?.by_group) ? result.by_group : [];
  const requestedDirection = ["increase", "decrease", "both", "any"].includes(String(result?.requested_comparison_direction ?? "any"))
    ? String(result.requested_comparison_direction ?? "any")
    : "any";
  const rawLimit = Number(result?.requested_limit);
  const requestedLimit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : null;

  if (byCategory) {
    const increases = rows.filter((row) => Number(row?.delta_abs ?? 0) > 0.005).slice().sort((a, b) => Number(b.delta_abs ?? 0) - Number(a.delta_abs ?? 0));
    const decreases = rows.filter((row) => Number(row?.delta_abs ?? 0) < -0.005).slice().sort((a, b) => Number(a.delta_abs ?? 0) - Number(b.delta_abs ?? 0));
    const limited = (items: any[]) => requestedLimit ? items.slice(0, requestedLimit) : items;
    const compact = (row: any, direction: "increase" | "decrease") =>
      `*${String(row.name)}* (${direction === "increase" ? "aumento" : "queda"} de ${comparisonDeltaLabel(row)})`;
    const detailed = (row: any, direction: "increase" | "decrease") =>
      `*${String(row.name)}*: ${comparisonDeltaLabel(row)} ${direction === "increase" ? "a mais" : "a menos"}, de ${money(row.total_a)} para ${money(row.total_b)}.`;

    if (requestedDirection === "increase") {
      const selected = limited(increases);
      if (!selected.length) return "Nenhuma dessas categorias aumentou nesse comparativo.";
      if (requestedLimit === 1) return `A categoria que mais aumentou foi ${detailed(selected[0], "increase")}`;
      return `Aumentaram: ${selected.map((row) => compact(row, "increase")).join("; ")}.`;
    }
    if (requestedDirection === "decrease") {
      const selected = limited(decreases);
      if (!selected.length) return "Nenhuma dessas categorias diminuiu nesse comparativo.";
      if (requestedLimit === 1) return `A categoria que mais diminuiu foi ${detailed(selected[0], "decrease")}`;
      return `Diminuíram: ${selected.map((row) => compact(row, "decrease")).join("; ")}.`;
    }
    if (requestedDirection === "any" && requestedLimit === 1) {
      const changed = rows.filter((row) => Math.abs(Number(row?.delta_abs ?? 0)) > 0.005).slice().sort((a, b) => Math.abs(Number(b.delta_abs ?? 0)) - Math.abs(Number(a.delta_abs ?? 0)));
      const top = changed[0];
      if (!top) return "Essas categorias ficaram praticamente estáveis nesse comparativo.";
      return `A maior variação foi em ${detailed(top, Number(top.delta_abs) > 0 ? "increase" : "decrease")}`;
    }
    const selectedIncreases = limited(increases);
    const selectedDecreases = limited(decreases);
    if (!selectedIncreases.length && !selectedDecreases.length) return "Essas categorias ficaram praticamente estáveis nesse comparativo.";
    return [
      selectedIncreases.length ? `Aumentaram: ${selectedIncreases.map((row) => compact(row, "increase")).join("; ")}.` : "Aumentaram: nenhuma.",
      selectedDecreases.length ? `Diminuíram: ${selectedDecreases.map((row) => compact(row, "decrease")).join("; ")}.` : "Diminuíram: nenhuma.",
    ].join("\n");
  }

  if (Math.abs(delta) < 0.005) return `Os dois períodos ficaram praticamente iguais: ${money(totalA)} e ${money(totalB)}.`;
  const label = comparisonDeltaLabel({ delta_abs: delta, delta_pct: totalRatio, total_a: totalA });
  return `Seus gastos ${delta > 0 ? "aumentaram" : "diminuíram"} *${label}*: de ${money(totalA)} para ${money(totalB)}.`;
}
