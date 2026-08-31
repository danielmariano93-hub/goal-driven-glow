import { it } from "vitest";
import { categorySpendInPeriod } from "../lib/engine/goalPerformanceAssessment";
import { reportingCompetenceDate, isRealMonthlyMovement, effectiveCategoryId, buildRefundAttribution } from "../lib/engine/facts";
function tx(over:any){return {id:Math.random().toString(),user_id:"u1",account_id:"a1",category_id:"c1",type:"expense",status:"confirmed",amount:100,occurred_at:"2026-08-05",description:"c",transfer_group_id:null,payment_method:"account",credit_card_id:null,competence_date:null,settles_card_id:null,movement_kind:"transaction",refund_of_transaction_id:null,posted_at:null,posted_at_source:null,...over};}
it("dbg",()=>{
 const a=tx({amount:250,occurred_at:"2026-07-30",competence_date:"2026-08-01",payment_method:"credit_card",credit_card_id:"cc1"});
 const b=tx({amount:100,occurred_at:"2026-08-10"});
 const attr=buildRefundAttribution([a,b] as any);
 for(const t of [a,b]) console.log(t.amount, reportingCompetenceDate(t as any), isRealMonthlyMovement(t as any), effectiveCategoryId(t as any, attr));
 console.log(categorySpendInPeriod([a,b] as any,"c1",{from:"2026-08-01",to:"2026-08-20"}));
});
