import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRepairOutcome,
  decideSelfHeal,
} from "../../supabase/functions/_shared/messaging/webhookSelfHeal";
import { compareWebhookIdentity } from "../../supabase/functions/_shared/messaging/waha";

const CORE_DIR = "supabase/functions/_shared/agent/core/";
const EVENTS = ["message", "message.any", "message.ack", "session.status"];
const BASE = "https://proj.supabase.co/functions/v1/whatsapp-webhook";
const SECRET = "s3cr3t";

function hook(url: string, events = EVENTS, headers: Array<{ name: string; value: string }> = []) {
  return { url, events, customHeaders: headers };
}

describe("Barrel integrity — agent core", () => {
  it("todo símbolo re-exportado existe no módulo de origem", () => {
    const src = readFileSync(CORE_DIR + "index.ts", "utf8");
    const re = /export\s*\{([\s\S]*?)\}\s*from\s*"\.\/([\w./-]+)"/g;
    const broken: string[] = [];
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean)
        .map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim());
      const file = readFileSync(CORE_DIR + m[2], "utf8");
      for (const n of names) {
        const found = new RegExp(
          `export\\s+(async\\s+)?(function|const|let|class|type|interface|enum)\\s+${n}\\b` +
          `|export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`,
        ).test(file);
        if (!found) broken.push(`${m[2]}::${n}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("os módulos do core existem no disco", () => {
    expect(readdirSync(CORE_DIR)).toContain("ActionPlanner.ts");
  });
});

describe("Canonical webhook identity", () => {
  it("URL com ?t=SECRET é a MESMA rota da base e autentica", () => {
    const id = compareWebhookIdentity(hook(`${BASE}?t=${SECRET}`), BASE, SECRET);
    expect(id).toEqual({ routeValid: true, authValid: true, eventsValid: true });
  });

  it("trailing slash não gera mismatch", () => {
    const id = compareWebhookIdentity(hook(`${BASE}/?t=${SECRET}`), BASE, SECRET);
    expect(id.routeValid).toBe(true);
  });

  it("header X-Webhook-Secret também autentica", () => {
    const id = compareWebhookIdentity(
      hook(BASE, EVENTS, [{ name: "X-Webhook-Secret", value: SECRET }]),
      BASE,
      SECRET,
    );
    expect(id.authValid).toBe(true);
  });

  it("secret errado ⇒ não autenticado", () => {
    const id = compareWebhookIdentity(hook(`${BASE}?t=wrong`), BASE, SECRET);
    expect(id.routeValid).toBe(true);
    expect(id.authValid).toBe(false);
  });

  it("pathname errado ⇒ rota inválida", () => {
    const id = compareWebhookIdentity(
      hook(`https://proj.supabase.co/functions/v1/other-fn?t=${SECRET}`),
      BASE,
      SECRET,
    );
    expect(id.routeValid).toBe(false);
  });

  it("eventos incompletos ⇒ inválido", () => {
    const id = compareWebhookIdentity(hook(`${BASE}?t=${SECRET}`, ["message"]), BASE, SECRET);
    expect(id.eventsValid).toBe(false);
  });
});

describe("Safe self-healing", () => {
  const base = {
    configured: true,
    authOk: true,
    sessionExists: true,
    sessionStatus: "FAILED",
    webhookCode: "webhook_mismatch",
    lastRepairAt: null as string | null,
  };

  it("não repara quando o webhook está ok", () => {
    expect(decideSelfHeal({ ...base, webhookCode: "ok" }).shouldRepair).toBe(false);
  });

  it("nunca repara em STARTING", () => {
    const d = decideSelfHeal({ ...base, sessionStatus: "STARTING" });
    expect(d).toEqual({ shouldRepair: false, reason: "transient_state" });
  });

  it("nunca repara em SCAN_QR_CODE", () => {
    expect(decideSelfHeal({ ...base, sessionStatus: "SCAN_QR_CODE" }).reason).toBe("transient_state");
  });

  it("cooldown impede dois PUTs consecutivos", () => {
    const now = Date.parse("2026-08-07T12:00:00Z");
    const first = decideSelfHeal({ ...base, nowMs: now });
    expect(first.shouldRepair).toBe(true);
    const second = decideSelfHeal({
      ...base,
      lastRepairAt: new Date(now).toISOString(),
      nowMs: now + 60_000,
    });
    expect(second).toEqual({ shouldRepair: false, reason: "cooldown_active" });
  });

  it("self-heal verdadeiro: revalidação saudável ⇒ webhook_repaired", () => {
    expect(classifyRepairOutcome({
      mutationOk: true,
      revalidatedWebhookCode: "ok",
      revalidatedSessionStatus: "WORKING",
    })).toEqual({ outcome: "webhook_repaired", healthy: true });
  });

  it("falso repair: PUT 2xx mas pós-validação falha ⇒ webhook_repair_failed", () => {
    expect(classifyRepairOutcome({
      mutationOk: true,
      revalidatedWebhookCode: "webhook_mismatch",
      revalidatedSessionStatus: "STARTING",
    })).toEqual({ outcome: "webhook_repair_failed", healthy: false });
  });
});
