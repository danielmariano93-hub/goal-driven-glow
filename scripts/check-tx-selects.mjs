#!/usr/bin/env node
/**
 * Guarda de contrato (`tx_select_guard.v1`).
 *
 * Varre TODO `.from("transactions").select(...)` do repositório e falha se
 * qualquer coluna pedida não existir no schema real (tipos gerados em
 * `src/integrations/supabase/types.ts`).
 *
 * Motivo: um `SELECT` com coluna inexistente derruba a leitura no PostgREST em
 * runtime, o motor cai no fluxo antigo e o usuário recebe a resposta errada —
 * exatamente o que aconteceu com `transfer_direction`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Sob vitest o especificador vem como `/@fs/...`; caímos para o cwd do projeto.
const FROM_URL = resolve(new URL("..", import.meta.url).pathname.replace(/^\/@fs/, ""));
const ROOT = existsSync(join(FROM_URL, "package.json")) ? FROM_URL : process.cwd();

const TYPES = join(ROOT, "src/integrations/supabase/types.ts");
const SCAN_DIRS = ["src", "supabase/functions", "scripts"];
const EXTS = [".ts", ".tsx", ".mjs"];

/** Colunas reais de `public.transactions` conforme os tipos gerados. */
export function transactionColumns(typesSource = readFileSync(TYPES, "utf8")) {
  const idx = typesSource.indexOf("      transactions: {");
  if (idx < 0) throw new Error("transactions_table_not_found_in_types");
  const rowIdx = typesSource.indexOf("Row: {", idx);
  const end = typesSource.indexOf("\n        }", rowIdx);
  const block = typesSource.slice(rowIdx, end);
  const cols = new Set();
  for (const line of block.split("\n").slice(1)) {
    const m = line.match(/^\s*([a-z_][a-z0-9_]*)\??:/i);
    if (m) cols.add(m[1]);
  }
  if (cols.size === 0) throw new Error("transactions_columns_not_parsed");
  return cols;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
}

