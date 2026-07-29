import { describe, it, expect } from "vitest";
import { buildIncidents, groupBySeverity } from "@/lib/admin/incidents";
import { universeNotes, universeCaption, staleDays, type AdminUniverse } from "@/lib/admin/universe";
import { ADMIN_RPC_ARGS, buildArgs } from "@/lib/admin/rpcContracts";

const universe: AdminUniverse = {
  clients: 2,
  accounts: 6,
  platform_admins: 1,
  test_accounts: 3,
  pseudonyms: 6,
  event_pseudonyms: 16,
  event_pseudonyms_orphan: 10,
  events_total: 482,
  events_live: 13,
  events_reconstructed: 469,
  events_last_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  agent_runs: 142,
  measured_at: new Date().toISOString(),
  formula_version: "universe.v1",
};

describe("universo canônico do admin", () => {
  it("separa clientes reais de contas e de identificadores de evento", () => {
    const caption = universeCaption(universe);
    expect(caption).toContain("2 cliente(s) reais");
    expect(caption).toContain("6 conta(s)");
  });

  it("explica identificadores de evento sem cliente correspondente", () => {
    const note = universeNotes(universe).find((n) => n.id === "orphan-pseudonyms");
    expect(note?.tone).toBe("warning");
    expect(note?.title).toContain("10");
  });

  it("marca histórico reconstruído como não representativo de uso ao vivo", () => {
    const note = universeNotes(universe).find((n) => n.id === "reconstructed-events");
    expect(note?.title).toContain("97%");
  });

  it("avisa quando a coleta de eventos está parada", () => {
    expect(staleDays(universe.events_last_at)).toBeGreaterThanOrEqual(4);
    expect(universeNotes(universe).some((n) => n.id === "stale-events")).toBe(true);
  });

  it("não gera avisos sem dados de universo", () => {
    expect(universeNotes(null)).toEqual([]);
  });
});

describe("incidentes acionáveis", () => {
  it("transforma WhatsApp desconectado em ação crítica com destino", () => {
    const incidents = buildIncidents({
      status: {
        whatsapp: { status: "disconnected", error_code: "SESSION_LOST", latency_ms: null, last_seen_at: null, active_links: 2 },
        agent: { status: "working", active_prompt: true, failures_24h: 0 },
        jobs: {} as never,
        outbox: { queued: 0, failed: 0 },
      },
    });
    const wa = incidents.find((i) => i.id === "whatsapp-channel")!;
    expect(wa.severity).toBe("critical");
    expect(wa.action?.to).toBe("/admin/operacoes?secao=whatsapp");
    expect(wa.title).not.toMatch(/disconnected/);
  });

  it("todo incidente tem título em linguagem de negócio e ação", () => {
    const incidents = buildIncidents({
      status: {
        whatsapp: { status: "connected", error_code: null, latency_ms: 120, last_seen_at: null, active_links: 2 },
        agent: { status: "working", active_prompt: true, failures_24h: 0 },
        jobs: {} as never,
        outbox: { queued: 0, failed: 3 },
      },
      universe,
      messagingFailureRate: 12,
    });
    for (const incident of incidents) {
      expect(incident.title.length).toBeGreaterThan(5);
      expect(incident.action).toBeTruthy();
    }
    const grouped = groupBySeverity(incidents);
    expect(grouped.critical.length + grouped.warning.length).toBeGreaterThan(0);
  });
});

describe("contratos das novas RPCs", () => {
  it("declara universo e ficha do cliente", () => {
    expect(ADMIN_RPC_ARGS.admin_v2_metrics_universe).toEqual([]);
    expect(ADMIN_RPC_ARGS.admin_v2_client_profile).toEqual(["_pseudo_id"]);
  });

  it("a ficha do cliente não aceita argumentos extras", () => {
    expect(buildArgs("admin_v2_client_profile", { _pseudo_id: "abc", _tz: "x" })).toEqual({
      _pseudo_id: "abc",
    });
  });
});
