# Nino — Human Conversation v1

## Objective

Keep V3's guarantees (one semantic authority, deterministic money, evidence for
every personal fact) and add what made Nino sound like a report instead of an
advisor: a voice, reasoning over the user's own numbers, compound requests and
memory of the relationship.

## Flow

```text
Inbound
  -> Event Gate
  -> Semantic Authority V3 (TurnSpecV3, now with scenario/decision/projection)
  -> Plan bridge (compound turns: write -> facts -> projection -> advice)
  -> per step: write workflow | Financial IR | Advisor Reasoning | legacy advisory
  -> merged deterministic body + evidence
  -> Conversational Composer (voice) --guard--> reply | deterministic body
  -> relationship notes -> agent_memory (kind=context, key=life:*)
```

## Components

| Module | Responsibility |
|---|---|
| `v3/ConversationalComposerV3.ts` | Writes the reply from the deterministic body + evidence + history + relationship memory. A guard rejects any money/percent/date not in evidence or the user's words, internal/provider leaks, moral judgement and claims of unperformed actions. Factual answers must keep the answering number; advice must cite at least one computed amount. Any failure returns the deterministic body. Model chain: primary, then fast tier on 429/413/5xx (per-model quotas). |
| `v3/AdvisorReasoningV3.ts` | `scenario` (cut a category, save more, purchase, income change) computed deterministically with goal impact; `decision` gathers snapshot, debts and goal as evidence for the composer to weigh; `goal_projection` from observed pace. Hypotheses are never writes. |
| `v3/V3RuntimeBridge.ts` → `bridgeTurnSpecV3ToRuntimePlan` | Partitions one TurnSpec into executable steps. Single-family turns are bridged exactly as before. |
| `core/AgentCoreV2.ts` | `executeContract` per step, `mergeExecutions`, composition, memory persistence, `llm_calls` telemetry. Drafts/receipts stay verbatim. |

## Safety rules kept

- The composer never sees the database or tools and never calculates.
- Writes still require tier agreement; a read-only tier disagreement uses the deep interpretation and still passes grounding + contract fulfillment.
- The closed compiler only runs as provider-failure recovery under `v3_first_authority_v1`, only for literally named categories and single-request messages.
- Relationship memory drops numbers and sensitive topics.

## Rollout flags

`conversational_composer_v1`, `relationship_memory_v1`, `compound_turns_v1`,
`advisor_reasoning_v1`, `v3_first_authority_v1` (all `agent_runtime_flags`,
per-user pilots or percentage).

## Human E2E

`scripts/e2e/nino-human-conversation.mjs` drives scripted conversations through
the harness template in `scripts/e2e/` and scores mechanical rubric checks;
tone is judged on the saved transcript.

## Semantic tiering (2026-09-29)

Measured on the production account with the same 10 real sentences:

| Model | Valid TurnSpec | Avg latency |
|---|---|---|
| openai/gpt-oss-120b | 10/10 | ~0.9 s |
| qwen/qwen3.8-27b | 10/10 | ~0.7 s |
| qwen/qwen3.6-27b | 9/10 | ~1.8 s |
| openai/gpt-oss-20b | 6/10 | ~0.6 s |

In live traffic gpt-oss-20b violated the strict schema in >60% of turns, so the
old fast→deep order mostly paid for a failed call before the real one.

- **Primary interpreter:** `NINO_SEMANTIC_PRIMARY_MODEL` (default `NINO_AI_MODEL`, gpt-oss-120b).
- **Independent reviewer / fallback:** `NINO_SEMANTIC_REVIEW_MODEL` (default qwen3.8-27b, a different model family).
- The reviewer runs speculatively in parallel (`NINO_SEMANTIC_SPECULATIVE_REVIEW=false` disables it): consequential turns wait max(primary, review) and a primary failure has its fallback ready.
- Writes execute only when both readings agree; a reviewer that cannot produce a valid contract is not evidence against the primary (`primary_unreviewed`), and the draft still requires user confirmation. Read-only disagreement uses the primary reading.
- Task order is ignored when comparing readings.
- The composer falls back to the reviewer model on capacity errors.
- The advisor pre-computes trade-off arithmetic (`derived`) so the composer never needs to calculate.
