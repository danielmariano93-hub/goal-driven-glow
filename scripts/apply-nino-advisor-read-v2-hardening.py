from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))

# Small pre-existing type defects reached by the new canonical read fallback.
replace(
    "supabase/functions/_shared/agent/core/CapabilityRouter.ts",
    '    clarification: null,\n    reason: "canonical_spending_simulation_resumed",',
    '    clarification: undefined,\n    reason: "canonical_spending_simulation_resumed",',
)
replace(
    "supabase/functions/_shared/agent/tools.ts",
    '  const cat = await resolveCategoryId(ctx, explicitCategoryHint, args.type);',
    '  const cat = await resolveCategoryId(ctx, explicitCategoryHint, args.type as "income" | "expense");',
)
replace(
    "supabase/functions/_shared/agent/tools.ts",
    '    const m = (data ?? []).find(g => (g.name as string).toLowerCase().includes(h));',
    '    const m = (data ?? []).find((g: any) => (g.name as string).toLowerCase().includes(h));',
)

# Compiler understands the financial shape once. Dates for enumerated periods are
# bound later by the deterministic backend; multi-period is never a reason to
# throw away an otherwise executable metric/filter contract.
replace(
    "supabase/functions/_shared/agent/core/SemanticCompiler.ts",
    '- datas/períodos não aparecem no IR gerado pela LLM; o backend os anexa depois.`;',
    '- datas/períodos não aparecem no IR gerado pela LLM; o backend os anexa depois.\n- quando a mensagem mencionar dois ou mais períodos nomeados (ex.: julho e agosto), compile UMA VEZ a métrica, operação, filtros e dimensão pedida; NÃO marque unsupported só por haver vários períodos. O backend fará o fan-out temporal preservando esse mesmo contrato.`;',
)

# Give the single conversational authority a canonical example for a very common
# elliptical follow-up. It must reconstruct the complete request, not delegate to
# another router or leave “os dois” unresolved.
replace(
    "supabase/functions/_shared/agent/core/ConversationBrain.ts",
    '- usuário: "Quanto gastei em alimentação no mês de julho e agosto?" => new_request/read, focus.category="Alimentação", focus.period_expressions=["julho","agosto"].\n- usuário: "Não foi isso que eu pedi" => repair; preserve o foco anterior e corrija a interpretação, não cancele por conta própria.`;',
    '- usuário: "Quanto gastei em alimentação no mês de julho e agosto?" => new_request/read, focus.category="Alimentação", focus.period_expressions=["julho","agosto"].\n- após essa leitura, usuário: "e qual dos dois foi maior?" => follow_up/read, preserve Alimentação e os dois períodos; canonical_request deve explicitar "Compare os gastos de Alimentação de julho e agosto e diga qual foi maior", focus.period_expressions=["julho","agosto"].\n- usuário: "Não foi isso que eu pedi" => repair; preserve o foco anterior e corrija a interpretação, não cancele por conta própria.`;',
)

print("nino advisor-read v2 hardening applied")
