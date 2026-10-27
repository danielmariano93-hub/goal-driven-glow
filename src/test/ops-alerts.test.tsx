import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildArgs } from "@/lib/admin/rpcContracts";
import { sinceText, type OpsAlertsData } from "@/lib/admin/opsAlerts";

let current: OpsAlertsData;
const calls: Array<{ fn: string; args: unknown }> = [];
vi.mock("@/lib/admin/adminRpc", async (orig) => ({
  ...(await orig<object>()),
  callAdminRpc: vi.fn(async (fn: string, args?: unknown) => { calls.push({ fn, args }); return fn === "admin_ops_alerts_get" ? current : { ok: true }; }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OpsAlertsBanner, OpsAlertsPanel } from "@/components/admin/OpsAlerts";

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
const base: OpsAlertsData = {
  open: [], recent: [],
  settings: { enabled: true, ntfy_topic: null, notify_whatsapp: true, renotify_minutes: 120, whatsapp_to: null },
};

describe("alertas de funcionamento no admin", () => {
  it("sem alerta aberto, a faixa não aparece e o painel diz que está tudo funcionando", async () => {
    current = base;
    const { container } = render(wrap(<><OpsAlertsBanner /><OpsAlertsPanel /></>));
    await screen.findByText("Tudo funcionando agora.");
    expect(container.querySelector('[data-testid="ops-alerts-banner"]')).toBeNull();
  });
  it("com alerta crítico aberto, a faixa mostra o problema, o tempo e os outros alertas", async () => {
    current = { ...base, open: [
      { key: "whatsapp_send_failing", severity: "critical", title: "O Nino não está conseguindo enviar mensagens no WhatsApp", detail: "3 falharam", since: new Date(Date.now() - 90 * 60_000).toISOString(), last_seen: new Date().toISOString() },
      { key: "ai_failing", severity: "warning", title: "Chamadas de IA estão falhando", detail: "4 falhas", since: new Date().toISOString(), last_seen: new Date().toISOString() },
    ] };
    render(wrap(<OpsAlertsBanner />));
    const banner = await screen.findByTestId("ops-alerts-banner");
    expect(banner.textContent).toMatch(/não está conseguindo enviar/);
    expect(banner.textContent).toMatch(/há 1 h/);
    expect(banner.textContent).toMatch(/mais 1 alerta/);
  });
  it("salva o código do celular e a repetição", async () => {
    current = base;
    render(wrap(<OpsAlertsPanel />));
    const input = await screen.findByPlaceholderText(/nino-alertas/);
    fireEvent.change(input, { target: { value: "nino-alertas-abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.fn === "admin_ops_alert_settings_save")).toBe(true));
    expect(calls.find((c) => c.fn === "admin_ops_alert_settings_save")!.args).toMatchObject({ _ntfy_topic: "nino-alertas-abc12345", _enabled: true, _renotify_minutes: 120 });
  });
  it("tempo em texto curto e contratos das RPCs", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(sinceText("2026-10-26T11:30:00Z", now)).toBe("há 30 min");
    expect(sinceText("2026-10-24T12:00:00Z", now)).toBe("há 2 dias");
    expect(buildArgs("admin_ops_alerts_get", { x: 1 })).toEqual({});
    expect(Object.keys(buildArgs("admin_ops_alert_settings_save", { _enabled: true, _ntfy_topic: "a", _notify_whatsapp: true, _renotify_minutes: 1, _whatsapp_to: "+55", y: 2 })).sort()).toEqual(["_enabled", "_notify_whatsapp", "_ntfy_topic", "_renotify_minutes", "_whatsapp_to"]);
  });
});

describe("contrato do banco e da vigia", () => {
  const mig = readFileSync("supabase/migrations/20261026140000_ops_alerts.sql", "utf8");
  const fn = readFileSync("supabase/functions/ops-alerts-tick/index.ts", "utf8");
  it("detecta WhatsApp sem enviar, entrada parada, rotinas paradas, IA e erros", () => {
    for (const k of ["whatsapp_send_failing", "inbound_unprocessed", "'cron_' || j.jobname", "ai_failing", "agent_errors"]) expect(mig).toContain(k);
  });
  it("só o admin lê e configura; a vigia usa a chave de serviço", () => {
    expect(mig).toMatch(/admin_ops_alerts_get[\s\S]*is_current_user_admin\(\)/);
    expect(mig).toMatch(/revoke all on function public\.ops_alerts_evaluate\(\) from public, anon, authenticated/);
    expect(mig).toMatch(/grant execute on function public\.ops_alerts_sync\(jsonb\) to service_role/);
  });
  it("a vigia testa o servidor do WAHA pela rede e não usa o WhatsApp para avisar falha do WhatsApp", () => {
    expect(fn).toMatch(/\/api\/sessions\//);
    expect(fn).toMatch(/waha_unreachable/);
    expect(fn).toMatch(/whatsappIsTheProblem/);
    expect(fn).toMatch(/INTERNAL_SECRET/);
  });
});
