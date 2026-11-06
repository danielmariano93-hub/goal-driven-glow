import { describe, expect, it } from "vitest";
import { normalizeSeverity, qualifiesAsCritical } from "../../supabase/functions/_shared/proactive/severity";

const base = { communication_kind: "spending_goal_pressure", impact_amount: 26, days_until: 2, severity: "critical", evidence: {} } as any;

describe("nino_severity.v1", () => {
  it("meta com impacto de R$ 26 e renda de R$ 5.000 deixa de ser crítica, mesmo no fim do período", () => {
    const out = normalizeSeverity(base, 5000);
    expect(out.severity).toBe("attention");
    expect(out.evidence.severity_downgraded).toBe("below_5pct_income");
  });
  it("impacto >= 5% da renda continua crítico", () => {
    expect(normalizeSeverity({ ...base, impact_amount: 250 }, 5000).severity).toBe("critical");
    expect(normalizeSeverity({ ...base, impact_amount: 249.99 }, 5000).severity).toBe("attention");
  });
  it("vencimento em até 3 dias (pilar Proteger) e atraso continuam críticos", () => {
    expect(qualifiesAsCritical({ communication_kind: "bill_due_reminder", impact_amount: 30, days_until: 3 }, 5000)).toBe(true);
    expect(qualifiesAsCritical({ communication_kind: "bill_due_reminder", impact_amount: 30, days_until: 4 }, 5000)).toBe(false);
    expect(qualifiesAsCritical({ communication_kind: "debt_overdue", impact_amount: 10, days_until: null }, 5000)).toBe(true);
  });
  it("sem renda conhecida não rebaixa", () => {
    expect(normalizeSeverity(base, 0).severity).toBe("critical");
  });
  it("não mexe no que não é crítico", () => {
    const a = { ...base, severity: "attention" };
    expect(normalizeSeverity(a, 5000)).toBe(a);
  });
});
