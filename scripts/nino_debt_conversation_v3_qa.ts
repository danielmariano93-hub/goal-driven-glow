import { interpretWithSingleSemanticAuthorityV3 } from "../supabase/functions/_shared/agent/v3/SemanticAuthorityV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../supabase/functions/_shared/agent/v3/TurnSpecV3.ts";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const history:Array<{role:"user"|"assistant";content:string}>=[];
let context:any={conversation_state:{current_topic:"financial:expense_amount",conversation_summary:null,active_category:"Lazer",active_merchant:null,active_period:{label:"últimos 4 meses"},comparison_period:null,awaiting:null,pending_conversation_action:null,last_tool_context:{tool:"spending_timeseries_monthly"},last_analysis:{metric:"expense_amount",operation:"trend",category:"Lazer"},active_references:[]},workflow:null};
function h(){return history.map(x=>`${x.role==="user"?"Usuário":"Nino"}: ${x.content}`).join("\n")}
function first(t:TurnSpecV3|null){return t?.kind==="task"?t.tasks[0]:null}
function summary(t:TurnSpecV3|null){if(!t)return"NULL";if(t.kind==="conversation")return`conversation act=${t.act} reply=${t.direct_reply}`;if(t.kind==="clarification")return`clarification ${t.question}`;return `${t.tasks.map(x=>x.kind==="financial_query"?`query:${x.metric}/${x.operation}`:x.kind==="financial_write"?`write:${x.action}:${JSON.stringify(x.slots)}`:x.kind).join("+")} refs=${JSON.stringify(t.references)}`}
const cases=[
 {u:"Agora mudando de assunto: quais dívidas eu tenho?",ok:(t:TurnSpecV3|null)=>{const q=first(t);return q?.kind==="financial_query"&&q.metric==="debt_balance"},reply:"Você tem uma dívida ativa: Empréstimo Lucas, saldo R$ 1.200,00.",after:()=>{context={...context,conversation_state:{...context.conversation_state,current_topic:"debt:Empréstimo Lucas",active_category:null,active_period:null,last_tool_context:{tool:"get_debt_status"},last_analysis:{metric:"debt_balance",operation:"value"},active_references:[{target:"debt",entity_labels:["Empréstimo Lucas"],source_tool:"get_debt_status",query_id:"qa-debt-1"}]}}}},
 {u:"Quanto falta pagar dessa e quando vence a próxima parcela?",ok:(t:TurnSpecV3|null)=>{const q=first(t);return q?.kind==="financial_query"&&q.metric==="debt_balance"&&t?.references.some(r=>r.target==="debt")===true},reply:"Faltam R$ 1.200,00. A próxima parcela é de R$ 300,00 e vence em 10/10."},
 {u:"Paguei 300 dela hoje.",ok:(t:TurnSpecV3|null)=>{const q=first(t);return q?.kind==="financial_write"&&q.action==="debt.pay"&&String(q.slots.amount)==="300"&&t?.references.some(r=>r.target==="debt")===true},reply:"Vou preparar esse pagamento para confirmação."}
];
let passed=0;
for(let i=0;i<cases.length;i++){
 const c=cases[i]; history.push({role:"user",content:c.u});
 const out=await interpretWithSingleSemanticAuthorityV3({text:c.u,history_text:h(),context_text:JSON.stringify(context)});
 const bridge=out.turn?bridgeTurnSpecV3ToRuntime(out.turn):null; const ok=c.ok(out.turn); if(ok)passed++;
 console.log(JSON.stringify({turn:i+1,user:c.u,pass:ok,tier:out.tier,error:out.telemetry.error,review_required:out.review_required,review_match:out.review_match,semantic:summary(out.turn),bridge_ok:bridge?.ok??null,bridge_errors:bridge&&!bridge.ok?bridge.errors:[]}));
 history.push({role:"assistant",content:c.reply}); c.after?.(); if(i<cases.length-1)await sleep(40000);
}
console.log(JSON.stringify({summary:{total:cases.length,passed,failed:cases.length-passed}})); if(passed!==cases.length)Deno.exit(1);
