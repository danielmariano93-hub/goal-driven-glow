from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, repl: str, flags: int = 0) -> None:
    text = read(path)
    updated, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"expected one regex match in {path}, got {count}: {pattern[:100]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# category-engine: AI SDK adapter now resolves the configured provider.
# ---------------------------------------------------------------------------
p = "supabase/functions/category-engine/index.ts"
replace_once(
    p,
    'import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";',
    'import { createAiGatewayProvider, normalizeAiModel, resolveAiProvider } from "../_shared/ai-gateway.ts";',
)
replace_once(p, 'const LOVABLE_API_KEY=Deno.env.get("LOVABLE_API_KEY")??"";\n', '')
replace_once(
    p,
    '  if(!entries.length)return results;\n  if(!LOVABLE_API_KEY){deferEntries(entries,"ai_unconfigured");return results;}\n  if(await getAiBlock(admin)){deferEntries(entries,"ai_circuit_blocked");return results;}',
    '  if(!entries.length)return results;\n  const provider=resolveAiProvider();\n  if(!provider){deferEntries(entries,"ai_unconfigured");return results;}\n  const aiModel=normalizeAiModel(MODEL,provider);\n  if(await getAiBlock(admin)){deferEntries(entries,"ai_circuit_blocked");return results;}',
)
replace_once(
    p,
    '    const gateway=createLovableAiGatewayProvider(LOVABLE_API_KEY);\n    const generation=streamText({model:gateway(MODEL),',
    '    const gateway=createAiGatewayProvider(provider);\n    const generation=streamText({model:gateway(aiModel),',
)
# Cache/ledger must describe the model that actually ran.
text = read(p)
text = text.replace('model:MODEL,input_tokens:tokensIn,output_tokens:tokensOut,estimated_cost_usd:estimateAiCostUsd(MODEL,tokensIn,tokensOut)',
                    'model:aiModel,input_tokens:tokensIn,output_tokens:tokensOut,estimated_cost_usd:estimateAiCostUsd(aiModel,tokensIn,tokensOut)')
text = text.replace('user_id:userId,model:MODEL,operation_type:"structured_classification",input_tokens:tokensIn,output_tokens:tokensOut,success,',
                    'user_id:userId,model:aiModel,provider:provider.provider,operation_type:"structured_classification",input_tokens:tokensIn,output_tokens:tokensOut,success,')
write(p, text)


# ---------------------------------------------------------------------------
# insights-generate: provider-neutral chat completion.
# ---------------------------------------------------------------------------
p = "supabase/functions/insights-generate/index.ts"
replace_once(
    p,
    'import { recordGatewayCall } from "../_shared/aiUsageLedger.ts";\n',
    'import { recordGatewayCall } from "../_shared/aiUsageLedger.ts";\nimport { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../_shared/ai-runtime.ts";\n',
)
replace_once(p, 'const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";\n', '')
replace_once(
    p,
    'async function runForUser(supa: SupabaseClient, uid: string, force: boolean): Promise<RunResult> {\n  const aiBlocked = await getAiBlock(supa);',
    'async function runForUser(supa: SupabaseClient, uid: string, force: boolean): Promise<RunResult> {\n  const aiBlocked = await getAiBlock(supa);\n  const aiProvider = resolveAiProvider();\n  const aiModel = aiProvider ? normalizeAiModel(MODEL, aiProvider) : MODEL;',
)
replace_once(
    p,
    '    const allowAi = !!LOVABLE_API_KEY && !aiBlocked && chosen.family !== "categorizacao" && slot === 0;',
    '    const allowAi = !!aiProvider && !aiBlocked && chosen.family !== "categorizacao" && slot === 0;',
)
replace_once(
    p,
    '        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {\n          method: "POST",\n          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },',
    '        const resp = await fetch(aiEndpoint(aiProvider!, "chat/completions"), {\n          method: "POST",\n          headers: aiJsonHeaders(aiProvider!),',
)
replace_once(p, '            model: MODEL,\n            // Redação curta', '            model: aiModel,\n            // Redação curta')
replace_once(p, '            reasoning_effort: "none",', '            reasoning_effort: aiProvider?.provider === "groq" && aiModel.includes("gpt-oss") ? "low" : "none",')
text = read(p)
text = text.replace('user_id: uid, model: MODEL, operation_type: "chat", success: false,',
                    'user_id: uid, model: aiModel, provider: aiProvider!.provider, operation_type: "chat", success: false,')
