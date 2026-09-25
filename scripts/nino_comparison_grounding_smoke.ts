import { buildEvidenceClaims } from "../supabase/functions/_shared/agent/core/EvidenceClaims.ts";
import { groundReply } from "../supabase/functions/_shared/agent/core/GroundingGateV3.ts";
import { semanticBlockText } from "../supabase/functions/_shared/agent/core/SemanticAnswerFormatter.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const result = {
  requested_group_by: "category",
  requested_comparison_direction: "both",
  requested_limit: null,
  total_a: 1208.43,
  total_b: 1345.88,
  delta_abs: 137.45,
  delta_pct: 0.1137,
  by_group: [
    {
      name: "Lazer",
      total_a: 1208.43,
      total_b: 1345.88,
      delta_abs: 137.45,
      delta_pct: 0.1137,
    },
  ],
  applied_reference_scope: { target: "category", entity_labels: ["Lazer"] },
  provenance: { formula_version: "compare.v1" },
};

const ir = {
  period: { from: "2026-09-01", to: "2026-09-25", label: "setembro" },
  comparison_period: { from: "2026-08-07", to: "2026-08-31", label: "período anterior" },
} as any;

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
assert(
  percentageClaims.some((value) => Math.abs(value - 11.37) < 0.01),
  `comparison delta percentage missing from evidence: ${JSON.stringify(percentageClaims)}`,
);

const reply = semanticBlockText("compare_periods", result);
assert(reply, "compare_periods formatter returned no reply");
assert(reply.includes("Lazer"), `reply lost category scope: ${reply}`);
assert(/11,4%/.test(reply), `reply lost formatted delta percentage: ${reply}`);

const grounding = groundReply({ reply, claims });
assert(
  grounding.ok,
  `grounding rejected canonical comparison: ${JSON.stringify(grounding.violations)}`,
);

console.log(JSON.stringify({
  ok: true,
  scenario: "lazer_followup_comparison",
  reply,
  percentage_claims: percentageClaims,
  grounding: grounding.version,
}));
