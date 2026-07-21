// ResponseGenerator — formats the final user-facing text and applies
// personalization from `user_ai_preferences` (Fase 3).
import type { Preferences } from "./PersonalizationEngine.ts";
import { applyPreferencesToPrompt } from "./PersonalizationEngine.ts";

export function formatReply(raw: string): string {
  return String(raw ?? "");
}

/** Applies personalization to a base system prompt. Safe with defaults. */
export function personalizeSystemPrompt(base: string, prefs: Preferences | null | undefined): string {
  if (!prefs) return base;
  return applyPreferencesToPrompt(base, prefs);
}
