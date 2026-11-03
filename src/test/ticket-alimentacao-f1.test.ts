// Ticket Alimentação F1: segurança, isolamento do livro-razão e acesso por usuário.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261103120000_ticket_alimentacao_f1.sql", "utf8");
const hook = readFileSync("src/lib/db/benefitWallet.ts", "utf8");
const page = readFileSync("src/pages/TicketAlimentacao.tsx", "utf8");
const engine = readFileSync("src/lib/engine/benefitWallet.ts", "utf8");

describe("Ticket Alimentação F1", () => {
  it("tabelas com segurança por linha, sem acesso anônimo, escrita só de quem foi liberado", () => {
    for (const t of ["benefit_wallets", "benefit_entries", "benefit_wallet_access"]) expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain("REVOKE ALL ON public.benefit_wallets, public.benefit_entries FROM anon, public;");
    expect(sql).toContain("WITH CHECK (user_id = auth.uid() AND public.benefit_wallet_enabled())");
    expect(sql).toMatch(/benefit_entries_insert_own[\s\S]*EXISTS \(SELECT 1 FROM public\.benefit_wallets w WHERE w\.id = wallet_id AND w\.user_id = auth\.uid\(\)\)/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.benefit_wallet_enabled() FROM public, anon;");
  });

  it("valores válidos: só o ajuste pode ser negativo; dia do crédito 1–31; uma carteira ativa por usuário", () => {
    expect(sql).toContain("CHECK (kind = 'adjustment' OR amount > 0)");
    expect(sql).toContain("credit_day smallint NOT NULL CHECK (credit_day BETWEEN 1 AND 31)");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS benefit_wallets_one_active_per_user");
  });

  it("migração aditiva: sem DROP, sem tocar no livro-razão, sem cron, sem função de rede", () => {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\bDROP\b|ALTER TABLE public\.transactions|cron\.schedule|net\.http_post/i);
  });

  it("o Ticket nunca lê nem escreve o livro-razão (contexto separado)", () => {
    for (const src of [hook, page, engine]) expect(src).not.toMatch(/from\("transactions"\)|from\("accounts"\)|movement_kind/);
  });

  it("a tela só abre para quem foi liberado (falha fechada) e a rota existe como link direto", () => {
    expect(page).toContain("<Navigate to=\"/app\" replace />");
    expect(hook).toContain("return !error && data === true;");
    expect(readFileSync("src/App.tsx", "utf8")).toContain('<Route path="ticket" element={<TicketAlimentacao />} />');
    expect(readFileSync("src/lib/navigation/appNavigationRegistry.ts", "utf8")).toMatch(/id: "ticket-alimentacao", path: "\/app\/ticket"[^\n]*deep_link/);
  });

  it("o motor é puro: sem rede, sem banco, sem relógio global", () => {
    expect(engine).not.toMatch(/fetch\(|supabase|Date\.now\(|new Date\(\)/);
  });
});
