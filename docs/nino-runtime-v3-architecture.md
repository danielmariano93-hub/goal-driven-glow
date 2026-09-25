# Nino Runtime V3 — Single Canonical Semantics, Typed Execution

## Why V3 exists

Recent production incidents exposed a recurring class of failures rather than isolated prompt bugs:

- an explicit new category (`Lazer`) was overridden by inherited evidence (`Alimentação`);
- a factual goals request became `read + conversation + financial_read=null`, an internally contradictory state that reached the semantic compiler and failed closed;
- multiple modules can currently influence meaning (ConversationBrain, deterministic follow-up handlers, routers, planners and legacy fallbacks).

The V3 objective is not "a bigger brain". It is one canonical semantic representation per turn, followed only by deterministic validation, grounding, compilation and execution.

## Architectural invariants

1. **Interpret once.** After `TurnSpecV3` exists, downstream code cannot reinterpret the user's meaning.
2. **Illegal states are unrepresentable.** There is no independent `mode + domain + financial_read` combination.
3. **Explicit current-turn semantics outrank inherited context.** Memory can fill a missing slot; it cannot override an explicit slot.
4. **Temporal expressions are typed as periods.** `esse mês` can never become a category/entity reference.
5. **The model selects semantic families, never physical tools.** Tool binding is deterministic in the capability runtime.
6. **Memory is context, not financial truth.** Personal financial claims require an `EvidenceEnvelopeV3` produced by an executed engine.
7. **State is partitioned.** Semantic state, financial evidence state and workflow state commit independently according to their own success criteria.
8. **Validators may reject but never repair meaning.** If a semantic contract violates an invariant, retry/clarify; do not invoke another classifier to silently reinterpret it.
9. **Compound requests are first-class.** A single canonical interpretation can produce multiple typed tasks.
10. **Every production incident becomes a property/eval.** Prefer invariant/property tests over phrase-specific patches.

## Target flow

```text
Input
  -> Deterministic Event Gate (only unequivocal protocol/state events)
  -> Context Builder
  -> Semantic Interpreter
  -> TurnSpecV3
  -> Semantic Invariant Guard
  -> Grounding
  -> Capability/Task Plan
  -> Deterministic Domain Engines
  -> EvidenceEnvelopeV3[]
  -> Response Composer
  -> State Reducers (semantic / evidence / workflow)
```

### Deterministic Event Gate

Allowed to recognize protocol/state events such as pending-action confirmation, structured bank notification and explicit fast-log formats. It must not infer contextual meaning from loose lexical cues.

### Semantic Interpreter

The future authoritative interpreter emits strict structured `TurnSpecV3`. It does not execute tools or calculate financial values.

### TurnSpecV3

Discriminated union:

- `conversation`
- `clarification`
- `task`

`task` contains one or more typed semantic tasks:

- `financial.query`
- `goals`
- `advisory`
- `financial.write`

Slots carry provenance (`current_turn`, `quoted_turn`, `workflow`, `reference`, `memory`, `default`) and, where possible, the literal source span.

### Capability Registry

The registry maps semantic families to execution subsystems, not directly to prompt-selected function names:

- `financial.query -> financial_ir`
- `goals -> goal_engine`
- `advisory -> advisory_engine`
- `financial.write -> write_workflow`

Physical tool selection remains deterministic inside each subsystem.

### Evidence Envelope

Any personal financial statement must be backed by an evidence envelope containing at minimum:

- task index;
- capability family;
- execution source;
- executed scope;
- payload;
- formula version when applicable;
- execution timestamp;
- query fingerprint.

Conversation memory cannot substitute for execution evidence.

## State model

V3 separates three state classes:

### Semantic state

Topic, resolved entities and conversational focus. Can advance after a semantically valid interpretation even if a downstream data provider is temporarily unavailable, provided no financial fact is asserted.

### Evidence state

Executed financial/goal evidence. Advances only after successful engine execution and evidence validation.

### Workflow state

Pending writes, drafts and confirmations. Advances only according to explicit workflow events.

This avoids both extremes: failed calculations do not poison financial truth, while a transient data outage does not necessarily erase a correctly understood conversational topic.

## Migration strategy

### Phase 0 — Freeze semantic patch proliferation

Only P0 safety fixes on V2. No new broad lexical router or ad-hoc classifier should become another semantic authority.

### Phase 1 — Foundation (this branch)

- `TurnSpecV3` discriminated union;
- provenance-aware slots;
- deterministic semantic invariants;
- stable capability-family registry;
- `EvidenceEnvelopeV3`;
- V2 -> V3 side-effect-free shadow adapter/evaluator;
- incident/property tests.

No production routing change.

### Phase 2 — Shadow telemetry

Add a disabled-by-default rollout flag and persist shadow results for real turns. Initially reuse the V2 canonical contract to detect structural gaps cheaply; then introduce the strict V3 interpreter in shadow.

Measure:

- V2 contracts rejected by V3 invariants;
- family/subsystem mapping coverage;
- explicit-slot vs inherited-context conflicts;
- unsupported task combinations;
- divergence between V2 execution and V3 plan.

### Phase 3 — Strict authoritative interpreter in shadow

Use strict structured outputs. Syntax validity is necessary but not sufficient: semantic invariants remain mandatory.

Run historical replay first, then sampled/temporary 100% shadow according to cost.

### Phase 4 — Canary execution

5% -> 10% -> 25% -> 50% -> 100%, with automatic rollback gates on structural invariants and production error rates.

### Phase 5 — Remove competing semantic authorities

Legacy routers/parsers may remain as deterministic utilities but lose authority to decide user meaning. Delete or demote overlapping semantic paths after V3 reaches stable 100%.

## Required quality gates before authoritative rollout

- invalid structured contract: 0%;
- supported capability ending in `compiler_failed`: 0%;
- explicit current-turn entity overridden by memory: 0%;
- temporal expression used as entity reference: 0%;
- personal financial claim without valid evidence: 0%;
- task/tool mismatch after capability compilation: 0%;
- critical conversation goldens: 100%;
- broad generated/metamorphic semantic suite: >= 99% target, with zero P0 invariant violations.

## What V3 deliberately reuses

V3 does **not** rebuild the entire product. It reuses canonical financial engines, Supabase data, WhatsApp transport, write workflows, calculations and existing domain tools wherever they already represent financial truth correctly. The main replacement is the path from natural language -> canonical meaning -> typed execution plan.
