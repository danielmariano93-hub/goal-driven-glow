import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";
const model=Deno.env.get("NINO_AI_MODEL")??"openai/gpt-oss-120b";
type Check=(turn:any)=>string|null;
const cases:{name:string;text:string;history?:string;context?:string;check:Check}[]=[
{name:"01_debt_partial_payment",text:"Paguei R$ 300 da dívida do Lucas hoje.",check:t=>write(t,"debt.pay")},
{name:"02_debt_full_payment",text:"Quita a dívida do Lucas inteira.",check:t=>write(t,"debt.pay")},
{name:"03_debt_reference",text:"Quanto falta pagar dessa dívida?",history:"Usuário: Quanto falta da dívida do Lucas?\nNino: A dívida do Lucas ainda está em aberto.",context:JSON.stringify({conversation_state:{active_references:[{target:"debt",label:"dívida do Lucas"}]}}),check:t=>hasDebtRef(t)},
{name:"04_transaction_create",text:"Registra R$ 89,90 de Uber hoje no meu cartão de crédito.",check:t=>write(t,"transaction.create")},
{name:"05_transaction_update",text:"Corrige o último Uber para R$ 79,90.",check:t=>write(t,"transaction.update")},
{name:"06_transaction_delete",text:"Apaga o último lançamento de Uber.",check:t=>write(t,"transaction.delete")},
{name:"07_goal_create_contribute",text:"Cria uma meta Viagem de R$ 10 mil até dezembro e já coloca R$ 500 nela.",check:t=>writes(t,["goal.create","goal.contribute"])},
{name:"08_goal_update",text:"Altera a meta Viagem para R$ 12 mil.",check:t=>write(t,"goal.update")},
{name:"09_goal_delete",text:"Exclui a meta Viagem.",check:t=>write(t,"goal.delete")},
{name:"10_category_create",text:"Cria uma categoria chamada Pets.",check:t=>write(t,"category.create")},
{name:"11_category_update",text:"Renomeia a categoria Pets para Animais.",check:t=>write(t,"category.update")},
{name:"12_category_delete",text:"Exclui a categoria Animais.",check:t=>write(t,"category.delete")},
{name:"13_split_receive",text:"O Lucas me pagou R$ 120 da divisão do jantar.",check:t=>write(t,"split.receive")},
{name:"14_recurring_create",text:"Todo dia 10 lança R$ 199,90 de academia como gasto recorrente.",check:t=>write(t,"recurring.create")},
{name:"15_recurring_update",text:"Muda a recorrência da academia para R$ 219,90.",check:t=>write(t,"recurring.update")},
{name:"16_recurring_delete",text:"Cancela a recorrência da academia.",check:t=>write(t,"recurring.delete")},
{name:"17_explicit_override",text:"E em Lazer? Quanto eu gastei esse mês?",history:"Usuário: Quanto eu gastei em Alimentação?\nNino: Alimentação ficou abaixo da referência.",context:JSON.stringify({conversation_state:{current_topic:"categoria:Alimentação",active_category:"Alimentação"}}),check:t=>financialCategory(t,"lazer")},
{name:"18_temporal_followup",text:"E no mês passado?",history:"Usuário: Quanto eu gastei em Alimentação este mês?\nNino: Você gastou na categoria Alimentação.",context:JSON.stringify({conversation_state:{current_topic:"categoria:Alimentação",active_category:"Alimentação",active_period:{label:"este mês"}}}),check:t=>financialPeriod(t,/passad/i)},
{name:"19_monthly_trend",text:"Quanto gastei com Alimentação por mês nos últimos 5 meses?",check:t=>financialTrend(t)},
{name:"20_goals_overview",text:"Quais metas eu tenho?",check:t=>goalOverview(t)},
{name:"21_debt_overpayment_semantics",text:"Paguei R$ 50.000 da dívida do Lucas.",check:t=>write(t,"debt.pay")},
{name:"22_no_silent_recurring_downgrade",text:"A partir de agora, todo mês no dia 5 registre R$ 120 de internet.",check:t=>write(t,"recurring.create")},
];
function task(t:any,k:string){return t?.kind==="task"?t.tasks?.find((x:any)=>x.kind===k):null}
function write(t:any,a:string){const x=task(t,"financial_write");return x?.action===a?null:`expected ${a}, got ${x?.action??t?.kind??"null"}`}
function writes(t:any,as:string[]){if(t?.kind!=="task")return "not_task";const got=t.tasks.filter((x:any)=>x.kind==="financial_write").map((x:any)=>x.action);return as.every(a=>got.includes(a))?null:`expected ${as.join("+")}, got ${got.join("+")}`}
function hasDebtRef(t:any){return t?.references?.some((r:any)=>r.target==="debt")?null:"missing_debt_reference"}
function financialCategory(t:any,c:string){const x=task(t,"financial_query");const v=x?.filters?.find((f:any)=>f.field==="category")?.entity?.value;return String(v??"").toLowerCase()===c?null:`category=${v??"null"}`}
function financialPeriod(t:any,re:RegExp){const x=task(t,"financial_query");return x?.periods?.some((p:any)=>re.test(p.value))?null:`periods=${JSON.stringify(x?.periods??[])}`}
function financialTrend(t:any){const x=task(t,"financial_query");return x?.metric==="expense_amount"&&x?.operation==="trend"&&x?.group_by?.includes("month")?null:`financial=${JSON.stringify(x)}`}
function goalOverview(t:any){const x=task(t,"goal_query");return x?.operation==="overview"?null:`goal=${JSON.stringify(x)}`}
let failed=0;
for(const c of cases){
 const o=await interpretSemanticTurnV3({text:c.text,history_text:c.history??"",context_text:c.context??"",model});
 let err=o.turn?c.check(o.turn):`provider_or_contract:${o.telemetry.error??"missing_turn"}`;
 let bridge:any=null;
 if(!err&&o.turn?.kind==="task"){bridge=bridgeTurnSpecV3ToRuntime(o.turn); if(!bridge.ok) err=`bridge:${bridge.errors?.join(",")}`;}
 const ok=!err; if(!ok)failed++;
 console.log(JSON.stringify({test:c.name,ok,error:err,turn:o.turn,telemetry:o.telemetry}));
 await new Promise(r=>setTimeout(r,4500));
}
console.log(JSON.stringify({summary:{total:cases.length,passed:cases.length-failed,failed,model}}));
if(failed)Deno.exit(1);
