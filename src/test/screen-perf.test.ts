import { describe, expect, it } from "vitest";
import { buildScreenEvent, classifyDevice, isFastScreen, normalizeRoute, READY_TIMEOUT_MS } from "@/lib/perf/screenTiming";

describe("indicador Tela pronta: partes puras", () => {
  it("normaliza o caminho em 'tela' sem ids nem dados pessoais", () => {
    expect(normalizeRoute("/app/metas")).toBe("/app/metas");
    expect(normalizeRoute("/app/metas/categoria/b0655e4b-e41e-44ea-ae2f-c3d8596aefe5")).toBe("/app/metas/categoria/:id");
    expect(normalizeRoute("/app/divisao-do-role/123456?x=1#y")).toBe("/app/divisao-do-role/:id");
    expect(normalizeRoute("/app/")).toBe("/app");
    expect(normalizeRoute("/app/Metas/")).toBe("/app/metas");
  });
  it("só mede telas do app (painel admin e páginas públicas ficam de fora)", () => {
    for (const p of ["/", "/login", "/admin/cockpit", "/privacidade", "/appx"]) expect(normalizeRoute(p), p).toBeNull();
  });
  it("classifica o aparelho", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe("ios"); // iPad no modo desktop
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(classifyDevice("")).toBe("desconhecido");
  });
  it("monta o evento: tempo = pronto − início; extras de rede só na primeira abertura; teto de 20 s", () => {
    const soft = buildScreenEvent({ route: "/app/metas", first: false, startedAt: 1000, readyAt: 1840.6, timedOut: false, device: "ios", standalone: true, ttfb: 10, fcp: 20, lcp: 30, build: "abc1234" });
    expect(soft).toMatchObject({ nav_kind: "soft", ready_ms: 841, timed_out: false, device: "ios", standalone: true, build: "abc1234" });
    expect("ttfb_ms" in soft).toBe(false);
    const cold = buildScreenEvent({ route: "/app", first: true, startedAt: 0, readyAt: 2500, timedOut: false, device: "android", standalone: false, ttfb: 310.4, fcp: 900.2, lcp: 2100 });
    expect(cold).toMatchObject({ nav_kind: "cold", ready_ms: 2500, ttfb_ms: 310, fcp_ms: 900, lcp_ms: 2100 });
    expect(buildScreenEvent({ route: "/app", first: false, startedAt: 0, readyAt: 99_000, timedOut: true, device: "desktop", standalone: false }).ready_ms).toBe(READY_TIMEOUT_MS);
  });
  it("faixas de 'rápida': 2 s numa tela comum, 3 s na primeira abertura, nunca se não terminou", () => {
    expect(isFastScreen({ ready_ms: 2000, nav_kind: "soft", timed_out: false })).toBe(true);
    expect(isFastScreen({ ready_ms: 2001, nav_kind: "soft", timed_out: false })).toBe(false);
    expect(isFastScreen({ ready_ms: 3000, nav_kind: "cold", timed_out: false })).toBe(true);
    expect(isFastScreen({ ready_ms: 100, nav_kind: "soft", timed_out: true })).toBe(false);
  });
});
