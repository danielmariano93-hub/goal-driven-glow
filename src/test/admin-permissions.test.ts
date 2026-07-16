import { describe, it, expect } from "vitest";
import { can, roleLabel } from "@/lib/admin/permissions";

describe("platform permissions", () => {
  it("platform_owner can do everything critical", () => {
    expect(can("platform_owner", "security.manage_admins")).toBe(true);
    expect(can("platform_owner", "settings.critical")).toBe(true);
    expect(can("platform_owner", "company_finance.write")).toBe(true);
    expect(can("platform_owner", "whatsapp.critical")).toBe(true);
  });

  it("platform_admin cannot manage admins or change critical settings", () => {
    expect(can("platform_admin", "security.manage_admins")).toBe(false);
    expect(can("platform_admin", "settings.critical")).toBe(false);
    expect(can("platform_admin", "company_finance.write")).toBe(true);
    expect(can("platform_admin", "whatsapp.critical")).toBe(true);
  });

  it("support cannot touch company finance or whatsapp critical actions", () => {
    expect(can("support", "company_finance.read")).toBe(false);
    expect(can("support", "company_finance.write")).toBe(false);
    expect(can("support", "whatsapp.critical")).toBe(false);
    expect(can("support", "users.read")).toBe(true);
    expect(can("support", "users.suspend")).toBe(true);
    expect(can("support", "users.process_deletion")).toBe(false);
  });

  it("analyst is read-only across dashboards", () => {
    expect(can("analyst", "overview.read")).toBe(true);
    expect(can("analyst", "company_finance.read")).toBe(true);
    expect(can("analyst", "company_finance.write")).toBe(false);
    expect(can("analyst", "users.suspend")).toBe(false);
    expect(can("analyst", "agent.write")).toBe(false);
    expect(can("analyst", "security.manage_admins")).toBe(false);
  });

  it("null/undefined role has no permission", () => {
    expect(can(null, "overview.read")).toBe(false);
    expect(can(undefined, "users.read")).toBe(false);
  });

  it("labels are localized", () => {
    expect(roleLabel("platform_owner")).toBe("Platform Owner");
    expect(roleLabel("support")).toBe("Suporte");
    expect(roleLabel(null)).toBe("Sem acesso");
  });
});
