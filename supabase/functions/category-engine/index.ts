import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { streamText, Output, NoObjectGeneratedError } from "npm:ai";
import { z } from "npm:zod";
import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";
import { getAiBlock, pauseAiCircuit } from "../_shared/aiCircuit.ts";
import { recordAiUsage, estimateAiCostUsd, type AiWorkload } from "../_shared/aiUsageLedger.ts";
import { ensureWorkloadAllowed, pauseWorkloadCircuit } from "../_shared/aiWorkloadBudget.ts";
import {
  CATEGORY_ENGINE_VERSION, classifyWithContext, loadCategorizationContext, resultFromLlm,
  type ClassificationInput, type ClassificationResult,
} from "../_shared/categorization/engine.ts";
import { normalizedPattern } from "../_shared/categorization/normalize.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const LOVABLE_API_KEY=Deno.env.get("LOVABLE_API_KEY")??"";
const CRON_SECRET=Deno.env.get("INTERNAL_CRON_SECRET")??Deno.env.get("CRON_SECRET")??"";
const MODEL="google/gemini-3.6-flash";

const InputSchema=z.object({transaction_id:z.string().nullish(),type:z.enum(["income","expense","transfer"]),description:z.string().nullish(),explicit_category:z.string().nullish(),movement_kind:z.string().nullish(),transfer_group_id:z.string().nullish(),settles_card_id:z.string().nullish(),shared_expense_id:z.string().nullish()});
const BodySchema=z.object({operation:z.enum(["classify","classify_batch","learn","review_status","process_queue","process_queue_global","backfill","backfill_global"]),input:InputSchema.optional(),inputs:z.array(InputSchema).optional(),transaction_id:z.string().optional(),category_id:z.string().optional(),limit:z.number().int().min(1).max(500).optional()});
const LlmSchema=z.object({items:z.array(z.object({index:z.number(),category_id:z.string().nullable(),confidence:z.number()}))});
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
async function sha256Hex(value:string):Promise<string>{const data=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",data);return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2,"0")).join("");}
function compactEvidence(input:ClassificationInput){return {type:input.type,merchant_key:normalizedPattern(input.description),description:String(input.description??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().slice(0,160),movement_kind:input.movement_kind??"transaction",transfer_group_id:input.transfer_group_id??null,settles_card_id:input.settles_card_id??null,shared_expense_id:input.shared_expense_id??null,engine_version:CATEGORY_ENGINE_VERSION};}
async function evidenceHash(userId:string,input:ClassificationInput):Promise<string>{return sha256Hex(JSON.stringify({user_id:userId,transaction_id:input.transaction_id??null,...compactEvidence(input)}));}
async function promptHash(payload:unknown):Promise<string>{return sha256Hex(JSON.stringify(payload));}
function workloadFor(mode:string):AiWorkload{return mode==="background"?"CATEGORY_BACKGROUND":"CATEGORY_ONDEMAND";}

async function classifyBatchDeterministic(admin:ReturnType<typeof createClient>,userId:string,inputs:ClassificationInput[]):Promise<ClassificationResult[]>{
  const types=[...new Set(inputs.map(i=>i.type).filter(t=>t==="income"||t==="expense"))] as Array<"income"|"expense">;
  const contexts=new Map<"income"|"expense",Awaited<ReturnType<typeof loadCategorizationContext>>>();
  for(const type of types){
    const keys=inputs.filter(i=>i.type===type).map(i=>String(i.description??""));
    contexts.set(type,await loadCategorizationContext(admin,userId,type,keys));
  }
  return inputs.map(input=>{
    if(input.type!=="income"&&input.type!=="expense") return {category_id:null,category_source:"none",category_confidence:0,category_reason:"movimento contábil excluído da categorização de consumo",action:"exclude",reason_code:"non_consumption_movement",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
    const context=contexts.get(input.type);
    if(!context)return {category_id:null,category_source:"none",category_confidence:0,category_reason:"contexto de categorias indisponível",action:"leave_unresolved",reason_code:"context_unavailable",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
    return classifyWithContext(input,context);
  });
}

async function hasTerminalAttempt(admin:ReturnType<typeof createClient>,userId:string,input:ClassificationInput,hash:string){
  if(!input.transaction_id)return false;
  const {data,error}=await admin.from("category_classification_attempts")
    .select("id,status")
    .eq("user_id",userId).eq("transaction_id",input.transaction_id).eq("evidence_hash",hash).eq("engine_version",CATEGORY_ENGINE_VERSION)
    .in("status",["resolved","suggested","needs_review_until_new_evidence"]).maybeSingle();
  if(error)throw error;
  return Boolean(data);
}

async function getCachedInference(admin:ReturnType<typeof createClient>,userId:string,input:ClassificationInput,semanticHash:string){
  if(input.type!=="income"&&input.type!=="expense")return null;
  const merchantKey=normalizedPattern(input.description);
  if(!merchantKey||merchantKey.length<3)return null;
  const {data,error}=await admin.from("category_ai_inference_cache")
    .select("category_id,confidence,status,reason,prompt_hash")
    .eq("user_id",userId).eq("transaction_type",input.type).eq("merchant_key",merchantKey)
    .eq("semantic_context_hash",semanticHash).eq("engine_version",CATEGORY_ENGINE_VERSION)
    .gt("expires_at",new Date().toISOString()).maybeSingle();
  if(error)throw error;
  return data as {category_id:string|null;confidence:number;status:string;reason:string|null;prompt_hash:string|null}|null;
}

async function upsertCachedInference(admin:ReturnType<typeof createClient>,userId:string,input:ClassificationInput,semanticHash:string,cache:{category_id:string|null;confidence:number;status:string;reason?:string|null;prompt_hash?:string|null;model?:string|null;input_tokens?:number;output_tokens?:number;estimated_cost_usd?:number|null}){
  if(input.type!=="income"&&input.type!=="expense")return;
  const merchantKey=normalizedPattern(input.description);
  if(!merchantKey||merchantKey.length<3)return;
  const ttlDays=cache.status==="suggested"?180:90;
  await admin.from("category_ai_inference_cache").upsert({
    user_id:userId,transaction_type:input.type,merchant_key:merchantKey,semantic_context_hash:semanticHash,engine_version:CATEGORY_ENGINE_VERSION,
    prompt_hash:cache.prompt_hash??null,model:cache.model??MODEL,category_id:cache.category_id,confidence:cache.confidence,status:cache.status,reason:cache.reason??null,
    input_tokens:cache.input_tokens??0,output_tokens:cache.output_tokens??0,estimated_cost_usd:cache.estimated_cost_usd??null,
    expires_at:new Date(Date.now()+ttlDays*24*60*60_000).toISOString(),metadata:{source:"category-engine"}
  },{onConflict:"user_id,transaction_type,merchant_key,semantic_context_hash,engine_version"});
}

async function inferWithAi(admin:ReturnType<typeof createClient>,userId:string,inputs:ClassificationInput[],results:ClassificationResult[],mode:"background"|"ondemand"="ondemand"){
  const workload=workloadFor(mode);
  const unresolvedRaw=results.map((result,index)=>({result,input:inputs[index],index})).filter(x=>x.result.action==="leave_unresolved"&&x.result.category_id===null);
  if(!unresolvedRaw.length)return results;
  const deferEntries=(items: Array<{index:number;result:ClassificationResult}>, reason: string) => {
    for(const item of items){
      results[item.index]={...item.result,action:"preserve",reason_code:reason,category_reason:"adiado para a próxima janela de categorização"};
    }
  };

  const entries: Array<{result:ClassificationResult;input:ClassificationInput;index:number;evidence_hash:string;merchant_key:string;semantic_hash:string;prompt_hash?:string|null}> = [];
  for(const item of unresolvedRaw){
    const merchantKey=normalizedPattern(item.input.description);
    const hash=await evidenceHash(userId,item.input);
    if(!merchantKey||merchantKey.length<3)continue;
    if(await hasTerminalAttempt(admin,userId,item.input,hash))continue;
    const semanticHash=await sha256Hex(JSON.stringify({user_id:userId,type:item.input.type,merchant_key:merchantKey,engine_version:CATEGORY_ENGINE_VERSION}));
    const cached=await getCachedInference(admin,userId,item.input,semanticHash);
    if(cached){
      item.prompt_hash=cached.prompt_hash;
      if(cached.status==="suggested"&&cached.category_id){
        const decision=resultFromLlm({category_id:cached.category_id,confidence:Number(cached.confidence??0)},new Set([cached.category_id]));
        if(decision)results[item.index]=decision;
      }
      continue;
    }
    entries.push({...item,evidence_hash:hash,merchant_key:merchantKey,semantic_hash:semanticHash});
  }
  if(!entries.length)return results;
  if(!LOVABLE_API_KEY){deferEntries(entries,"ai_unconfigured");return results;}
  if(await getAiBlock(admin)){deferEntries(entries,"ai_circuit_blocked");return results;}
  const budget=await ensureWorkloadAllowed(admin,workload);
  if(!budget.allowed){deferEntries(entries,"workload_budget_blocked");return results;}

  const deduped=new Map<string,typeof entries[number]>();
  for(const entry of entries){
    const key=`${entry.input.type}:${entry.merchant_key}:${entry.semantic_hash}`;
    if(!deduped.has(key))deduped.set(key,entry);
  }
  const selected=[...deduped.values()].slice(0,Math.max(1,Math.min(budget.max_items_per_run,25)));
  const selectedByKey=new Map(selected.map((entry)=>[`${entry.input.type}:${entry.merchant_key}:${entry.semantic_hash}`,entry]));
  const deferred=entries.filter((entry)=>!selectedByKey.has(`${entry.input.type}:${entry.merchant_key}:${entry.semantic_hash}`));
  deferEntries(deferred,"budget_deferred");
  const types=[...new Set(selected.map(x=>x.input.type).filter(t=>t==="income"||t==="expense"))] as Array<"income"|"expense">;
  const contexts=await Promise.all(types.map(async type=>[type,await loadCategorizationContext(admin,userId,type,selected.filter(x=>x.input.type===type).map(x=>String(x.input.description??"")))] as const));
  const byType=new Map(contexts);
  const candidates=contexts.flatMap(([type,ctx])=>ctx.candidates.map(category=>({...category,type})));
  const validByType=new Map(types.map(type=>[type,new Set((byType.get(type)?.candidates??[]).map(c=>c.id))]));
  const payload={categories:candidates,items:selected.map(({input,index,merchant_key})=>({index,type:input.type,merchant_key,description:input.description}))};
  const phash=await promptHash(payload);
  const started=Date.now();
  let tokensIn=0,tokensOut=0,httpStatus:number|null=null,success=false,errorCode:string|null=null;
  try{
    const gateway=createLovableAiGatewayProvider(LOVABLE_API_KEY);
    const generation=streamText({model:gateway(MODEL),output:Output.object({schema:LlmSchema}),prompt:`Classifique lançamentos financeiros brasileiros. Use somente category_id listado E do mesmo type do item. Não classifique transferências, pagamento de fatura, investimento ou movimento técnico. Se não houver evidência suficiente, retorne category_id null. A confiança do modelo é apenas evidência para revisão; nunca autoriza auto-apply sozinha. Responda JSON estruturado.\n${JSON.stringify(payload)}`});
    const output=await generation.output;
    const usage=await generation.usage.catch(()=>null);
    tokensIn=Number(usage?.promptTokens??0); tokensOut=Number(usage?.completionTokens??0); success=true;
    const byReturnedIndex=new Map<number,{category_id:string|null;confidence:number}>();
    for(const item of output.items??[])byReturnedIndex.set(Number(item.index),{category_id:item.category_id,confidence:Number(item.confidence??0)});
    for(const entry of selected){
      entry.prompt_hash=phash;
      const item=byReturnedIndex.get(entry.index)??{category_id:null,confidence:0};
      const type=inputs[entry.index]?.type;
      const decision=(type==="income"||type==="expense")?resultFromLlm(item,validByType.get(type)??new Set<string>()):null;
      if(decision&&results[entry.index]?.category_id==null){
        results[entry.index]=decision;
        await upsertCachedInference(admin,userId,entry.input,entry.semantic_hash,{category_id:decision.category_id,confidence:decision.category_confidence,status:"suggested",reason:decision.category_reason,prompt_hash:phash,model:MODEL,input_tokens:tokensIn,output_tokens:tokensOut,estimated_cost_usd:estimateAiCostUsd(MODEL,tokensIn,tokensOut)});
      }else{
        await upsertCachedInference(admin,userId,entry.input,entry.semantic_hash,{category_id:null,confidence:0,status:"needs_review_until_new_evidence",reason:"sem evidência suficiente",prompt_hash:phash,model:MODEL,input_tokens:tokensIn,output_tokens:tokensOut,estimated_cost_usd:estimateAiCostUsd(MODEL,tokensIn,tokensOut)});
      }
      const key=`${entry.input.type}:${entry.merchant_key}:${entry.semantic_hash}`;
      for(const duplicate of entries){
        if(duplicate.index!==entry.index&&`${duplicate.input.type}:${duplicate.merchant_key}:${duplicate.semantic_hash}`===key){
          results[duplicate.index]=results[entry.index];
        }
      }
    }
  }catch(error){
    const maybe=error as {status?:number;body?:string;message?:string;text?:string};
    httpStatus=typeof maybe.status==="number"?maybe.status:null; errorCode=httpStatus?`gateway_${httpStatus}`:"ai_error";
    if(httpStatus===402||httpStatus===403){await pauseAiCircuit(admin,httpStatus,String(maybe.body??""));await pauseWorkloadCircuit(admin,workload,errorCode,{status:httpStatus,requires:httpStatus===402?"top_up":"admin_action"});}
    else if(httpStatus===429){await pauseWorkloadCircuit(admin,workload,"rate_limited",{status:429,requires:"rate_limit",resumeAfter:new Date(Date.now()+15*60_000).toISOString()});}
    deferEntries(selected,errorCode??"ai_error");
    if(NoObjectGeneratedError.isInstance(error))console.warn("[category-engine] invalid structured output",error.text?.slice(0,300));else console.warn("[category-engine] ai fallback",String(error).slice(0,300));
  }finally{
    await recordAiUsage(admin,{workload,function_name:"category-engine",operation:mode==="background"?"process_queue_global":"classify",user_id:userId,model:MODEL,operation_type:"structured_classification",input_tokens:tokensIn,output_tokens:tokensOut,success,http_status:httpStatus,error_code:errorCode,latency_ms:Date.now()-started,batch_size:unresolvedRaw.length,unique_items:selected.length,idempotency_key:phash,reason_for_ai_call:"unresolved_category_semantic_fallback",prompt_hash:phash,payload_bytes:JSON.stringify(payload).length,metadata:{engine_version:CATEGORY_ENGINE_VERSION}});
  }
  return results;
}


const TRUSTED_APPLIED_SOURCES=new Set(["user","personal","alias","history","global","rule"]);

async function persistDecision(admin:ReturnType<typeof createClient>,userId:string,input:ClassificationInput,result:ClassificationResult,mode="live",meta:{evidence_hash?:string|null;prompt_hash?:string|null;ai_attempted?:boolean}={}){
  if(!input.transaction_id)return result;
  const {data:tx,error:txError}=await admin.from("transactions")
    .select("id,user_id,category_id,category_source,type,movement_kind")
    .eq("id",input.transaction_id).eq("user_id",userId).maybeSingle();
  if(txError)throw txError;
  if(!tx)return{...result,action:"preserve"};
  if(result.action==="preserve"){
    await admin.from("category_classification_queue").update({status:"queued",locked_at:null,last_error:result.reason_code,available_at:new Date(Date.now()+10*60_000).toISOString(),next_retry_reason:result.reason_code}).eq("transaction_id",tx.id);
    return result;
  }
  const currentSource=String(tx.category_source??"");
  // Race guard: an explicit/manual or already trusted decision always wins over a queued worker.
  if(tx.category_id&&TRUSTED_APPLIED_SOURCES.has(currentSource)){
    await admin.from("category_classification_queue").update({status:"completed",processed_at:new Date().toISOString(),locked_at:null,last_error:"preserved_trusted_category"}).eq("transaction_id",tx.id);
    return{...result,action:"preserve"};
  }
  if((tx.type==="income"||tx.type==="expense")&&tx.type!==input.type)throw new Error("transaction_type_mismatch");
  const apply=result.action==="auto_apply";
  const semanticHash=meta.evidence_hash??await evidenceHash(userId,input);
  const {data:existingAttempt,error:attemptLookupError}=await admin.from("category_classification_attempts")
    .select("id,status,decision_id")
    .eq("user_id",userId).eq("transaction_id",tx.id).eq("evidence_hash",semanticHash).eq("engine_version",CATEGORY_ENGINE_VERSION)
    .in("status",["resolved","suggested","needs_review_until_new_evidence"]).maybeSingle();
  if(attemptLookupError)throw attemptLookupError;
  if(existingAttempt){
    await admin.from("category_classification_queue").update({status:"completed",processed_at:new Date().toISOString(),locked_at:null,last_error:null,terminal_reason:"terminal_attempt_exists",evidence_hash:semanticHash}).eq("transaction_id",tx.id);
    return result;
  }
  const {data:decision,error}=await admin.from("category_decisions").insert({
    user_id:userId,transaction_id:tx.id,previous_category_id:tx.category_id,decided_category_id:result.category_id,
    source:result.category_source,confidence:result.category_confidence,reason_code:result.reason_code,reason:result.category_reason,
    engine_version:CATEGORY_ENGINE_VERSION,action:result.action,mode,actor:"engine",alternatives:result.alternatives,
    input_fingerprint:semanticHash,evidence_hash:semanticHash,prompt_hash:meta.prompt_hash??null,ai_attempted:Boolean(meta.ai_attempted),
    applied_at:apply?new Date().toISOString():null,
  }).select("id").single();
  if(error)throw error;
  const classifiedAt=new Date().toISOString();
  const patch=apply?{
    category_id:result.category_id,category_source:result.category_source,category_confidence:result.category_confidence,
    category_reason:result.category_reason,category_review_status:"resolved",category_engine_version:CATEGORY_ENGINE_VERSION,
    category_classified_at:classifiedAt,category_decision_id:decision.id,
  }:tx.category_id?{
    // Nunca destruir categoria já existente: uma decisão fraca da máquina só
    // marca revisão. Apagar aqui apagava histórico do usuário nas métricas.
    category_review_status:result.action==="suggest_review"?"suggested":"needs_review_until_new_evidence",
    category_engine_version:CATEGORY_ENGINE_VERSION,category_classified_at:classifiedAt,category_decision_id:decision.id,
  }:{
    category_id:null,category_source:null,category_confidence:null,category_reason:null,
    category_review_status:result.action==="suggest_review"?"suggested":"needs_review_until_new_evidence",
    category_engine_version:CATEGORY_ENGINE_VERSION,category_classified_at:classifiedAt,category_decision_id:decision.id,
  };

  const {error:updateError}=await admin.from("transactions").update(patch).eq("id",tx.id).eq("user_id",userId);
  if(updateError)throw updateError;
  const terminalStatus=apply?"resolved":result.action==="suggest_review"?"suggested":result.action==="exclude"?"resolved":"needs_review_until_new_evidence";
  const {error:attemptError}=await admin.from("category_classification_attempts").upsert({
    user_id:userId,transaction_id:tx.id,evidence_hash:semanticHash,engine_version:CATEGORY_ENGINE_VERSION,status:terminalStatus,action:result.action,source:result.category_source,confidence:result.category_confidence,decision_id:decision.id,prompt_hash:meta.prompt_hash??null,ai_attempted:Boolean(meta.ai_attempted),retryable:false,terminal_reason:terminalStatus==="needs_review_until_new_evidence"?"semantic_unresolved":terminalStatus,metadata:{reason_code:result.reason_code}
  },{onConflict:"transaction_id,evidence_hash,engine_version"});
  if(attemptError)throw attemptError;
  await admin.from("category_classification_queue").update({status:"completed",processed_at:classifiedAt,locked_at:null,last_error:null,evidence_hash:semanticHash,terminal_reason:terminalStatus,last_semantic_attempt_at:classifiedAt,semantic_attempt_count:1}).eq("transaction_id",tx.id);
  return result;
}

type ClaimedRow={queue_id:string;transaction_id:string;user_id:string;type:"income"|"expense";description:string|null;movement_kind:string|null;transfer_group_id:string|null;settles_card_id:string|null;shared_expense_id:string|null;evidence_hash?:string|null};
async function processClaimed(admin:ReturnType<typeof createClient>,rows:ClaimedRow[]){
  const grouped=new Map<string,ClaimedRow[]>(); for(const row of rows){const list=grouped.get(row.user_id)??[];list.push(row);grouped.set(row.user_id,list);}
  let processed=0,failed=0; const errors:Array<{transaction_id:string;error:string}>=[];
  for(const [userId,userRows] of grouped){
    const inputs:ClassificationInput[]=userRows.map(r=>({transaction_id:r.transaction_id,type:r.type,description:r.description,movement_kind:r.movement_kind,transfer_group_id:r.transfer_group_id,settles_card_id:r.settles_card_id,shared_expense_id:r.shared_expense_id}));
    try{
      let results=await classifyBatchDeterministic(admin,userId,inputs); const beforeAi=results.map((r)=>r.action); results=await inferWithAi(admin,userId,inputs,results,"background");
      for(let i=0;i<inputs.length;i++){try{await persistDecision(admin,userId,inputs[i],results[i],"live",{evidence_hash:userRows[i]?.evidence_hash??null,ai_attempted:beforeAi[i]==="leave_unresolved"&&results[i]?.category_source==="llm"});processed++;}catch(error){failed++;const msg=String(error).slice(0,300);errors.push({transaction_id:inputs[i].transaction_id??"",error:msg});await admin.from("category_classification_queue").update({status:"failed",locked_at:null,last_error:msg,available_at:new Date(Date.now()+5*60_000).toISOString(),next_retry_reason:"technical_retry"}).eq("transaction_id",inputs[i].transaction_id);}}
    }catch(error){const msg=String(error).slice(0,300);failed+=userRows.length;for(const r of userRows)errors.push({transaction_id:r.transaction_id,error:msg});await admin.from("category_classification_queue").update({status:"failed",locked_at:null,last_error:msg,available_at:new Date(Date.now()+5*60_000).toISOString(),next_retry_reason:"technical_retry"}).in("transaction_id",userRows.map(r=>r.transaction_id));}
  }
  return{processed,failed,errors:errors.slice(0,50)};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    const parsed=BodySchema.safeParse(await req.json()); if(!parsed.success)return response({error:"Entrada inválida",details:parsed.error.flatten().fieldErrors},400); const body=parsed.data;
    const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false}});
    const cronHeader=req.headers.get("x-cron-secret")??""; const isCron=CRON_SECRET!==""&&cronHeader===CRON_SECRET;
    let userId:string|null=null;
    if(!isCron){const auth=req.headers.get("Authorization")??"";const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:auth}}});const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return response({error:"Não autenticado"},401);userId=user.id;}
    if(body.operation==="process_queue_global"){
      if(!isCron)return response({error:"Não autorizado"},401);
      const {data,error}=await admin.rpc("claim_category_classification_batch",{p_limit:body.limit??100,p_user_id:null}); if(error)throw error;
      const result=await processClaimed(admin,(data??[]) as ClaimedRow[]); return response({ok:true,engine_version:CATEGORY_ENGINE_VERSION,claimed:(data??[]).length,...result});
    }
    if(body.operation==="backfill_global"){
      // Backfill operacional (cron/admin): reenfileira lançamentos elegíveis
      // sem categoria de todos os usuários, com teto por execução.
      if(!isCron)return response({error:"Não autorizado"},401);
      const limit=Math.min(body.limit??300,500);
      const {data:pending,error:pendingError}=await admin.from("transactions")
        .select("id,user_id").eq("status","confirmed").in("type",["income","expense"])
        .is("category_id",null).is("transfer_group_id",null).is("settles_card_id",null)
        .order("occurred_at",{ascending:false}).limit(limit);
      if(pendingError)throw pendingError;
      const rows=(pending??[]) as Array<{id:string;user_id:string}>;
      if(!rows.length)return response({ok:true,enqueued:0,engine_version:CATEGORY_ENGINE_VERSION});
      const {error:upsertError}=await admin.from("category_classification_queue")
        .upsert(rows.map((r)=>({user_id:r.user_id,transaction_id:r.id,status:"queued",locked_at:null,processed_at:null,last_error:null,available_at:new Date().toISOString(),next_retry_reason:"backfill_global"})),{onConflict:"transaction_id"});
      if(upsertError)throw upsertError;
      const {data:claimed,error:claimError}=await admin.rpc("claim_category_classification_batch",{p_limit:Math.min(rows.length,100),p_user_id:null});
      if(claimError)throw claimError;
      const result=await processClaimed(admin,(claimed??[]) as ClaimedRow[]);
      return response({ok:true,enqueued:rows.length,claimed:(claimed??[]).length,...result,engine_version:CATEGORY_ENGINE_VERSION});
    }
    if(!userId)return response({error:"Não autenticado"},401);
    if(body.operation==="review_status"){const {count}=await admin.from("transactions").select("id",{count:"exact",head:true}).eq("user_id",userId).in("category_review_status",["suggested","needs_review"]);return response({pending:count??0,engine_version:CATEGORY_ENGINE_VERSION});}
    if(body.operation==="learn"){if(!body.transaction_id||!body.category_id)return response({error:"transaction_id e category_id obrigatórios"},400);const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:req.headers.get("Authorization")??""}}});const {error}=await userClient.rpc("learn_transaction_category",{p_transaction_id:body.transaction_id,p_category_id:body.category_id});if(error)throw error;return response({learned:true});}
    if(body.operation==="backfill"){
      // Backfill limitado: reenfileira lançamentos elegíveis que seguem sem
      // categoria. Idempotente pela unicidade de transaction_id na fila.
      const limit=Math.min(body.limit??200,500);
      const {data:pending,error:pendingError}=await admin.from("transactions")
        .select("id").eq("user_id",userId).eq("status","confirmed").in("type",["income","expense"])
        .is("category_id",null).is("transfer_group_id",null).is("settles_card_id",null)
        .order("occurred_at",{ascending:false}).limit(limit);
      if(pendingError)throw pendingError;
      const ids=(pending??[]).map((r:{id:string})=>r.id);
      if(!ids.length)return response({ok:true,enqueued:0,pending:0,engine_version:CATEGORY_ENGINE_VERSION});
      const {error:upsertError}=await admin.from("category_classification_queue")
        .upsert(ids.map((id)=>({user_id:userId,transaction_id:id,status:"queued",locked_at:null,processed_at:null,last_error:null,available_at:new Date().toISOString(),next_retry_reason:"backfill_user"})),{onConflict:"transaction_id"});
      if(upsertError)throw upsertError;
      const {data:claimed,error:claimError}=await admin.rpc("claim_category_classification_batch",{p_limit:Math.min(ids.length,80),p_user_id:userId});
      if(claimError)throw claimError;
      const result=await processClaimed(admin,(claimed??[]) as ClaimedRow[]);
      return response({ok:true,enqueued:ids.length,claimed:(claimed??[]).length,...result,engine_version:CATEGORY_ENGINE_VERSION});
    }
    if(body.operation==="process_queue"){
      const {data,error}=await admin.rpc("claim_category_classification_batch",{p_limit:body.limit??80,p_user_id:userId});if(error)throw error;const result=await processClaimed(admin,(data??[]) as ClaimedRow[]);return response({engine_version:CATEGORY_ENGINE_VERSION,claimed:(data??[]).length,...result});
    }
    const inputs=body.operation==="classify"?(body.input?[body.input]:[]):(body.inputs??[]);if(!inputs.length)return response({error:"Nenhum lançamento informado"},400);
    let results=await classifyBatchDeterministic(admin,userId!,inputs);const beforeAi=results.map((r)=>r.action);results=await inferWithAi(admin,userId!,inputs,results,"ondemand");const persisted=await Promise.all(results.map((result,index)=>persistDecision(admin,userId!,inputs[index],result,"live",{ai_attempted:beforeAi[index]==="leave_unresolved"&&result.category_source==="llm"})));
    return response(body.operation==="classify"?{decision:persisted[0]}:{decisions:persisted,processed:persisted.length});
  }catch(error){console.error("[category-engine]",error);return response({error:"Falha ao categorizar",details:error instanceof Error?error.message:String(error)},500);}
});
