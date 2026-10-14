import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PUSH_DAILY_CAP, buildPushPayload, decidePush, inQuietHours, validSubscription,
} from "../../supabase/functions/_shared/push/rules";
import { urlBase64ToUint8Array } from "../lib/push/pushClient";

// 10:00 em São Paulo (UTC-3) = 13:00Z; 23:00 SP = 02:00Z
const DAY = new Date("2026-10-14T13:00:00Z");
const NIGHT = new Date("2026-10-15T02:00:00Z");

describe("notificações push — regras", () => {
  it("só notificações que valem uma interrupção viram push", () => {
    expect(decidePush({ type: "agent_confirmation", now: DAY, sentLast24h: 0 }).reason).toBe("type_excluded");
    expect(decidePush({ type: "import_done", now: DAY, sentLast24h: 0 }).send).toBe(false);
    expect(decidePush({ type: "system", now: DAY, sentLast24h: 0 })).toEqual({ send: true, reason: "ok" });
    expect(decidePush({ type: "financial_report", now: DAY, sentLast24h: 0 }).send).toBe(true);
  });
  it("respeita a preferência que a pessoa já controla, o silêncio e o limite diário", () => {
    expect(decidePush({ type: "split_reminder", now: DAY, prefs: { split_reminder: false }, sentLast24h: 0 }).reason).toBe("preference_off");
    expect(decidePush({ type: "system", now: NIGHT, sentLast24h: 0 }).reason).toBe("quiet_hours");
    expect(decidePush({ type: "system", now: DAY, sentLast24h: PUSH_DAILY_CAP }).reason).toBe("daily_cap");
    expect(decidePush({ type: "system", now: NIGHT, sentLast24h: 99, isTest: true }).send).toBe(true);
  });
  it("silêncio cruza a meia-noite e aceita janela personalizada", () => {
    expect(inQuietHours(23)).toBe(true);
    expect(inQuietHours(7)).toBe(true);
    expect(inQuietHours(8)).toBe(false);
    expect(inQuietHours(12, "13:00", "15:00")).toBe(false);
    expect(inQuietHours(14, "13:00", "15:00")).toBe(true);
  });
  it("aceita só assinaturas de serviços de push conhecidos", () => {
    const keys = { p256dh: "BPk", auth: "abc" };
    expect(validSubscription({ endpoint: "https://web.push.apple.com/QWER", keys })).toBe(true);
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys })).toBe(true);
    expect(validSubscription({ endpoint: "http://web.push.apple.com/x", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://evil.example.com/x", keys })).toBe(false);
    expect(validSubscription({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: 1 } })).toBe(false);
    expect(validSubscription(null)).toBe(false);
  });
  it("o conteúdo é curto, sem formatação do WhatsApp e o link é sempre do app", () => {
    const p = buildPushPayload({ title: "*Conta vence amanhã*", body: "Celular\n— R$ 500,00 *hoje*", action_url: "https://outro.site/x", dedup_key: "k" });
    expect(p).toEqual({ title: "Conta vence amanhã", body: "Celular — R$ 500,00 hoje", url: "/app", tag: "k" });
    expect(buildPushPayload({ title: "x", action_url: "/app/metas" }).url).toBe("/app/metas");
    expect(buildPushPayload({ title: "x", action_url: "//evil.com" }).url).toBe("/app");
    expect(buildPushPayload({ title: "x", body: "a".repeat(500) }).body.length).toBe(180);
  });
  it("chave VAPID em base64url vira bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("notificações push — contratos", () => {
  const fn = readFileSync("supabase/functions/push-notify/index.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261014100000_web_push.sql", "utf8");
  const sw = readFileSync("public/sw.js", "utf8");
  it("função: gatilho interno por segredo, usuário por JWT real e sem log de conteúdo", () => {
    expect(fn).toContain("safeEqual(cron, CRON_SECRET)");
    expect(fn).toContain("auth.getUser(");
    expect(fn).not.toMatch(/console\.(log|error|warn)/);
    expect(fn).toContain("404 || status === 410");
  });
  it("banco: RLS, chave VAPID só do servidor e gatilho que nunca bloqueia a notificação", () => {
    for (const t of ["push_subscriptions", "push_deliveries", "push_vapid_keys"]) expect(sql).toContain(`alter table public.${t} enable row level security`);
    expect(sql).toMatch(/revoke all on public\.push_subscriptions, public\.push_deliveries, public\.push_vapid_keys from anon, public, authenticated/);
    expect(sql).not.toMatch(/grant select[^;]*private_key/);
    expect(sql).toContain("exception when others then");
    expect(sql).toContain("after insert on public.notifications");
  });
  it("service worker: só push e clique, sem cache e só rotas do app", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).not.toContain('addEventListener("fetch"');
    expect(sw).toContain('startsWith("/") && !raw.startsWith("//")');
  });
  it("app instalado respeita a área segura do topo", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.pwa-standalone #root \{[^}]*padding-top: env\(safe-area-inset-top\)/);
    expect(readFileSync("src/main.tsx", "utf8")).toContain('classList.add("pwa-standalone")');
  });
});
