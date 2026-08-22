import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { streamText, Output, NoObjectGeneratedError } from "npm:ai";
import { z } from "npm:zod";
import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";
import { getAiBlock } from "../_shared/aiCircuit.ts";
import {
  CATEGORY_ENGINE_VERSION, classifyWithContext, loadCategorizationContext, resultFromLlm,
  type ClassificationInput, type ClassificationResult,
} from "../_shared/categorization/engine.ts";

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

async function classifyBatchDeterministic(admin:ReturnType<typeof createClient>,userId:string,inputs:ClassificationInput[]):Promise<ClassificationResult[]>{
  const types=[...new Set(inputs.map(i=>i.type).filter(t=>t==="income"||t==="expense"))] as Array<"income"|"expense">;
  const contexts=new Map<"income"|"expense",Awaited<ReturnType<typeof loadCategorizationContext>>>();
  for(const type of types){
    const keys=inputs.filter(i=>i.type===type).map(i=>String(i.description??""));
    contexts.set(type,await loadCategorizationContext(admin,userId,type,keys));
  }
  return inputs.map(input=>{
    if(input.type!=="income"&&input.type!=="expense") return {category_id:null,category_source:"none",category_confidence:0,category_reason:"movimento contábil excluído da categorização de consumo",action:"exclude",reason_code:"non_consumption_movement",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
    return classifyWithContext(input,contexts.get(input.type)!);
  });
}

async function inferWithAi(admin:ReturnType<typeof createClient>,userId:string,inputs:ClassificationInput[],results:ClassificationResult[]){
  if(!LOVABLE_API_KEY)return results;
  if(await getAiBlock(admin))return results;
  const unresolved=results.map((result,index)=>({result,input:inputs[index],index})).filter(x=>x.result.action==="leave_unresolved"&&x.result.category_id===null);
  if(!unresolved.length)return results;
  const types=[...new Set(unresolved.map(x=>x.input.type).filter(t=>t==="income"||t==="expense"))] as Array<"income"|"expense">;
  const contexts=await Promise.all(types.map(async type=>[type,await loadCategorizationContext(admin,userId,type,unresolved.filter(x=>x.input.type===type).map(x=>String(x.input.description??"")))] as const));
  const byType=new Map(contexts);
  const candidates=contexts.flatMap(([type,ctx])=>ctx.candidates.map(category=>({...category,type})));
  const validByType=new Map(types.map(type=>[type,new Set((byType.get(type)?.candidates??[]).map(c=>c.id))]));
  try{
    const gateway=createLovableAiGatewayProvider(LOVABLE_API_KEY);
    const generation=streamText({model:gateway(MODEL),output:Output.object({schema:LlmSchema}),prompt:`Classifique lançamentos financeiros brasileiros. Use somente category_id listado E do mesmo type do item. Não classifique transferências, pagamento de fatura, investimento ou movimento técnico. Se não houver evidência suficiente, retorne category_id null. A confiança do modelo é apenas evidência para revisão; nunca autoriza auto-apply sozinha.\n${JSON.stringify({categories:candidates,items:unresolved.map(({input,index})=>({index,type:input.type,description:input.description}))})}`});
    const output=await generation.output;
    for(const item of output.items??[]){
      const target=Number(item.index); const type=inputs[target]?.type;
      if(type!=="income"&&type!=="expense")continue;
      const decision=resultFromLlm(item,validByType.get(type)??new Set<string>());
      if(decision&&results[target]?.category_id==null)results[target]=decision;
    }
  }catch(error){if(NoObjectGeneratedError.isInstance(error))console.warn("[category-engine] invalid structured output",error.text?.slice(0,300));else console.warn("[category-engine] ai fallback",String(error).slice(0,300));}
  return results;
}

const TRUSTED_APPLIED_SOURCES=new Set(["user","personal","alias","history","global","rule"]);

async function persistDecision(admin:ReturnType<typeof createClient>,userId:string,input:ClassificationInput,result:ClassificationResult,mode="live"){
  if(!input.transaction_id)return result;
  const {data:tx,error:txError}=await admin.from("transactions")
    .select("id,user_id,category_id,category_source,type,movement_kind")
    .eq("id",input.transaction_id).eq("user_id",userId).maybeSingle();
  if(txError)throw txError;
  if(!tx)return{...result,action:"preserve"};
  const currentSource=String(tx.category_source??"");
  // Race guard: an explicit/manual or already trusted decision always wins over a queued worker.
  if(tx.category_id&&TRUSTED_APPLIED_SOURCES.has(currentSource)){
    await admin.from("category_classification_queue").update({status:"completed",processed_at:new Date().toISOString(),locked_at:null,last_error:"preserved_trusted_category"}).eq("transaction_id",tx.id);
    return{...result,action:"preserve"};
  }
  if((tx.type==="income"||tx.type==="expense")&&tx.type!==input.type)throw new Error("transaction_type_mismatch");
  const apply=result.action==="auto_apply";
  const {data:decision,error}=await admin.from("category_decisions").insert({
    user_id:userId,transaction_id:tx.id,previous_category_id:tx.category_id,decided_category_id:result.category_id,
    source:result.category_source,confidence:result.category_confidence,reason_code:result.reason_code,reason:result.category_reason,
    engine_version:CATEGORY_ENGINE_VERSION,action:result.action,mode,actor:"engine",alternatives:result.alternatives,
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
    category_review_status:result.action==="suggest_review"?"suggested":"needs_review",
    category_engine_version:CATEGORY_ENGINE_VERSION,category_classified_at:classifiedAt,category_decision_id:decision.id,
  }:{
    category_id:null,category_source:null,category_confidence:null,category_reason:null,
    category_review_status:result.action==="suggest_review"?"suggested":"needs_review",
    category_engine_version:CATEGORY_ENGINE_VERSION,category_classified_at:classifiedAt,category_decision_id:decision.id,
  };

  const {error:updateError}=await admin.from("transactions").update(patch).eq("id",tx.id).eq("user_id",userId);
  if(updateError)throw updateError;
  await admin.from("category_classification_queue").update({status:"completed",processed_at:classifiedAt,locked_at:null,last_error:null}).eq("transaction_id",tx.id);
  return result;
}

type ClaimedRow={queue_id:string;transaction_id:string;user_id:string;type:"income"|"expense";description:string|null;movement_kind:string|null;transfer_group_id:string|null;settles_card_id:string|null;shared_expense_id:string|null};
async function processClaimed(admin:ReturnType<typeof createClient>,rows:ClaimedRow[]){
  const grouped=new Map<string,ClaimedRow[]>(); for(const row of rows){const list=grouped.get(row.user_id)??[];list.push(row);grouped.set(row.user_id,list);}
  let processed=0,failed=0; const errors:Array<{transaction_id:string;error:string}>=[];
  for(const [userId,userRows] of grouped){
    const inputs:ClassificationInput[]=userRows.map(r=>({transaction_id:r.transaction_id,type:r.type,description:r.description,movement_kind:r.movement_kind,transfer_group_id:r.transfer_group_id,settles_card_id:r.settles_card_id,shared_expense_id:r.shared_expense_id}));
    try{
      let results=await classifyBatchDeterministic(admin,userId,inputs); results=await inferWithAi(admin,userId,inputs,results);
      for(let i=0;i<inputs.length;i++){try{await persistDecision(admin,userId,inputs[i],results[i],"live");processed++;}catch(error){failed++;const msg=String(error).slice(0,300);errors.push({transaction_id:inputs[i].transaction_id??"",error:msg});await admin.from("category_classification_queue").update({status:"failed",locked_at:null,last_error:msg,available_at:new Date(Date.now()+5*60_000).toISOString()}).eq("transaction_id",inputs[i].transaction_id);}}
    }catch(error){const msg=String(error).slice(0,300);failed+=userRows.length;for(const r of userRows)errors.push({transaction_id:r.transaction_id,error:msg});await admin.from("category_classification_queue").update({status:"failed",locked_at:null,last_error:msg,available_at:new Date(Date.now()+5*60_000).toISOString()}).in("transaction_id",userRows.map(r=>r.transaction_id));}
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
        .upsert(rows.map((r)=>({user_id:r.user_id,transaction_id:r.id,status:"queued",locked_at:null,processed_at:null,last_error:null,available_at:new Date().toISOString()})),{onConflict:"transaction_id"});
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
        .upsert(ids.map((id)=>({user_id:userId,transaction_id:id,status:"queued",locked_at:null,processed_at:null,last_error:null,available_at:new Date().toISOString()})),{onConflict:"transaction_id"});
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
    let results=await classifyBatchDeterministic(admin,userId!,inputs);results=await inferWithAi(admin,userId!,inputs,results);const persisted=await Promise.all(results.map((result,index)=>persistDecision(admin,userId!,inputs[index],result)));
    return response(body.operation==="classify"?{decision:persisted[0]}:{decisions:persisted,processed:persisted.length});
  }catch(error){console.error("[category-engine]",error);return response({error:"Falha ao categorizar",details:error instanceof Error?error.message:String(error)},500);}
});
