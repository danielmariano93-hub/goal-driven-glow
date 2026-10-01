import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { behaviorHabitsReading, RECONSTRUCTED_METHODOLOGY_VERSION, type ObservedSnapshot } from "@/lib/engine/behaviorEvolution";
import { OBSERVED_SNAPSHOT_MIN_COVERAGE, observedInputFromDashboardPayload } from "@/lib/engine/behaviorObserved";
import { isBehaviorEvolutionQuestion, classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { resolveV2DeterministicReadCapability } from "../../supabase/functions/_shared/agent/core/V2DeterministicHumanGate";
import { formatBehaviorEvolution } from "../../supabase/functions/_shared/agent/core/DeterministicAnswersImpl";
import { CAPABILITIES } from "../../supabase/functions/_shared/agent/core/CapabilityRegistry";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("supabase/migrations/20261001320000_behavior_observed_weekly_and_timed_pairing.sql");
const job = read("supabase/functions/behavior-observed-weekly/index.ts");
const runtime = read("supabase/functions/_shared/behavioral/observedRuntime.ts");
const page = read("src/pages/Emocoes.tsx");
const parts = read("src/components/behavioral/EvolutionParts.tsx");
const snapshotsHook = read("src/lib/behavioral/observedSnapshots.ts");
const syncScript = read("scripts/sync-finance-core.mjs");

const dims = (score: number) => Object.fromEntries(
  ["awareness", "planning", "control", "consistency", "security", "wealth", "calm", "debt"].map((k) => [k, { score, confidence: "medium" }]),
);
const profile = (score: number) => ({
  overallScore: score, coverage: 8, asOf: "2026-10-01",
  dimensions: Object.fromEntries(Object.entries(dims(score)).map(([k, v]) => [k, { ...v, evidence: "", source: "" }])),
}) as never;
const snap = (week_start: string, score: number, methodology_version = "behavior_observed.v2"): ObservedSnapshot =>
  ({ week_start, overall_score: score, coverage: 8, confidence: "medium", methodology_version, dimensions: dims(score) } as never);

describe("Entrega 2 — veredito único app × servidor", () => {
  it("app e servidor usam o mesmo behaviorHabitsReading e o mesmo mapeamento do payload", () => {
    expect(page).toContain("behaviorHabitsReading({");
    expect(runtime).toContain("behaviorHabitsReading({");
    expect(runtime).toContain("observedInputFromDashboardPayload(");
    expect(runtime).toContain('from "../finance-core/index.ts"');
    for (const mod of ["behaviorDimensions", "behaviorObserved", "behaviorEvolution", "emotionSpendPairing"]) {
      expect(syncScript).toContain(`"${mod}"`);
    }
  });

  it("sinaliza baseline e semanas reconstruídas sem alterar o veredito", () => {
    const snapshots = [snap("2026-09-07", 5, RECONSTRUCTED_METHODOLOGY_VERSION), snap("2026-08-31", 5, RECONSTRUCTED_METHODOLOGY_VERSION)];
    const r = behaviorHabitsReading({ profile: profile(5), snapshots, today: "2026-10-01", thisWeek: "2026-09-28" });
    expect(r.reconstructedWeeks).toBe(2);
    expect(r.history.every((s) => s.week_start < "2026-09-28")).toBe(true);
    const degraded = behaviorHabitsReading({ profile: profile(5), snapshots, today: "2026-10-01", thisWeek: "2026-09-28", degraded: true });
    expect(degraded.baseline).toBeNull();
    expect(degraded.verdict.kind).toBe("insufficient");
  });

  it("payload vazio vira entrada vazia (nunca inventa dado)", () => {
    const input = observedInputFromDashboardPayload(null);
    expect(input.checkins).toEqual([]);
    expect(input.financialRow).toBeNull();
    expect(OBSERVED_SNAPSHOT_MIN_COVERAGE).toBe(3);
  });
});

describe("Entrega 2 — Nino/WhatsApp responde hábitos pelo motor", () => {
  const yes = ["como estão meus hábitos?", "meus hábitos melhoraram?", "como evoluiu meu comportamento financeiro?", "meu comportamento financeiro piorou?"];
  const no = ["quero criar um hábito de guardar dinheiro", "quanto gastei com alimentação?", "como estou financeiramente?", "registra um gasto de 30 no mercado"];
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  it.each(yes)("roteia '%s' para get_behavior_evolution determinístico", (text) => {
    expect(isBehaviorEvolutionQuestion(norm(text))).toBe(true);
    const cap = classifyCapability(text, interpret(text), null);
    expect(cap).toMatchObject({ name: "behavior_evolution", execution: "deterministic", required_tool: "get_behavior_evolution" });
    expect(resolveV2DeterministicReadCapability(text)?.name).toBe("behavior_evolution");
  });

  it.each(no)("não captura '%s'", (text) => {
    expect(resolveV2DeterministicReadCapability(text)).toBeNull();
  });

  it("está no registry como leitura no app e no WhatsApp", () => {
    const cap = CAPABILITIES.find((c) => c.tool === "get_behavior_evolution");
    expect(cap).toMatchObject({ writes: false, risk: "read_only" });
    expect(cap!.surfaces).toEqual(expect.arrayContaining(["app", "whatsapp"]));
  });

  it("o texto repete o veredito do motor, sem conclusão própria", () => {
    const reply = formatBehaviorEvolution({
      verdict: { kind: "better", headline: "Seus hábitos melhoraram", summary: "Comparado a 07/09." },
      changes: [{ label: "Controle", direction: "better", confidence: "medium", why: "metas cumpridas" }],
      baseline_reconstructed: true,
    });
    expect(reply).toContain("Seus hábitos melhoraram");
    expect(reply).toContain("Controle: metas cumpridas");
    expect(reply).toContain("histórico reconstruído (parcial)");
    expect(formatBehaviorEvolution({ verdict: { kind: "insufficient", headline: "Ainda cedo" } })).not.toContain("▲");
  });
});

describe("Entrega 2 — job semanal e banco", () => {
  it("job exige x-cron-secret e grava via runtime canônico com cobertura mínima", () => {
    expect(job).toContain("x-cron-secret");
    expect(job).toContain("saveWeeklyObservedSnapshot");
    expect(runtime).toContain("OBSERVED_SNAPSHOT_MIN_COVERAGE");
    expect(runtime).toContain('onConflict: "user_id,week_start"');
  });

  it("migration: posted, gastos com horário, helpers service_role-only e cron semanal", () => {
    expect(migration).not.toMatch(/status\s*=\s*'confirmed'/);
    expect(migration).toContain("'expense_transactions'");
    expect(migration).toContain("local_occurred_at");
    expect(migration).toMatch(/revoke all on function public\.behavior_observed_active_users[^;]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.behavior_observed_active_users[^;]*to service_role/i);
    expect(migration).toMatch(/security definer\s+set search_path = public/i);
    expect(migration).toContain("behavior-observed-weekly");
  });

  it("UI e tipos: aviso acessível de histórico reconstruído e sem cast any", () => {
    expect(parts).toContain('role="note"');
    expect(parts).toContain("Histórico reconstruído (parcial)");
    expect(parts).toContain("Leituras novas já são completas");
    expect(snapshotsHook).not.toContain("as any");
    expect(snapshotsHook).not.toContain("TODO");
  });
});
