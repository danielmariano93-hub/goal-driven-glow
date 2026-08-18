import { describe, it, expect } from "vitest";
import {
  computeEmotionFinance,
  prospectiveSignal,
  associationSentence,
  DEFAULT_MIN_SAMPLE,
  type EmotionCheckinRow,
} from "@/lib/engine/emotionFinance";
import { resolveEmotion } from "@/lib/emotions/catalog";
import type { TransactionRow } from "@/lib/engine/facts";
import { interpret } from "../../supabase/functions/_shared/agent/parser";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";

const capability = (text: string) => classifyCapability(text, interpret(text), null);

const resolveEmotionKey = (value?: string | null, mood?: number | null) => {
  const found = resolveEmotion(value);
  if (found) return { key: found.key, label: found.label };
  return null;
};

let seq = 0;
function tx(day: string, amount: number, categoryId = "cat-food"): TransactionRow {
  seq += 1;
  return {
    id: `t${seq}`,
    account_id: "acc",
    category_id: categoryId,
    type: "expense",
    status: "confirmed",
    amount,
    occurred_at: day,
    description: "compra",
    transfer_group_id: null,
    movement_kind: "transaction",
  };
}

function checkin(day: string, key: string): EmotionCheckinRow {
  return { occurred_at: `${day}T10:00:00-03:00`, mood: 3, emotion_key: key };
}

/** Gera dias de uma janela. */
function days(from: string, count: number): string[] {
  const out: string[] = [];
  const base = new Date(`${from}T12:00:00Z`).getTime();
  for (let i = 0; i < count; i++) out.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
  return out;
}

const period = { from: "2026-05-01", to: "2026-07-31" };

describe("emotion_finance.v1", () => {
  it("declara amostra insuficiente com poucos episódios", () => {
    const txs = days("2026-05-01", 60).map((d) => tx(d, 100));
    const checkins = [checkin("2026-05-05", "atento"), checkin("2026-05-12", "atento")];
    const env = computeEmotionFinance({ txs, checkins, period, resolveEmotionKey });
    expect(env.facts.patterns[0].confidence).toBe("insufficient_data");
    expect(env.facts.patterns[0].facts.material).toBe(false);
  });

  it("detecta uplift consistente acima do baseline pessoal", () => {
    const allDays = days("2026-05-01", 90);
    const emotionDays = allDays.filter((_, i) => i % 9 === 0).slice(0, 8);
    const txs = allDays.map((d) => tx(d, emotionDays.includes(d) ? 300 : 100));
    const checkins = emotionDays.map((d) => checkin(d, "impulsivo"));
    const env = computeEmotionFinance({ txs, checkins, period, windowDays: 0, resolveEmotionKey });
    const pattern = env.facts.patterns[0];
    expect(pattern.facts.sample_size).toBeGreaterThanOrEqual(DEFAULT_MIN_SAMPLE);
    expect(pattern.facts.direction).toBe("acima");
    expect(pattern.facts.uplift_pct).toBeGreaterThan(100);
    expect(pattern.facts.consistency_hits).toBe(pattern.facts.sample_size);
    expect(pattern.facts.material).toBe(true);
  });

  it("neutraliza o confundidor 'sexta-feira já é dia de gastar mais'", () => {
    // Sextas custam 300; outros dias 100. Todos os check-ins caem na sexta.
    const allDays = days("2026-05-01", 90);
    const isFriday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5;
    const txs = allDays.map((d) => tx(d, isFriday(d) ? 300 : 100));
    const fridays = allDays.filter(isFriday).slice(0, 8);
    const checkins = fridays.map((d) => checkin(d, "atento"));
    const env = computeEmotionFinance({ txs, checkins, period, windowDays: 0, resolveEmotionKey });
    const pattern = env.facts.patterns[0];
    // O baseline é o da própria sexta-feira, então não há uplift atribuível à emoção.
    expect(pattern.facts.direction).toBe("estavel");
    expect(pattern.facts.material).toBe(false);
  });

  it("não deixa um dia atípico contaminar o baseline", () => {
    const allDays = days("2026-05-01", 90);
    const txs = allDays.map((d, i) => tx(d, i === 40 ? 9000 : 100));
    const emotionDays = allDays.filter((_, i) => i % 11 === 0).slice(0, 7);
    const txsWithEmotion = txs.map((t) =>
      emotionDays.includes(t.occurred_at) ? { ...t, amount: 200 } : t
    );
    const checkins = emotionDays.map((d) => checkin(d, "frustrado"));
    const env = computeEmotionFinance({ txs: txsWithEmotion, checkins, period, windowDays: 0, resolveEmotionKey });
    const pattern = env.facts.patterns[0];
    expect(pattern.facts.expected_avg).toBeLessThan(200);
    expect(pattern.facts.direction).toBe("acima");
  });

  it("sinal prospectivo só sai com padrão material e confiável", () => {
    const allDays = days("2026-05-01", 90);
    const emotionDays = allDays.filter((_, i) => i % 7 === 0).slice(0, 12);
    const txs = allDays.map((d) => tx(d, emotionDays.includes(d) ? 260 : 100));
    const checkins = emotionDays.map((d) => checkin(d, "impulsivo"));
    const env = computeEmotionFinance({ txs, checkins, period, windowDays: 0, resolveEmotionKey });
    const signal = prospectiveSignal(env.facts.patterns, "impulsivo");
    expect(signal).not.toBeNull();
    expect(signal!.sample_size).toBeGreaterThanOrEqual(DEFAULT_MIN_SAMPLE);
    expect(prospectiveSignal(env.facts.patterns, "tranquilo")).toBeNull();
  });

  it("nunca usa linguagem causal", () => {
    const facts = {
      emotion_key: "impulsivo",
      emotion_label: "Impulsivo",
      sample_size: 10,
      window_days: 2,
      observed_avg: 200,
      expected_avg: 120,
      delta_abs: 80,
      uplift_pct: 66,
      consistency_hits: 8,
      consistency_rate: 0.8,
      purchases_avg: 3,
      purchases_baseline_avg: 2,
      ticket_avg: 66,
      ticket_baseline_avg: 60,
      direction: "acima" as const,
      material: true,
    };
    const sentence = associationSentence(facts, [], null);
    expect(sentence).toMatch(/associação/i);
    expect(sentence).not.toMatch(/porque|causou|por estar|culpa/i);
  });
});

describe("roteamento de emoção × gasto", () => {
  it("manda pergunta de padrão para o motor determinístico", () => {
    const decision = capability("quando eu fico ansioso eu gasto mais?");
    expect(decision.name).toBe("emotion_finance");
    expect(decision.required_tool).toBe("get_emotion_finance_patterns");
  });

  it("mantém registro de humor na rota de check-in", () => {
    expect(capability("hoje fui ansioso").name).toBe("emotional_checkin");
  });
});