text = text.replace('user_id: uid, model: MODEL, operation_type: "chat", success: true,',
                    'user_id: uid, model: aiModel, provider: aiProvider!.provider, operation_type: "chat", success: true,')
text = text.replace('user_id: uid, model: MODEL, operation_type: "chat", success: false,\n          error_code: "network_error"',
                    'user_id: uid, model: aiModel, provider: aiProvider?.provider ?? "unknown", operation_type: "chat", success: false,\n          error_code: "network_error"')
text = text.replace('model: MODEL,\n            };', 'model: aiModel,\n            };')
text = text.replace('fallbackReason = LOVABLE_API_KEY ? "deterministic_only" : "no_api_key";',
                    'fallbackReason = aiProvider ? "deterministic_only" : "no_api_provider";')
write(p, text)


# ---------------------------------------------------------------------------
# financial-reports-generate: provider-neutral narrative synthesis.
# ---------------------------------------------------------------------------
p = "supabase/functions/financial-reports-generate/index.ts"
replace_once(
    p,
    'import { recordGatewayCall } from "../_shared/aiUsageLedger.ts";\n',
    'import { recordGatewayCall } from "../_shared/aiUsageLedger.ts";\nimport { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../_shared/ai-runtime.ts";\n',
)
replace_once(p, 'const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";\n', '')
replace_once(p, '/** Texto do relatório via Lovable AI Gateway, validado pelo guardrail. */', '/** Texto do relatório via provedor de IA configurado, validado pelo guardrail. */')
replace_once(
    p,
    '  if (!LOVABLE_API_KEY) return { ...deterministic, fallbackReason: "missing_api_key" };\n  if (await getAiBlock(sb)) return { ...deterministic, fallbackReason: "ai_circuit_paused" };',
    '  const provider = resolveAiProvider();\n  if (!provider) return { ...deterministic, fallbackReason: "missing_ai_provider" };\n  const aiModel = normalizeAiModel(MODEL, provider);\n  if (await getAiBlock(sb)) return { ...deterministic, fallbackReason: "ai_circuit_paused" };',
)
replace_once(p, '    operation: "synthesize_narrative", user_id: userId, model: MODEL,\n    operation_type: "chat",',
             '    operation: "synthesize_narrative", user_id: userId, model: aiModel, provider: provider.provider,\n    operation_type: "chat",')
replace_once(
    p,
    '    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {\n      method: "POST",\n      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },',
    '    const res = await fetch(aiEndpoint(provider, "chat/completions"), {\n      method: "POST",\n      headers: aiJsonHeaders(provider),',
)
replace_once(p, '        model: MODEL,\n        reasoning_effort: "none",',
             '        model: aiModel,\n        reasoning_effort: provider.provider === "groq" && aiModel.includes("gpt-oss") ? "low" : "none",')
write(p, read(p))


# ---------------------------------------------------------------------------
# assistant-ingest-document: text/image extraction through configured provider.
# Scanned PDFs without a text layer no longer fall through to a proprietary PDF
# gateway. They fail explicitly so no hidden provider/billing dependency remains.
# ---------------------------------------------------------------------------
p = "supabase/functions/assistant-ingest-document/index.ts"
replace_once(
    p,
    'import { recordAiUsage, estimateAiCostUsd } from "../_shared/aiUsageLedger.ts";\n',
    'import { recordAiUsage, estimateAiCostUsd } from "../_shared/aiUsageLedger.ts";\nimport { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../_shared/ai-runtime.ts";\n',
)
replace_once(p, 'const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";\n', '')
replace_once(
    p,
    '    if (!LOVABLE_API_KEY) {\n      errorCode = "gateway_no_api_key";\n      return { result: { document_kind: "unknown", items: [], notes: "gateway_no_api_key" }, statement: null, invoice: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, has_more: false, partial: false, errorTag: "gateway:no_api_key" };\n    }',
    '    const provider = resolveAiProvider();\n    if (!provider) {\n      errorCode = "gateway_no_api_provider";\n      return { result: { document_kind: "unknown", items: [], notes: "gateway_no_api_provider" }, statement: null, invoice: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, has_more: false, partial: false, errorTag: "gateway:no_api_provider" };\n    }\n    const aiModel = normalizeAiModel(model, provider);\n    if (!textContent && mimeType === "application/pdf") {\n      errorCode = "scanned_pdf_ocr_unavailable";\n      return { result: { document_kind: "unknown", items: [], notes: "PDF sem camada de texto requer OCR de páginas" }, statement: null, invoice: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, has_more: false, partial: false, errorTag: "extraction:scanned_pdf_ocr_unavailable" };\n    }',
)
replace_once(p, '      model,\n      messages:', '      model: aiModel,\n      messages:')
replace_once(
    p,
    '    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {\n      method: "POST",\n      headers: {\n        "Content-Type": "application/json",\n        "Lovable-API-Key": LOVABLE_API_KEY,\n        "X-Lovable-AIG-SDK": "edge-function",\n      },',
    '    const res = await fetch(aiEndpoint(provider, "chat/completions"), {\n      method: "POST",\n      headers: aiJsonHeaders(provider),',
)
# Ledger is written in finally; resolve the provider again there so it remains in scope.
text = read(p)
text = text.replace('user_id: ctx.userId, run_id: ctx.documentId, model, operation_type: textContent ? "document_text" : "vision",\n      input_tokens:',
                    'user_id: ctx.userId, run_id: ctx.documentId, model: normalizeAiModel(model, resolveAiProvider() ?? { provider: "groq", baseUrl: "", apiKey: "", headers: {}, modelOverride: model }), provider: resolveAiProvider()?.provider ?? "unknown", operation_type: textContent ? "document_text" : "vision",\n      input_tokens:')
