import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

/** O participante só pode saber quanto paga e quando. Origem, total e fluxo são do dono. */
describe("privacidade do rolê para o participante", () => {
  const templates = read("supabase/functions/_shared/agent/messageTemplates.ts");
  const dispatch = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
  const pipeline = read("supabase/functions/_shared/split/participantPipeline.ts");

  it("os textos padrão não mencionam total, origem, dívida, cartão nem fluxo", () => {
    const splitTemplates = templates.split("\n").filter((l) => /^\s*(invite|reminder|due_soon|due_today|overdue|payment_confirmation|completed):/.test(l)).join("\n");
    expect(splitTemplates.length).toBeGreaterThan(200);
    for (const forbidden of ["{{total_amount}}", "{{participants_count}}", "{{split_context_sentence}}", "dívida", "cartão", "origem", "fluxo"]) {
      expect(splitTemplates.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    expect(splitTemplates.toLowerCase()).not.toMatch(/\btia\b/);
  });

  it("o despachante não fornece total nem número de pessoas aos textos", () => {
    expect(dispatch).not.toContain("total do rolê");
    expect(dispatch).not.toMatch(/total_amount:\s*formatBRL/);
    expect(dispatch).not.toContain("participants_count:");
    expect(dispatch).toContain('split_context_sentence: ""');
  });

  it("as respostas ao participante usam só parcelas e datas dele", () => {
    expect(pipeline).not.toMatch(/shared_expense_sources|source_credit_card_id|total_amount/);
  });

  it("as origens ficam numa tabela só do dono (RLS) sem acesso de escrita direto", () => {
    const sql = read("supabase/migrations/20261028100000_role_origens_multiplas.sql");
    expect(sql).toContain("alter table public.shared_expense_sources enable row level security");
    expect(sql).toContain("using (owner_user_id = auth.uid())");
    expect(sql).toMatch(/revoke all on public\.shared_expense_sources from anon, authenticated/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*shared_expense_sources[^;]*authenticated/);
  });

  it("a tela do participante não baixa total nem origens", () => {
    const detail = read("src/pages/DivisaoDoRoleDetalhe.tsx");
    expect(detail).toContain('select("id,title,occurred_at,due_date,status,owner_user_id,pix_key');
    expect(detail).not.toMatch(/from\("shared_expenses" as never\)\.select\("\*"/);
    expect(detail).toContain("RoleFlowCard");
    expect(detail).toMatch(/isOwner&&!split\.deleted_at&&<RoleFlowCard/);
    const list = read("src/pages/DivisaoDoRole.tsx");
    expect(list).not.toContain("shared_expenses(id,title,total_amount");
  });
});

describe("restrição de origem na linha do rolê", () => {
  it("aceita rolê financiado só por dívida (no máximo uma conta/cartão)", () => {
    const sql = readFileSync(`${process.cwd()}/supabase/migrations/20261028120000_role_sources_constraint.sql`, "utf8");
    expect(sql).toContain("drop constraint if exists shared_expenses_exactly_one_financial_source");
    expect(sql).toContain("<= 1) not valid");
  });
});
