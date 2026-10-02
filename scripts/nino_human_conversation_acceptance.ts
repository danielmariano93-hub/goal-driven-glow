import { interpretWithSingleSemanticAuthorityV3 } from "../supabase/functions/_shared/agent/v3/SemanticAuthorityV3.ts";

type C = {name:string;text:string,check:(t:any)=>string|null};
const cases:C[]=[
{name:"01_social_open",text:"Oi Nino, tudo bem? Tô tentando entender melhor meus gastos hoje.",check:t=>t?.kind==="conversation"?null:"expected_conversation"},
{name:"02_total_period",text:"Me fala quanto eu gastei semana passada, do dia 21 ao dia 27.",check:t=>fq(t,"expense_amount","sum")||period(t,/21.*27|dia 21.*27/i)},
{name:"03_why",text:"Isso foi muito? O que mais pesou?",check:t=>t?.kind==="task"?null:"expected_contextual_task"},
{name:"04_follow_previous_month",text:"E no mês passado, como ficou?",check:t=>t?.act==="follow_up"||t?.act==="new_request"?fq(t,"expense_amount",null):"expected_follow_up"},
{name:"05_category_switch",text:"Tá. Agora olha só Lazer pra mim.",check:t=>category(t,"lazer")},
{name:"06_monthly",text:"Quero entender a evolução disso mês a mês nos últimos 4 meses.",check:t=>trendMonth(t)||category(t,"lazer")},
{name:"07_chart_reference",text:"Boa. Mostra isso em gráfico.",check:t=>t?.act==="follow_up"&&t?.inherit_topic?null:"expected_chart_followup"},
{name:"08_casual",text:"Caramba, eu não tinha percebido isso.",check:t=>t?.kind==="conversation"?null:"expected_natural_conversation"},
{name:"09_guidance",text:"O que você acha que eu deveria observar aqui?",check:t=>t?.kind==="task"&&t.tasks.some((x:any)=>x.kind==="advisory")?null:"expected_advisory"},
{name:"10_topic_switch_debt",text:"Mudando de assunto: quais dívidas eu ainda tenho?",check:t=>fq(t,"debt_balance",null)},
{name:"11_debt_reference",text:"E dessa maior aí, quanto falta pagar?",check:t=>t?.references?.some((r:any)=>r.target==="debt")||fq(t,"debt_balance",null)?null:"missing_debt_reference"},
{name:"12_write_draft",text:"Beleza. Registra R$ 300 de pagamento nela hoje.",check:t=>write(t,"debt.pay")},
{name:"13_repair",text:"Opa, não confirma ainda. Na verdade foram R$ 250.",check:t=>t?.act==="repair"||write(t,"debt.pay")===null?null:"expected_repair"},
{name:"14_cancel",text:"Pensando bem, deixa pra lá. Não registra nada.",check:t=>["conversation","task"].includes(t?.kind)?null:"expected_cancel_understanding"},
{name:"15_return_topic",text:"Voltando pro Lazer: qual daqueles quatro meses foi o pior?",check:t=>t?.kind==="task"?null:"expected_return_to_prior_topic"},
{name:"16_close",text:"Valeu, Nino. Depois a gente continua.",check:t=>t?.kind==="conversation"?null:"expected_conversation_close"},
];
function task(t:any,k:string){return t?.kind==="task"?t.tasks.find((x:any)=>x.kind===k):null}
function fq(t:any,m:string,o:string|null){const x=task(t,"financial_query"); if(!x)return "missing_financial_query"; if(x.metric!==m)return "metric="+x.metric; if(o&&x.operation!==o)return "operation="+x.operation; return null}
function period(t:any,re:RegExp){const x=task(t,"financial_query"); return x?.periods?.some((p:any)=>re.test(String(p.value)))?null:"period="+JSON.stringify(x?.periods??[])}
function category(t:any,c:string){const x=task(t,"financial_query");const v=x?.filters?.find((f:any)=>f.field==="category")?.entity?.value;return String(v??"").toLowerCase()===c?null:"category="+String(v)}
function trendMonth(t:any){const x=task(t,"financial_query");return x?.operation==="trend"&&x?.group_by?.includes("month")?null:"not_monthly_trend"}
function write(t:any,a:string){const x=task(t,"financial_write");return x?.action===a?null:"write="+String(x?.action)}

let history:string[]=[]; let context:any={conversation_state:{current_topic:null,active_category:null,active_period:null,active_references:[]}};
let failed=0;
for(const c of cases){
 const out=await interpretWithSingleSemanticAuthorityV3({text:c.text,history_text:history.slice(-10).join("\n"),context_text:JSON.stringify(context)});
 const err=out.turn?c.check(out.turn):String(out.telemetry.error??"no_turn");
 if(err)failed++;
 console.log(JSON.stringify({test:c.name,input:c.text,ok:!err,error:err,tier:out.tier,review:out.review_match,turn:out.turn,telemetry:{model:out.telemetry.model,calls:out.telemetry.llm_calls,tokens_in:out.telemetry.tokens_in,tokens_out:out.telemetry.tokens_out}}));
 history.push("Usuário: "+c.text);
 if(out.turn?.kind==="conversation") history.push("Nino: "+out.turn.direct_reply);
 else if(out.turn?.kind==="clarification") history.push("Nino: "+out.turn.question);
 else if(out.turn?.kind==="task") {
   history.push("Nino: [pedido compreendido e encaminhado conforme o contrato semântico]");
   const q=out.turn.tasks.find((x:any)=>x.kind==="financial_query");
   const cat=q?.filters?.find((f:any)=>f.field==="category")?.entity?.value;
   if(cat) context.conversation_state.active_category=cat;
   if(q?.periods?.length) context.conversation_state.active_period=q.periods[q.periods.length-1];
   const ref=out.turn.references?.[0]; if(ref) context.conversation_state.active_references=[ref];
   context.conversation_state.current_topic=out.turn.canonical_request;
 }
 await new Promise(r=>setTimeout(r,4500));
}
console.log(JSON.stringify({summary:{total:cases.length,passed:cases.length-failed,failed}}));
if(failed) Deno.exit(1);