write(p, text)


# ---------------------------------------------------------------------------
# WhatsApp audio: Groq Whisper endpoint, non-streaming JSON response.
# ---------------------------------------------------------------------------
p = "supabase/functions/_shared/messaging/wahaMedia.ts"
replace_once(
    p,
    'const TRANSCRIPTION_GATEWAY = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";\nconst TRANSCRIPTION_MODEL = "openai/gpt-4o-transcribe";',
    'const GROQ_BASE_URL = (Deno.env.get("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\\/+$/, "");\nconst TRANSCRIPTION_GATEWAY = `${GROQ_BASE_URL}/audio/transcriptions`;\nconst TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";',
)
replace_once(p, '  const key = Deno.env.get("LOVABLE_API_KEY");', '  const key = Deno.env.get("GROQ_API_KEY");')
replace_once(p, '    form.append("stream", "true");', '    form.append("response_format", "json");\n    form.append("language", "pt");')
replace_once(
    p,
    '      headers: {\n        Authorization: `Bearer ${key}`,\n        "X-Lovable-AIG-SDK": "edge-function",\n      },',
    '      headers: { Authorization: `Bearer ${key}` },',
)
replace_once(p, '      model: TRANSCRIPTION_MODEL, operation_type: "transcription",',
             '      model: TRANSCRIPTION_MODEL, provider: "groq", operation_type: "transcription",')
replace_once(
    p,
    '    const text = await readTranscriptionStream(resp);\n    await logUsage(true, 200, null, args.bytes.length);',
    '    const payload = await resp.json().catch(() => null) as { text?: string } | null;\n    const text = String(payload?.text ?? "").trim();\n    await logUsage(true, 200, null, args.bytes.length);',
)
write(p, read(p))


# ---------------------------------------------------------------------------
# NarrativeComposer already uses ai-runtime; make telemetry provider truthful.
# ---------------------------------------------------------------------------
p = "supabase/functions/_shared/agent/narrative/NarrativeComposer.ts"
text = read(p)
text = text.replace('model: NARRATIVE_MODEL,\n        operation_type: "chat",',
                    'model: normalizeAiModel(NARRATIVE_MODEL, provider),\n        provider: provider.provider,\n        operation_type: "chat",')
text = text.replace('model: NARRATIVE_MODEL,\n    operation_type: "chat",',
                    'model: normalizeAiModel(NARRATIVE_MODEL, provider),\n    provider: provider.provider,\n    operation_type: "chat",')
write(p, text)


# ---------------------------------------------------------------------------
# Final safety gate: no live application source may call/read Lovable AI.
# Historical .lovable patches are intentionally outside this check.
# ---------------------------------------------------------------------------
for path in Path("supabase/functions").rglob("*.ts"):
    source = path.read_text(encoding="utf-8")
    if "ai.gateway.lovable.dev" in source or 'Deno.env.get("LOVABLE_API_KEY")' in source or "createLovableAiGatewayProvider" in source:
        raise SystemExit(f"Lovable AI runtime residue remains: {path}")

print("Nino AI provider cutover codemod completed successfully")
