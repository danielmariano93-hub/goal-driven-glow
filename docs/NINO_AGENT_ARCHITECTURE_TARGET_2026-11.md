# Nino — Target AI architecture and evidence-based rollout
Status: ADR proposal — 2026-11-24

## Observed production evidence (not assumptions)

- PR #464 changed comparison-window normalization, passed full CI and deployed.
- Post-release canary `ba0477fa-a4ee-467e-84d7-8a245e39ebba`: 14 synthetic conversations, 11 labeled CORRECT, 3 WRONG.
- A response comparing **October 1–31** to **November 1–24** was labeled CORRECT because the grader checked monetary values only. The actual executed `compare_periods` arguments must be graded.
- PR #465 reverted #464. Do **not** reapply the same repair in production without a stronger independent evaluator.

## External engineering references (methodology, not drop-in frameworks)

1. Anthropic [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents): use the simplest sufficient orchestration, separate predictable workflows from discretionary planning.
2. OpenAI [Agent Evals](https://developers.openai.com/api/docs/guides/agent-evals): grade complete trajectories, tool calls, final answer and controlled datasets.
3. NVIDIA [NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails): typed tool I/O checks and policy gates; conceptual reference. **Do not install an entire Python stack** in Deno Edge Functions merely for this.
4. Sierra [tau-bench](https://github.com/sierra-research/tau2-bench): assess multi-turn tool agents with final-state oracles and multiple repetitions.
5. Berkeley [BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html): evaluate tool selection and arguments, not only response fluency.
6. [Agent Skills specification](https://github.com/agentskills/agentskills) and [NVIDIA nat-evaluation](https://github.com/NVIDIA/NeMo-Agent-Toolkit/tree/develop/skills/nat-evaluation): reference for repository-local engineering skills and reproducible evaluation.

## Target architecture

```text
Input/channel
  -> authenticated event + state + context snapshot
  -> one semantic authority: TurnSpecV3 (intent, source spans, entity refs, time scope)
  -> independent deterministic grounding (typed, immutable execution spec)
  -> policy/permission and transaction gate
  -> one capability registry and deterministic execution
  -> structured evidence (source-of-truth data and actual tool-call arguments)
  -> independent fulfillment verification (original request + TurnSpec + executed spec + observed state)
  -> grounded user-facing response / safe clarification
  -> versioned event trace and memory state update
```

No free-form language parser downstream is allowed to silently replace an already approved intent. No financial answer is trustworthy solely because the model's contract agrees with its own execution; independent domain invariants must verify the operation. Time resolution must be singular and pure, with explicit semantics for complete vs partial months, comparisons, timezone, posting and competence.

## Non-negotiable migration rules

- Preserve established financial ledgers, calculators, bill-payment confirmations, RLS and idempotency. No wholesale runtime rewrite.
- Instrument the baseline first: exact tools and arguments, execution outcomes, date windows, persisted state, latency, cost, provider and model.
- Grade hard financial correctness and safety separately from answer helpfulness. An unobserved execution is UNVERIFIED, never CORRECT.
- Add family-based and property-based cases for month arithmetic, paraphrases, typos, missing context, independent model fallbacks, follow-ups, card vs cash and write workflows.
- Held-out evals must not be used as code templates; new failures require general rules and tests on previously unseen wording.
- Shadow execution (non-mutating), matched cohort A/B, canary then rollout. Roll back by flag/deploy on any independently verified critical financial error.
- Measure false-positive evaluator rate, end-to-end correct rate, wrong-answer rate, unnecessary clarification rate, tool-argument accuracy, latency p95 and cost per resolved request.
- User-visible improvements must come from accurate scope summaries, grounded follow-ups and useful explanations. Avoid exposing system internals or inflating prose.

## Release gates

1. CI: all existing test suites, types, build, security boundary and write workflow regressions green.
2. Semantic: no new hard failures in the held-out set; invariant tests across calendar/year boundaries.
3. Live synthetic canary: compare executed arguments, output AND data state against independent oracle; 0 observed critical financial errors in the full agreed canary set (no claim of universal error-free behavior).
4. Manual adversarial review of any UNVERIFIED, miss or inconsistency, including model-provider degradation.
5. Metrics documented and reproducible, release/rollback and production deployment receipts linked to exact SHA.

## Phases

- **A — Measurement (this PR)**: attach actual tool traces to synthetic evaluations; assert temporal windows for P01/P02/P07; prevent money-only false positives.
- **B — Single canonical TemporalSpec**: move from heuristic V2 guards to a typed, immutable V3 grounding policy, with no hidden period mutation. Validate against independent oracle.
- **C — Contract fulfillment**: compare requested intent and executed tool arguments and verify evidence/currency provenance. Fail closed on mismatches.
- **D — Orchestration consolidation**: remove the V3-to-V2 compatibility paths capability by capability after proving equivalence, keeping write safety.
- **E — Quality and UX**: model benchmarks for PT-BR, voice/WhatsApp, coherent clarifications, personalized but strictly grounded explanations and transparent scope.

### Definition of done for the full architecture

All in-scope agent capabilities use one semantic contract; no competing meaning resolvers remain on the supported path; a bad execution window fails before an incorrect answer; end-to-end regression and synthetic evaluation results are reported at exact deployment SHA; rollout can be reversed without financial data loss.
