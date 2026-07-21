// PersonalizationEngine — user preferences applied to the system prompt.
// Reads user_ai_preferences and can infer adjustments from memory (corrections).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recall } from "./MemoryStore.ts";

export type Preferences = {
  tone: "friendly" | "neutral" | "formal";
  verbosity: "concise" | "balanced" | "detailed";
  explanation_style: "plain" | "technical" | "storytelling";
  example_style: "concrete" | "abstract";
  suggestion_frequency: "low" | "medium" | "high";
  technical_level: "basic" | "intermediate" | "advanced";
};

export const DEFAULT_PREFS: Preferences = {
  tone: "friendly",
  verbosity: "balanced",
  explanation_style: "plain",
  example_style: "concrete",
  suggestion_frequency: "medium",
  technical_level: "basic",
};

export async function loadPreferences(sb: SupabaseClient, user_id: string): Promise<Preferences> {
  const { data } = await sb.from("user_ai_preferences").select("*").eq("user_id", user_id).maybeSingle();
  if (!data) return DEFAULT_PREFS;
  return { ...DEFAULT_PREFS, ...(data as any) } as Preferences;
}

export async function savePreferences(sb: SupabaseClient, user_id: string, patch: Partial<Preferences>): Promise<Preferences> {
  const current = await loadPreferences(sb, user_id);
  const next = { ...current, ...patch, user_id, updated_at: new Date().toISOString() };
  await sb.from("user_ai_preferences").upsert(next, { onConflict: "user_id" });
  return next;
}

export function applyPreferencesToPrompt(basePrompt: string, prefs: Preferences): string {
  const lines: string[] = [];
  lines.push("Personalização do usuário:");
  lines.push(`- Tom: ${labelTone(prefs.tone)}.`);
  lines.push(`- Verbosidade: ${labelVerbosity(prefs.verbosity)}.`);
  lines.push(`- Explicações: ${labelExplanation(prefs.explanation_style)}.`);
  lines.push(`- Exemplos: ${prefs.example_style === "concrete" ? "sempre concretos e numéricos" : "conceituais quando útil"}.`);
  lines.push(`- Sugestões proativas: ${labelFreq(prefs.suggestion_frequency)}.`);
  lines.push(`- Nível técnico: ${labelTech(prefs.technical_level)}.`);
  return basePrompt.trim() + "\n\n" + lines.join("\n");
}

export async function inferPreferencesFromMemory(sb: SupabaseClient, user_id: string): Promise<Partial<Preferences>> {
  const facts = await recall(sb, user_id, { kind: "response_preference", limit: 10 });
  const patch: Partial<Preferences> = {};
  for (const f of facts) {
    const v = f.value as any;
    if (v?.tone) patch.tone = v.tone;
    if (v?.verbosity) patch.verbosity = v.verbosity;
    if (v?.suggestion_frequency) patch.suggestion_frequency = v.suggestion_frequency;
    if (v?.technical_level) patch.technical_level = v.technical_level;
  }
  return patch;
}

function labelTone(t: Preferences["tone"]) { return t === "friendly" ? "acolhedor e humano" : t === "formal" ? "formal" : "neutro"; }
function labelVerbosity(v: Preferences["verbosity"]) { return v === "concise" ? "respostas curtas e diretas" : v === "detailed" ? "explicações detalhadas" : "equilibrado entre curto e detalhado"; }
function labelExplanation(e: Preferences["explanation_style"]) { return e === "technical" ? "técnicas e precisas" : e === "storytelling" ? "narrativas simples" : "linguagem simples e clara"; }
function labelFreq(f: Preferences["suggestion_frequency"]) { return f === "low" ? "raramente, só quando essencial" : f === "high" ? "com frequência" : "quando fizerem diferença"; }
function labelTech(l: Preferences["technical_level"]) { return l === "advanced" ? "avançado — pode usar jargão financeiro" : l === "intermediate" ? "intermediário" : "básico — evite jargão"; }
