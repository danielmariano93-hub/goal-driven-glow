import { it } from "vitest";
import { computeGoalPerformanceAssessment } from "../lib/engine/goalPerformanceAssessment";
import { isRealMonthlyMovement } from "../lib/engine/facts";
const GOAL:any = { id:"g1",user_id:"u1",category_id:"c1",mode:"fixed",fixed_limit:800,frequency:"monthly",period_type:"calendar_month",start_date:"2026-08-01",end_date:null,status:"active",timezone:"America/Sao_Paulo" };
function tx(over:any){return {id:Math.random().toString(),user_id:"u1",account_id:"a1",category_id:"c1",type:"expense",status:"confirmed",amount:100,occurred_at:"2026-08-05",description:"c",transfer_group_id:null,payment_method:"account",credit_card_id:null,competence_date:null,settles_card_id:null,movement_kind:"transaction",refund_of_transaction_id:null,posted_at:null,posted_at_source:null,...over};}
it("dbg",()=>{
 const a=tx({amount:250,occurred_at:"2026-07-30",competence_date:"2026-08-01",payment_method:"credit_card",credit_card_id:"cc1"});
 const b=tx({amount:100,occurred_at:"2026-08-10"});
 console.log("real",isRealMonthlyMovement(a as any),isRealMonthlyMovement(b as any));
 const r=computeGoalPerformanceAssessment({goals:[GOAL],txs:[a,b] as any,categoryNameById:{c1:"X"},today:new Date("2026-08-20T12:00:00"),comparison:{from:"2026-07-01",to:"2026-07-20"}});
 console.log(JSON.stringify(r.categories[0],null,1));
});
