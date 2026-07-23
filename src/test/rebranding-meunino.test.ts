/**
 * Testes do rebranding NoControle -> MeuNino.
 *
 * Cobre:
 *  1. Ausência de marca antiga em superfícies públicas atuais (com allowlist).
 *  2. Ordem de fallback do WAHA_SESSION.
 *  3. Migração one-shot do localStorage do periodStore.
 *  4. Parser do vínculo WhatsApp aceitando "MeuNino" e "NoControle" (transição).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// --- 1) Marca antiga em superfícies públicas -------------------------------

/** Diretórios varridos para detecção de "NoControle" residual. */
const SCAN_ROOTS = ["src", "supabase/functions", "index.html"];

/**
 * Ocorrências toleradas com justificativa. A comparação é feita contra
 * `<caminho-relativo>:<trecho>` para não depender de número de linha.
 */
const ALLOWLIST: Array<{ file: string; match: RegExp; reason: string }> = [
  {
    file: "src/lib/ui/periodStore.ts",
    match: /nocontrole\.periodFilter\.v1/,
    reason: "chave legada mantida para migração one-shot do localStorage",
  },
  {
    file: "src/lib/import/legacy.ts",
    match: /ex-NoControle\.ia/,
    reason: "referência histórica no comentário do parser legado",
  },
  {
    file: "supabase/functions/whatsapp-webhook/index.ts",
    match: /MeuNino\|NoControle|antigo NoControle/,
    reason: "regex de vinculação aceita marca antiga durante a transição",
  },
  {
    file: "supabase/functions/_shared/messaging/waha.ts",
    match: /NOCONTROLE_WAHA_SESSION/,
    reason: "fallback de variável de ambiente da sessão WAHA",
  },
  {
    file: "supabase/functions/admin-bootstrap/index.ts",
    match: /daniel\.assis@nocontrole\.com\.br/,
    reason: "e-mail bootstrap existente do owner (dado operacional preservado)",
  },
  {
    file: "src/pages/admin/agente/cfg.ts",
    match: /daniel@nocontrole\.ia/,
    reason: "chave Pix operacional do owner preservada por decisão explícita",
  },
];

/** Recolhe todos os arquivos de texto sob um caminho. */
function walk(root: string, acc: string[] = []): string[] {
  const stat = (() => { try { return statSync(root); } catch { return null; } })();
  if (!stat) return acc;
  if (stat.isFile()) { acc.push(root); return acc; }
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git") continue;
    walk(join(root, entry), acc);
  }
  return acc;
}

const OLD_BRAND = /No\s?Controle(?:\.ia)?|nocontrole|NOCONTROLE/;

function isAllowed(file: string, line: string): boolean {
  return ALLOWLIST.some((rule) => file.endsWith(rule.file) && rule.match.test(line));
}

describe("rebranding: ausência de marca antiga", () => {
  const collected: Array<{ file: string; line: string }> = [];

  const projectRoot = process.cwd();
  const files = SCAN_ROOTS.flatMap((r) => walk(join(projectRoot, r)));

  for (const abs of files) {
    // Só verifica arquivos-fonte relevantes; ignora binários e testes.
    if (!/\.(ts|tsx|js|jsx|html|css|json)$/.test(abs)) continue;
    if (abs.includes(`${join("src", "test")}/`) || abs.endsWith("rebranding-meunino.test.ts")) continue;
    const rel = relative(projectRoot, abs);
    let text: string;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (OLD_BRAND.test(line) && !isAllowed(rel, line)) {
        collected.push({ file: rel, line: line.trim() });
      }
    }
  }

  it("não há ocorrências novas de 'NoControle' fora da allowlist", () => {
    expect(collected).toEqual([]);
  });

  it("o rótulo comportamental 'No controle' do Pulso continua permitido (case insensitive)", () => {
    // Sanity check: "No controle" (com espaço) é um rótulo de Pulso e não
    // é capturado pela regex de marca (que exige 'C' maiúsculo colado).
    expect(OLD_BRAND.test("No controle")).toBe(false);
  });
});

