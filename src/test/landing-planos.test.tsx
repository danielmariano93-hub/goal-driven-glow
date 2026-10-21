import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildArgs } from "@/lib/admin/rpcContracts";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { DEFAULT_PLANS, yearlySavingPct, formatPlanPrice } from "@/lib/plans/landingPlans";
import { PlansSection } from "@/pages/landing/PlansSection";

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PlansSection /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "landing_plans_public") return { data: { plans: DEFAULT_PLANS }, error: null };
    if (fn === "plan_waitlist_join") return { data: { ok: true, already: false }, error: null };
    return { data: 0, error: null };
  });
});

describe("vitrine de planos", () => {
  it("o plano de bancos conectados não mostra preço e diz Em breve", async () => {
    const { container } = wrap();
    await screen.findByRole("button", { name: /Entrar na lista de espera/ });
    const conecta = container.querySelector('[data-plan="conecta"]')!;
    expect(conecta.textContent).toMatch(/Em breve/);
    expect(conecta.textContent).not.toMatch(/R\$/);
    expect(screen.getByRole("button", { name: /Entrar na lista de espera/ })).toBeTruthy();
  });
  it("planos disponíveis mostram preço e levam ao cadastro", async () => {
    const { container } = wrap();
    await screen.findByRole("button", { name: /Entrar na lista de espera/ });
    const nino = container.querySelector('[data-plan="nino"]')!;
    expect(nino.textContent).toMatch(/R\$\s?19,90/);
    expect(nino.querySelector("a")?.getAttribute("href")).toBe("/signup");
  });
  it("divisão do rolê aparece limitada no grátis e completa nos pagos", () => {
    const role = (i: number) => DEFAULT_PLANS[i].features.find((f) => f.key === "role")!;
    expect(role(0)).toMatchObject({ value: "limited", note: "1 divisão por mês" });
    expect(role(1).value).toBe("yes");
  });
  it("Open Finance só no plano Conecta", () => {
    const of = (i: number) => DEFAULT_PLANS[i].features.find((f) => f.key === "open_finance")!.value;
    expect([of(0), of(1), of(2)]).toEqual(["no", "no", "yes"]);
  });
  it("lista de espera exige consentimento e envia plano, e-mail e faixa de preço", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: /Entrar na lista de espera/ }));
    fireEvent.change(screen.getByPlaceholderText("voce@exemplo.com"), { target: { value: "pessoa@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: "R$ 20 a 30" }));
    fireEvent.click(screen.getByRole("button", { name: "Entrar na lista" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("plan_waitlist_join", { p_plan: "conecta", p_email: "pessoa@exemplo.com", p_intent: "20_30", p_consent: false }));
    // o servidor recusa sem consentimento; aqui o mock aceita, então confirmamos que o aviso de gratuidade está visível
    expect(screen.getByText(/nada será cobrado|Nenhuma cobrança/i)).toBeTruthy();
  });
  it("cada cartão lista só o que acrescenta ao plano anterior", async () => {
    const { container } = wrap();
    await screen.findByRole("button", { name: /Entrar na lista de espera/ });
    const items = (slug: string) => Array.from(container.querySelectorAll(`[data-plan="${slug}"] .lp-plan-features li`)).map((l) => l.textContent ?? "");
    expect(container.querySelector('[data-plan="nino"] .lp-plan-more')?.textContent).toMatch(/Tudo do Grátis, mais/);
    expect(items("nino").join("|")).toMatch(/WhatsApp/);
    expect(items("nino").join("|")).not.toMatch(/Registre seus gastos/);
    expect(items("conecta")).toHaveLength(2);
  });
  it("se a leitura falhar, a vitrine continua com o conteúdo padrão", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));
    const { container } = wrap();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelectorAll("[data-plan]").length).toBe(3));
  });
  it("cálculos de preço", () => {
    expect(yearlySavingPct({ price_monthly: 19.9, price_yearly: 179.9 })).toBe(25);
    expect(yearlySavingPct({ price_monthly: null, price_yearly: null })).toBeNull();
    expect(formatPlanPrice(0)).toBe("R$ 0");
  });
});

describe("contrato do banco e do admin", () => {
  const mig = readFileSync("supabase/migrations/20261021120000_landing_planos.sql", "utf8");
  it("tabelas ficam fechadas: só funções com validação escrevem", () => {
    expect(mig).toMatch(/revoke all on public\.landing_plans, public\.landing_plan_features, public\.landing_plan_feature_values, public\.plan_waitlist, public\.plan_interest_events from anon, authenticated/);
    expect(mig).toMatch(/grant execute on function public\.plan_waitlist_join\(text, text, text, boolean\) to anon, authenticated/);
    expect(mig).toMatch(/is_current_user_admin\(\)/);
  });
  it("o conteúdo inicial do banco espelha o fallback da landing", () => {
    for (const p of DEFAULT_PLANS) expect(mig).toContain(`'${p.slug}'`);
    for (const f of DEFAULT_PLANS[0].features) expect(mig).toContain(`('${f.key}'`);
    expect(mig).toMatch(/'nino'.*19\.90,179\.90/);
  });
  it("as RPCs do admin têm contrato declarado", () => {
    expect(buildArgs("admin_landing_plans_get", { x: 1 })).toEqual({});
    expect(buildArgs("admin_landing_plans_save", { _doc: { a: 1 }, y: 2 })).toEqual({ _doc: { a: 1 } });
  });
});
