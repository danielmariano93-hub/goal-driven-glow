import { describe, expect, it } from "vitest";
import { interpretSemanticQuery, mentionedWeekdays } from "../../supabase/functions/_shared/intelligence/semanticQuery";
import { composeWeekdayPatternReply } from "../../supabase/functions/_shared/intelligence/evidence";
import { computeWeekdayPatternFromDailyFacts } from "../../supabase/functions/_shared/analytics/weekdayPattern";

function days(from: string, weeks: number) {
  const out: Array<{ local_date: string; total_adjustable: number; total_consumption: number; entries_count: number }> = [];
  const start = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const amount = dow === 5 ? 300 : dow === 1 ? 280 : 40;
    out.push({ local_date: iso, total_adjustable: amount, total_consumption: amount, entries_count: 2 });
  }
  return out;
}

describe("clareza das respostas de padrão semanal", () => {
  it("reconhece plural e fim de semana na pergunta", () => {
    expect(mentionedWeekdays("as sextas-feiras e os finais de semana")).toEqual([0, 5, 6]);
    const q = interpretSemanticQuery("Dúvida: então as sextas-feiras não são onde eu tenho em média um maior gasto?");
    expect(q?.intent).toBe("weekday_pattern");
    expect(q?.interpretation).toBe("typical_behavior");
    expect(q?.mentioned_weekdays).toContain(5);
  });

  it("responde com período, base monetária e empate declarado", () => {
    const result = computeWeekdayPatternFromDailyFacts({
      days: days("2026-05-25", 12),
      from: "2026-05-25",
      to: "2026-08-16",
      coverage: 1,
      metricBase: "total_consumption",
      bankPostingShare: 0.7,
    });
    const query = interpretSemanticQuery("Em média, qual dia da semana eu gasto mais? E as sextas?")!;
    const reply = composeWeekdayPatternReply(result, query);
    expect(reply).toMatch(/semanas \(\d{2}\/\d{2} a \d{2}\/\d{2}\)/);
    expect(reply).toContain("Considerei todo o consumo confirmado");
    expect(reply).toContain("Sexta-feira");
    expect(reply).toMatch(/empatad|lidera/);
    expect(reply).toContain("data de lançamento do extrato");
    expect(result.metric_base).toBe("total_consumption");
  });
});
