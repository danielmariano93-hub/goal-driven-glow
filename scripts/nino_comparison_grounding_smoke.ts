import { buildEvidenceClaims } from "../supabase/functions/_shared/agent/core/EvidenceClaims.ts";
import { groundReply } from "../supabase/functions/_shared/agent/core/GroundingGateV3.ts";
import { semanticBlockText } from "../supabase/functions/_shared/agent/core/SemanticAnswerFormatter.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ir = {
  period: { from: "2026-09-01", to: "2026-09-25", label: "setembro" },
  comparison_period: { from: "2026-08-07", to: "2026-08-31", label: "período anterior" },
} as any;

function verifyScenario(args: {
  name: string;
  totalA: number;
  totalB: number;
  deltaPct: number;
  expectedPctText: RegExp;
  expectedAbsence: RegExp;
}) {
  const deltaAbs = Number((args.totalB - args.totalA).toFixed(2));
  const result = {
    requested_group_by: "category",
    requested_comparison_direction: "both",
    requested_limit: null,
    total_a: args.totalA,
    total_b: args.totalB,
    delta_abs: deltaAbs,
    delta_pct: args.deltaPct,
    by_group: [
      {
        name: "Lazer",
        total_a: args.totalA,
        total_b: args.totalB,
        delta_abs: deltaAbs,
        delta_pct: args.deltaPct,
      },
    ],
    applied_reference_scope: { target: "category", entity_labels: ["Lazer"] },
    provenance: { formula_version: "compare.v1" },
  };

  const execution = {
    outcomes: [
      {
        query_id: "q1",
        engine: "compare_periods",
        status: "ok",
        result,
        args: {
          group_by: "category",
          category_scope: ["Lazer"],
          period_a: { from: "2026-08-07", to: "2026-08-31" },
          period_b: { from: "2026-09-01", to: "2026-09-25" },
        },
        duration_ms: 1,
        error: null,
      },
    ],
  } as any;

  const claims = buildEvidenceClaims(ir, execution);
  const percentageClaims = claims.claims
    .filter((claim) => claim.type === "percentage")
    .map((claim) => Number(claim.value));
  const expectedPct = Math.abs(args.deltaPct) * 100;
  assert(
    percentageClaims.some((value) => Math.abs(value - expectedPct) < 0.01),
    `${args.name}: comparison delta percentage missing from evidence: ${JSON.stringify(percentageClaims)}`,
  );

  const reply = semanticBlockText("compare_periods", result);
  assert(reply, `${args.name}: compare_periods formatter returned no reply`);
  assert(reply.includes("Lazer"), `${args.name}: reply lost category scope: ${reply}`);
  assert(args.expectedPctText.test(reply), `${args.name}: reply lost formatted delta percentage: ${reply}`);
  assert(args.expectedAbsence.test(reply), `${args.name}: reply lost canonical absence direction: ${reply}`);

  const grounding = groundReply({ reply, claims });
  assert(
    grounding.ok,
    `${args.name}: grounding rejected canonical comparison: reply=${JSON.stringify(reply)} violations=${JSON.stringify(grounding.violations)}`,
  );

  return { name: args.name, reply, percentageClaims, grounding: grounding.version };
}

const scenarios = [
  verifyScenario({
    name: "lazer_increase_no_decrease",
    totalA: 1208.43,
    totalB: 1345.88,
    deltaPct: 0.1137,
    expectedPctText: /11,4%/,
    expectedAbsence: /Diminuíram:\s*nenhuma/i,
  }),
  verifyScenario({
    name: "lazer_decrease_no_increase",
    totalA: 1345.88,
    totalB: 1208.43,
    deltaPct: -0.1021,
    expectedPctText: /10,2%/,
    expectedAbsence: /Aumentaram:\s*nenhuma/i,
  }),
];

console.log(JSON.stringify({ ok: true, scenarios }));
