import { describe, it } from "vitest";
import { computeDebtStatus, buildDebtSchedule } from "@/lib/engine/debtStatus";
const debt: any = { id:"d1", name:"Banco Sim", status:"active", due_day:4, installment_amount:97.06, installments_total:12, installments_paid:1, outstanding_balance:1067.66, first_due_date:null, start_date:null };
const pay: any = [{ debt_id:"d1", paid_at:"2026-09-02", amount:97.06, installments_covered:1 }];
describe("bancosim", () => { it("x", () => {
  const r = computeDebtStatus({ debts:[debt], payments:pay, today:"2026-09-02" });
  console.log(JSON.stringify(r.breakdown, null, 1));
  console.log(JSON.stringify(buildDebtSchedule(debt, pay, "2026-09-02").next_due_date));
});});
