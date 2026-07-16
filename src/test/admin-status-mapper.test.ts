import { describe, it, expect } from "vitest";
import { mapWhatsAppStatus, mapAgentStatus, mapJobStatus } from "@/lib/admin/statusMapper";
import { mapAdminError, mapAdminActionError } from "@/lib/admin/errorMapper";

describe("admin statusMapper", () => {
  it("never returns raw UNKNOWN label", () => {
    expect(mapWhatsAppStatus("UNKNOWN").label).not.toMatch(/UNKNOWN/i);
    expect(mapAgentStatus("UNKNOWN").label).not.toMatch(/UNKNOWN/i);
    expect(mapJobStatus("UNKNOWN").label).not.toMatch(/UNKNOWN/i);
  });

  it("maps whatsapp codes to portuguese labels", () => {
    expect(mapWhatsAppStatus("connected").label).toBe("Conectado");
    expect(mapWhatsAppStatus("awaiting_qr").label).toContain("QR");
    expect(mapWhatsAppStatus("not_configured").tone).toBe("neutral");
    expect(mapWhatsAppStatus(null).label).toBeTruthy();
    expect(mapWhatsAppStatus(undefined).label).toBeTruthy();
  });

  it("maps agent + job codes", () => {
    expect(mapAgentStatus("working").tone).toBe("success");
    expect(mapAgentStatus("not_setup").tone).toBe("neutral");
    expect(mapJobStatus("failing").tone).toBe("danger");
    expect(mapJobStatus("not_scheduled").label).toContain("ativada");
  });
});

describe("admin errorMapper", () => {
  it("never surfaces raw error.message", () => {
    const raw = "supabase: permission denied for function admin_secret_x";
    const fe = mapAdminError(new Error(raw));
    expect(fe.title).not.toContain(raw);
    expect(fe.title).not.toContain("permission");
    expect(fe.code).toMatch(/^[A-Z]{2}\d+-\d+$/);
  });

  it("action errors also carry a code", () => {
    const fe = mapAdminActionError({ message: "WAHA_API_KEY missing" });
    expect(fe.title).not.toContain("WAHA");
    expect(fe.code).toBeTruthy();
  });
});
