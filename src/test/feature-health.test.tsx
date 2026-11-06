import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { healthHeadline, summarizeHealth, type HealthRow } from "@/lib/admin/featureHealth";
import { opsNoticeRows } from "../../supabase/functions/_shared/messaging/opsAppNotice";

const row = (key: string, status: HealthRow["status"], over: Partial<HealthRow> = {}): HealthRow => ({
  key, group: "Agente", title: `Título ${key}`, question: "Pergunta?", status, value: "valor", reference: "ref",
  detail: "detalhe", action: status === "warn" || status === "crit" ? "Faça isto" : null, link: "/admin/nino-ia", ...over,
});
let rows: HealthRow[] = [];
vi.mock("@/lib/admin/adminRpc", () => ({ callAdminRpc: async () => ({ generated_at: "2026-11-06T12:00:00Z", rows }) }));

async function mount(ui: "panel" | "strip") {
  const { FeatureHealthPanel, FeatureHealthStrip } = await import("@/components/admin/FeatureHealth");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui === "panel" ? <FeatureHealthPanel /> : <FeatureHealthStrip />}</MemoryRouter></QueryClientProvider>);
}

describe("saúde das features: resumo", () => {
  it("crítico vem antes de atenção, que vem antes de ok; sem dados fica à parte", () => {
    const s = summarizeHealth([row("a", "ok"), row("b", "warn"), row("c", "crit"), row("d", "nodata"), row("e", "info")]);
    expect(s.attention.map((r) => r.key)).toEqual(["c", "b"]);
    expect(s.working.map((r) => r.key)).toEqual(["a"]);
    expect(s.nodata.map((r) => r.key)).toEqual(["d"]);
    expect(s.critical).toBe(1);
  });
  it("a frase do topo diz o que importa", () => {
    expect(healthHeadline(summarizeHealth([row("a", "ok"), row("d", "nodata")]))).toMatch(/funcionando.*1 ainda sem dados/);
    expect(healthHeadline(summarizeHealth([row("a", "crit"), row("b", "warn")]))).toMatch(/1 feature parou ou quebrou e mais 1 pede atenção/);
    expect(healthHeadline(summarizeHealth([row("b", "warn")]))).toMatch(/1 feature pede atenção/);
    expect(healthHeadline(summarizeHealth([]))).toMatch(/Ainda não há dados/);
  });
});

describe("saúde das features: tela", () => {
  it("o que precisa de ação mostra 'o que fazer' e link; o que está ok não mostra", async () => {
    rows = [row("quebrada", "crit"), row("boa", "ok"), row("pouca", "nodata")];
    await mount("panel");
    expect(await screen.findByTestId("health-quebrada")).toHaveTextContent("O que fazer: Faça isto");
    expect(screen.getByTestId("health-boa")).not.toHaveTextContent("O que fazer");
    expect(screen.getByText(/Ainda sem dados suficientes \(1\)/)).toBeInTheDocument();
  });
  it("a faixa da Visão geral some quando está tudo bem", async () => {
    rows = [row("boa", "ok"), row("pouca", "nodata")];
    const { container } = await mount("strip");
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector("[data-testid=feature-health-strip]")).toBeNull();
  });
  it("a faixa aparece com até 3 itens quando algo pede atenção", async () => {
    rows = [row("a", "warn"), row("b", "warn"), row("c", "crit"), row("d", "warn")];
    await mount("strip");
    expect(await screen.findByTestId("feature-health-strip")).toBeInTheDocument();
    expect(screen.getAllByText(/^• /)).toHaveLength(3);
  });
});

describe("saúde das features: canais de aviso", () => {
  it("o popup de uma feature leva para a página de saúde; os demais, para a Visão geral", () => {
    const m = { title: "t", body: "b" };
    expect(opsNoticeRows(["u1"], { id: "1", kind: "new", key: "feature_agent_error_rate", severity: "warning" }, m, 0)[0].action_url).toBe("/admin/saude");
    expect(opsNoticeRows(["u1"], { id: "2", kind: "new", key: "cron_x", severity: "critical" }, m, 0)[0].action_url).toBe("/admin/visao-geral");
  });
  it("a Edge Function mescla os alertas de feature sem derrubar os de infraestrutura", () => {
    const src = readFileSync("supabase/functions/ops-alerts-tick/index.ts", "utf8");
    expect(src).toContain('rpc("ops_feature_health_alerts")');
    expect(src).toMatch(/try \{[\s\S]*ops_feature_health_alerts[\s\S]*catch/);
    expect(src).toMatch(/\.\.\.featureAlerts/);
  });
});

describe("saúde das features: contrato do SQL", () => {
  const sql = readFileSync("supabase/migrations/20261106120000_feature_health.sql", "utf8");
  it("só admin lê; o snapshot e os alertas ficam restritos ao service_role", () => {
    expect(sql).toMatch(/admin_feature_health[\s\S]*is_current_user_admin\(\)/);
    expect(sql).toMatch(/revoke all on function public\.feature_health_snapshot\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.ops_feature_health_alerts\(\) from public, anon, authenticated/);
  });
  it("tem amostra mínima e estado 'nodata' (volume pequeno não gera falso alarme)", () => {
    expect(sql).toContain("'nodata'");
    expect(sql).toMatch(/runs24 < 5/);
    expect(sql).toMatch(/wa7 < 5/);
  });
  it("conta de teste e simulador ficam de fora; pedir o valor não é falha", () => {
    expect(sql).toMatch(/is_test or p\.is_sandbox/);
    expect(sql).toMatch(/<> 'simulator'/);
    expect(sql).toContain("not like 'needs\\_%'");
  });
  it("só aviso e crítico viram alerta", () => {
    expect(sql).toMatch(/x->>'status' in \('warn', 'crit'\)/);
  });
});