/** Resolve `const NAME = "a,b,c"` e `const NAME = [...].join(",")` no arquivo. */
function resolveConstant(source, name) {
  const str = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\n?\\s*"([^"]+)"`));
  if (str) return str[1];
  const arr = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]\\s*\\.join`));
  if (arr) return arr[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).join(",");
  return null;
}

const SELECT_RE = /from\(\s*["']transactions["']\s*\)[\s\S]{0,80}?\.select\(\s*([^)]*?)\s*\)/g;

/** Todos os selects de `transactions` encontrados, com as colunas resolvidas. */
export function collectTransactionSelects(files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const found = [];
  for (const file of files) {
    if (/\.test\.tsx?$/.test(file) || file.endsWith("check-tx-selects.mjs")) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes('from("transactions")') && !source.includes("from('transactions')")) continue;
    for (const m of source.matchAll(SELECT_RE)) {
      const raw = m[1].trim();
      let literal = null;
      if (/^["'][\s\S]*["']$/.test(raw)) literal = raw.slice(1, -1);
      else if (/^[A-Za-z_$][\w$]*$/.test(raw)) literal = resolveConstant(source, raw);
      if (literal == null) continue; // dinâmico: fora do escopo da guarda
      const columns = literal.split(",").map((c) => c.trim()).filter(Boolean);
      found.push({ file: file.replace(ROOT + "/", ""), columns });
    }
  }
  return found;
}

/** Colunas usadas em selects que NÃO existem no schema. */
export function findInvalidTransactionColumns(selects = collectTransactionSelects(), cols = transactionColumns()) {
  const bad = [];
  for (const s of selects) {
    for (const c of s.columns) {
      if (c === "*" || c.includes("(") || c.includes(":")) continue; // embed/alias
      const name = c.replace(/^.*\./, "");
      if (!cols.has(name)) bad.push({ file: s.file, column: name });
    }
  }
  return bad;
}

/**
 * Guarda de competência (`reporting_competence.v1`).
 *
 * Qualquer superfície que agregue por mês precisa da competência canônica:
 * cartão pelo mês da fatura. Se o `SELECT` traz `occurred_at` mas não traz
 * `competence_date`, a agregação degrada em silêncio para a data da compra e o
 * WhatsApp volta a divergir do relatório. Aqui a divergência falha antes.
 */
const COMPETENCE_REQUIRED_FILES = [
  "supabase/functions/financial-reports-generate/index.ts",
  "src/pages/RelatoriosInteligentes.tsx",
];

export function findMissingCompetenceSelects(selects = collectTransactionSelects()) {
  const missing = [];
  for (const s of selects) {
    if (!COMPETENCE_REQUIRED_FILES.includes(s.file)) continue;
    if (!s.columns.includes("occurred_at")) continue;
    if (!s.columns.includes("competence_date")) missing.push({ file: s.file });
  }
  return missing;
}

/**
 * Guarda de lente por categoria (`reporting_competence.v1`).
 *
 * Toda definição de `computeCategoryBreakdown` — fonte, espelho de edge ou
 * bundle do MCP — precisa recortar por `reportingCompetenceDate`. Se alguma
 * cópia voltar a somar por `occurred_at`, a mesma categoria mostra dois valores
 * em duas telas. Aqui a divergência falha antes de ir para produção.
 */
const CATEGORY_BREAKDOWN_FILES = [
  "src/lib/engine/facts.ts",
  "supabase/functions/_shared/finance-core/facts.ts",
  "supabase/functions/mcp/index.ts",
];

export function findCategoryBreakdownWithoutCompetence() {
  const bad = [];
  for (const file of CATEGORY_BREAKDOWN_FILES) {
    let src;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    const at = src.indexOf("function computeCategoryBreakdown");
    if (at < 0) continue;
    const body = src.slice(at, at + 900);
    if (!body.includes("reportingCompetenceDate")) bad.push({ file });
  }
  return bad;
}

/**
 * Guarda de leitura completa (`paged_select.v1`).
 *
 * A Data API devolve NO MÁXIMO 1.000 linhas por requisição e ignora limites
 * maiores sem erro. `.limit(8000)` em `transactions` não trazia 8.000 linhas:
 * trazia as 1.000 primeiras da ordenação, e o relatório somava um pedaço do
 * período (Transporte 1.603,76 contra a verdade 2.389,99). Quem precisa da
 * série inteira pagina com `fetchAllPages`; pedir mais de 1.000 numa tacada é
 * mentira silenciosa e falha aqui.
 */
const LIMIT_RE = /from\(\s*["']transactions["']\s*\)[\s\S]{0,900}?\.limit\(\s*(\d+)/g;

export function findTruncatedTransactionReads(files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const bad = [];
  for (const file of files) {
    if (/\.test\.tsx?$/.test(file) || file.endsWith("check-tx-selects.mjs")) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes('from("transactions")') && !source.includes("from('transactions')")) continue;
    for (const m of source.matchAll(LIMIT_RE)) {
      const limit = Number(m[1]);
      if (limit > DATA_API_PAGE) bad.push({ file: file.replace(ROOT + "/", ""), limit });
    }
  }
  return bad;
}

export const DATA_API_PAGE = 1000;

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = findInvalidTransactionColumns();
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b.file}: coluna inexistente em transactions -> ${b.column}`);
    process.exit(1);
  }
  const missing = findMissingCompetenceSelects();
  if (missing.length) {
    for (const m of missing) console.error(`✗ ${m.file}: agregação mensal sem competence_date`);
    process.exit(1);
  }
  const lens = findCategoryBreakdownWithoutCompetence();
  if (lens.length) {
    for (const l of lens) console.error(`✗ ${l.file}: computeCategoryBreakdown soma fora da competência canônica`);
    process.exit(1);
  }
  const truncated = findTruncatedTransactionReads();
  if (truncated.length) {
    for (const t of truncated) {
      console.error(`✗ ${t.file}: .limit(${t.limit}) em transactions — a Data API corta em 1.000; use fetchAllPages`);
    }
    process.exit(1);
  }
  console.log("tx_select_guard: colunas reais + competência + leitura paginada");
}



