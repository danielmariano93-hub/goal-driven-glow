// ResponseGenerator — formats the final user-facing text.
// Kept minimal for now: LLM path already returns a formed reply; the
// deterministic fallback still owns its own phrasing (kept in
// DeterministicFallback.ts). This module is the seam for future tone,
// signature or locale rules.
export function formatReply(raw: string): string {
  return String(raw ?? "");
}