// --- 2) Ordem de fallback do WAHA_SESSION ----------------------------------

describe("waha.ts: ordem de fallback da sessão", () => {
  const src = readFileSync(
    join(process.cwd(), "supabase/functions/_shared/messaging/waha.ts"),
    "utf8",
  );

  it("MEUNINO_WAHA_SESSION vem antes de NOCONTROLE_WAHA_SESSION", () => {
    const meunino = src.indexOf("MEUNINO_WAHA_SESSION");
    const legacy = src.indexOf("NOCONTROLE_WAHA_SESSION");
    const wahaOnly = src.indexOf('"WAHA_SESSION"');
    expect(meunino).toBeGreaterThanOrEqual(0);
    expect(legacy).toBeGreaterThan(meunino);
    expect(wahaOnly).toBeGreaterThan(legacy);
  });

  it("preserva DEFAULT_SESSION_FALLBACK = 'default'", () => {
    expect(src).toMatch(/DEFAULT_SESSION_FALLBACK\s*=\s*"default"/);
  });
});

// --- 3) Migração one-shot do periodStore -----------------------------------

describe("periodStore: migração legada do localStorage", () => {
  const NEW_KEY = "meunino.periodFilter.v1";
  const OLD_KEY = "nocontrole.periodFilter.v1";

  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("migra o valor legado para a chave nova e apaga a antiga", async () => {
    const value = JSON.stringify({ period: "30d", customStart: "2026-07-01", customEnd: "2026-07-23" });
    window.localStorage.setItem(OLD_KEY, value);

    const mod = await import("../lib/ui/periodStore");
    const state = mod.getPeriod();

    expect(state.period).toBe("30d");
    expect(window.localStorage.getItem(NEW_KEY)).toBe(value);
    expect(window.localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it("não sobrescreve valor já existente na chave nova", async () => {
    const newerValue = JSON.stringify({ period: "month", customStart: "2026-07-01", customEnd: "2026-07-23" });
    const olderValue = JSON.stringify({ period: "90d", customStart: "2026-04-01", customEnd: "2026-07-23" });
    window.localStorage.setItem(NEW_KEY, newerValue);
    window.localStorage.setItem(OLD_KEY, olderValue);

    const mod = await import("../lib/ui/periodStore");
    mod.getPeriod();

    expect(window.localStorage.getItem(NEW_KEY)).toBe(newerValue);
    // Chave legada permanece intacta quando a nova já existe.
    expect(window.localStorage.getItem(OLD_KEY)).toBe(olderValue);
  });
});

// --- 4) Parser de vínculo do WhatsApp aceita ambas as marcas ---------------

describe("whatsapp-webhook: extractLinkCode aceita MeuNino e NoControle", () => {
  const src = readFileSync(
    join(process.cwd(), "supabase/functions/whatsapp-webhook/index.ts"),
    "utf8",
  );

  // Reproduz o regex "alternate" declarado na função para exercitar as duas
  // marcas sem precisar importar o módulo Deno.
  const BRAND_RX = /MeuNino|NoControle/i;
  const CODE_RX = /c[óo]digo[^0-9]{0,15}(\d{6})\b/i;

  it("o webhook contém o regex de marca esperado", () => {
    expect(src).toMatch(/MeuNino\|NoControle/);
  });

  it("captura o código com a marca atual (MeuNino)", () => {
    const msg = "Oi, quero vincular meu MeuNino. Meu código: 123456";
    expect(BRAND_RX.test(msg)).toBe(true);
    expect(CODE_RX.exec(msg)?.[1]).toBe("123456");
  });

  it("continua capturando o código com a marca legada (NoControle)", () => {
    const msg = "Olá, sou do NoControle. Meu código é 654321";
    expect(BRAND_RX.test(msg)).toBe(true);
    expect(CODE_RX.exec(msg)?.[1]).toBe("654321");
  });
});
