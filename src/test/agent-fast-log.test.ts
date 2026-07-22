// Cobre a detecção da palavra-mágica que registra sem confirmação.
// A execução completa depende do runtime Deno/Supabase e é exercitada
// integralmente pelos testes do orquestrador; aqui garantimos apenas a
// heurística pura de detecção do token.
import { describe, it, expect } from "vitest";

// Mirror da função pura em supabase/functions/_shared/agent/core/FastLog.ts.
// Duplicação intencional para manter o vitest fora do runtime Deno.
const DEFAULT = "!ja";
function escapeRx(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function detectFastLog(text: string, token = DEFAULT) {
  const tk = String(token ?? "").trim() || DEFAULT;
  const bare = tk.replace(/^[!#/]/, "");
  const alts = Array.from(new Set([tk, `!${bare}`, `#${bare}`, `/${bare}`]))
    .filter(Boolean).map(escapeRx).join("|");
  const rx = new RegExp(`(?:^\\s*(?:${alts})\\s+)|(?:\\s+(?:${alts})\\s*$)`, "i");
  if (!rx.test(text)) return { triggered: false, cleanText: text, token: tk };
  return { triggered: true, cleanText: text.replace(rx, " ").trim(), token: tk };
}

describe("FastLog — detecção da palavra-mágica", () => {
  it("aciona com prefixo !ja / #ja / /ja e remove o token", () => {
    for (const p of ["!ja", "#ja", "/ja", "!JA"]) {
      const r = detectFastLog(`${p} gastei 42,90 no almoço no Nubank`);
      expect(r.triggered).toBe(true);
      expect(r.cleanText).toBe("gastei 42,90 no almoço no Nubank");
    }
  });

  it("aciona com sufixo (mesmas variações)", () => {
    const r = detectFastLog("gastei 30 no bar #ja");
    expect(r.triggered).toBe(true);
    expect(r.cleanText).toBe("gastei 30 no bar");
  });

  it("não confunde tokens dentro da palavra (ex.: 'jaqueta')", () => {
    const r = detectFastLog("comprei uma jaqueta por 100 no cartão");
    expect(r.triggered).toBe(false);
  });

  it("respeita token custom mantendo os prefixos alternativos", () => {
    const r = detectFastLog("!go recebi 3000 salario", "!go");
    expect(r.triggered).toBe(true);
    expect(r.cleanText).toBe("recebi 3000 salario");
  });

  it("mensagem sem token não é acionada", () => {
    const r = detectFastLog("gastei 42 no mercado");
    expect(r.triggered).toBe(false);
    expect(r.cleanText).toBe("gastei 42 no mercado");
  });
});
