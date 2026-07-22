// Cobre a detecção da palavra-mágica que registra sem confirmação.
// A execução completa depende do runtime Deno/Supabase e é exercitada
// integralmente pelos testes do orquestrador; aqui garantimos apenas a
// heurística pura de detecção do token.
import { describe, it, expect } from "vitest";

// Mirror da função pura em supabase/functions/_shared/agent/core/FastLog.ts.
// Duplicação intencional para manter o vitest fora do runtime Deno.
const DEFAULT = "!ja";
const RESERVED = new Set(["ja","sim","nao","não","ok","pode","confirma","confirmar","confirmado","cancela","cancelar","registra","registrar","registro","gasto","gastei","conta","paguei","comprei","recebi"]);
function escapeRx(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isValidFastLogToken(tk: unknown): boolean {
  const s = String(tk ?? "").trim();
  if (!/^[!#/][A-Za-z0-9]{2,12}$/.test(s)) return false;
  const bare = s.slice(1).toLowerCase();
  if (RESERVED.has(bare)) return false;
  if (/^\d+[a-z]?$/.test(bare)) return false;
  return true;
}
function detectFastLog(text: string, token = DEFAULT) {
  const raw = String(text ?? "");
  const rawTk = String(token ?? "").trim();
  const tk = isValidFastLogToken(rawTk) ? rawTk : DEFAULT;
  const bare = tk.replace(/^[!#/]/, "");
  const alts = Array.from(new Set([tk, `!${bare}`, `#${bare}`, `/${bare}`]))
    .filter(Boolean).map(escapeRx).join("|");
  const rx = new RegExp(`(?:^\\s*(?:${alts})\\s+)|(?:\\s+(?:${alts})\\s*$)`, "i");
  if (!rx.test(raw)) return { triggered: false, cleanText: raw, token: tk };
  return { triggered: true, cleanText: raw.replace(rx, " ").trim(), token: tk };
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

  it("respeita token custom válido", () => {
    const r = detectFastLog("!go recebi 3000 salario", "!go");
    expect(r.triggered).toBe(true);
    expect(r.cleanText).toBe("recebi 3000 salario");
  });

  it("mensagem sem token não é acionada", () => {
    const r = detectFastLog("gastei 42 no mercado");
    expect(r.triggered).toBe(false);
    expect(r.cleanText).toBe("gastei 42 no mercado");
  });

  it("token inválido (ex.: '1908A' herdado do WhatsApp) é ignorado e cai no default", () => {
    // Não deve disparar mesmo aparecendo literalmente na mensagem.
    const r = detectFastLog("1908A comprei um cafe", "1908A");
    expect(r.triggered).toBe(false);
  });

  it("valida regras de token (prefixo obrigatório, sem palavras reservadas, sem números puros)", () => {
    expect(isValidFastLogToken("!ja")).toBe(true);
    expect(isValidFastLogToken("#grava")).toBe(true);
    expect(isValidFastLogToken("/go")).toBe(true);
    expect(isValidFastLogToken("ja")).toBe(false);          // sem prefixo
    expect(isValidFastLogToken("!sim")).toBe(false);        // reservado
    expect(isValidFastLogToken("!1908A")).toBe(false);      // número + letra
    expect(isValidFastLogToken("1908A")).toBe(false);       // sem prefixo + numérico
    expect(isValidFastLogToken("!ab cd")).toBe(false);      // espaço
    expect(isValidFastLogToken("")).toBe(false);
  });
});

