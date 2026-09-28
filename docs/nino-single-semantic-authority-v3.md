# Nino V3 — Single Semantic Authority

## Objective

Make Nino intelligent and conversational without allowing an LLM to become the source of financial truth.

The architecture separates three responsibilities:

1. **Intelligence understands** natural language and conversation context.
2. **Deterministic runtime guarantees** permissions, calculations, dates, accounting invariants, confirmation and persistence.
3. **Evidence supports** every personal financial statement returned to the user.

## Production flow

```text
Inbound message
  -> Event Gate (protocol/state only)
  -> Context Builder
  -> Semantic Authority V3
       fast semantic model
       -> deep semantic tier when consequence/complexity requires it
       -> configured provider failover on infrastructure failure
  -> TurnSpecV3
  -> Semantic Invariants
  -> Grounding
  -> Capability Registry / Execution Plan
  -> deterministic domain engines / write workflows
  -> financial evidence
  -> Contract Fulfillment Gate
  -> human response + useful continuation
  -> semantic/evidence/workflow state reducers
```

## Event Gate boundary

The Event Gate may resolve only events whose meaning is established by existing state/protocol, for example:

- confirm/cancel an existing pending financial confirmation;
- WhatsApp redelivery/idempotency;
- explicit `!ja` fast-log format;
- structured bank notifications/documents;
- explicit callback/button events.

It must not decide the meaning of ordinary human financial language such as `quanto gastei`, `paguei essa dívida`, `mostra em gráfico`, `e no mês passado?`, etc.

## One language authority

When `runtime_v3_authority_v1` is enabled, `SemanticInterpreterV3 -> TurnSpecV3` is the only component allowed to interpret natural language.

No downstream regex/parser/router may replace that meaning. Validators can reject a contract; they cannot repair it into a different intent.

Legacy V2 remains only for users outside the V3 rollout and as rollback code. It is not a circuit breaker after an authoritative V3 interpretation.

## Model tiering is not semantic fallback

The fast and deep models emit the same strict TurnSpecV3 schema.

- Simple read/conversation: fast semantic tier can be sufficient.
- Writes, compound turns, advisory tasks and contextual references: deep semantic review is required.
- Consequential turns are executed only when semantic signatures agree.
- Write comparison includes action **and slot values**, not merely slot names.
- A provider/model failure moves to another configured tier/provider rather than repeatedly calling the same limited model.

This keeps availability concerns separate from language semantics.

## Grounding

The model understands expressions; deterministic code resolves them to reality.

Examples:

- `do dia 21 ao dia 27` -> concrete dates;
- `essa dívida` -> owned debt entity;
- `meu Itaú` -> owned account/card;
- `mês passado` -> concrete calendar period.

Memory can identify conversational referents but cannot manufacture financial facts.

## Execution

TurnSpec selects capability families, never physical functions.

```text
financial.query -> Financial IR
financial.write -> Write Workflow
 goals          -> Goal Engine
 advisory       -> Advisory Engine
```

Physical tool/RPC selection remains deterministic.

## Financial safety

The following remain deterministic:

- ownership/authorization;
- balances and accounting calculations;
- transaction/debt/goal invariants;
- idempotency and duplicate-delivery protection;
- confirmation for mutations;
- overpayment/invalid-value protection;
- persistence proof and reconciliation;
- concrete calendar/timezone resolution.

The LLM never writes directly to Supabase and never calculates authoritative money.

## Verification

There are three gates:

1. **Semantic invariants** — TurnSpec must be structurally coherent.
2. **Independent semantic review** — for consequential/complex turns, model tiers must agree.
3. **Contract fulfillment** — after execution, prove that executed scope/evidence still matches the requested contract.

Example: if the user asks for a read and a candidate plan becomes a write, the contract must not execute.

## Conversation continuity

The Context Builder supplies compact durable state:

- active topic;
- conversation summary;
- active category/merchant/period;
- pending continuation;
- pending workflow;
- active entity/evidence references;
- recent relevant history.

This allows natural turns such as `e no mês passado?`, `dela?`, `faz isso`, `agora em Lazer`, or `e quanto falta?` without encoding every wording in a regex database.

After a useful answer, Nino may offer one relevant next step. If the user accepts it, the pending continuation state carries the meaning into the next turn.

## Quality strategy

Do not optimize for memorized phrases. Production incidents become semantic properties/metamorphic evals.

Equivalent human phrasings should converge to the same semantic signature. Examples:

- `quanto gastei entre 21 e 27?`
- `me diz meus gastos do dia 21 ao 27`
- `semana passada, de 21 a 27, quanto saiu?`
- `quanto eu gastei semana passada do dia 21 ao dia 27?`

Expected semantics:

```text
family=financial.query
metric=expense_amount
operation=sum
period=<21..27>
```

Tests should measure semantic invariants, execution scope preservation, conversation continuity and write safety rather than grow a phrase-to-action rulebook.

## Migration rule

No new broad lexical semantic fast-paths are allowed. Existing lexical helpers may remain as legacy rollback utilities but must not be consulted before V3 for users under authoritative rollout.
