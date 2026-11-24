---
name: nino-agent-reliability
description: Use when changing Nino's AI interpretation, agent orchestration, temporal scopes, financial tool calls, memory, follow-ups, guardrails, synthetic evaluations or production rollout. Require evidence-backed tests before merging and deploying.
---

# Nino Agent Reliability

Read `docs/NINO_AGENT_ARCHITECTURE_TARGET_2026-11.md`, `docs/nino-single-semantic-authority-v3.md`, and `docs/GUIA_DESENVOLVIMENTO_NINO.md` first.

## Development protocol

1. Identify the authoritative semantic contract for the capability. Trace one real anonymized or synthetic message through TurnSpecV3, temporal grounding, bridges, execution arguments, evidence, fulfillment and final reply. Never infer the active path from file names alone.
2. Establish a baseline **before** changing runtime behavior: fixed synthetic persona, date, exact prompt, expected figures, expected temporal windows, actual tool arguments, final reply, provider path and deployed SHA.
3. Classify the failure at the earliest failing boundary: interpretation, grounding, compilation, capability selection, tool argument, financial calculation, evidence validation, composition or delivery.
4. Design a general invariant; do not add a regex for a single user phrase. Keep determinism for accounting, temporal algebra, permissions and idempotent writes. An LLM may interpret intent but cannot invent financial data.
5. Add independent evaluation assertions that can fail even when the model, planner and executor are self-consistent. For comparison questions verify **executed** date windows, not only matching currency tokens.
6. Run focused contract/invariant tests, the existing full regression suite, type checks and build. Test at least one genuine opposite case: full-month request must not become same-days.
7. Deploy behind reversible stages: isolated branch -> PR -> green CI -> sandbox or shadow -> controlled canary -> broad rollout. Do not merge on code-only test pass if a live synthetic canary still shows critical errors.
8. Evaluate complete trajectories and final state: `CORRECT`, `MISS`, `WRONG`, `INFRA`, `UNVERIFIED`. Unknown tool traces are not proof of correctness.
9. Capture latency, model/provider availability, cost and response usefulness independently from hard financial correctness.
10. Report exactly what was changed, tests executed, canary sample/result, active deployment SHA and any remaining risk. Never claim universal zero-error guarantees.

## Release stop conditions

- A money result uses the wrong date window, currency, account or card semantics.
- The agent performs a mutation without required user authorization.
- A scenario marked CORRECT has no evidence of its demanded execution.
- A previously supported capability regresses without an explicitly reviewed rollback plan.
- Production and source commit versions cannot be reconciled.

## References

- OpenAI: https://developers.openai.com/api/docs/guides/agent-evals
- Anthropic: https://www.anthropic.com/research/building-effective-agents
- NVIDIA: https://github.com/NVIDIA/NeMo-Agent-Toolkit/tree/develop/skills/nat-evaluation
- Agent Skills standard: https://github.com/agentskills/agentskills

These references inform methodology; they do not require replacing the Nino stack or installing external agents.
