import { decideCategoryDeterministic, loadEffectiveThresholds, shouldAutoApply, type AliasRow, type CategoryCandidate, type CategoryDecision, type GlobalKnowledgeRow, type HistoryRow, type PersonalPreferenceRow, type ThresholdOverrides } from "./pipeline.ts";
import { isPassThroughDescriptor, matchAuthoritativeMerchant } from "./merchantCatalog.ts";
import { normalizedPattern, storageMerchantKey } from "./normalize.ts";

export const CATEGORY_ENGINE_VERSION = "categorization_truth.v2";
export type ClassificationAction = "auto_apply" | "suggest_review" | "leave_unresolved" | "exclude" | "preserve";
export type ClassificationInput = { transaction_id?:string|null; type:"income"|"expense"|"transfer"; description?:string|null; explicit_category?:string|null; movement_kind?:string|null; transfer_group_id?:string|null; settles_card_id?:string|null; shared_expense_id?:string|null };
export type ClassificationResult = CategoryDecision & { action:ClassificationAction; reason_code:string; engine_version:string; alternatives:Array<{category_id:string;confidence:number}> };
export type CategorizationContext = {
  candidates: CategoryCandidate[]; aliases: AliasRow[]; history: HistoryRow[];
  preferences?: PersonalPreferenceRow[]; globalKnowledge?: GlobalKnowledgeRow[];
  thresholds: ThresholdOverrides;
};

export function isCategorizationEligible(input:ClassificationInput):boolean{return (input.type==="income"||input.type==="expense")&&(input.movement_kind??"transaction")==="transaction"&&!input.transfer_group_id&&!input.settles_card_id&&!input.shared_expense_id;}
function resultFromDecision(decision:CategoryDecision|null,auto:boolean):ClassificationResult{
  if(!decision?.category_id)return{category_id:null,category_source:"none",category_confidence:0,category_reason:"evidência insuficiente",action:"leave_unresolved",reason_code:"insufficient_evidence",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
  return{...decision,action:auto?"auto_apply":"suggest_review",reason_code:`${decision.category_source}_match`,engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
}
// deno-lint-ignore no-explicit-any
export async function loadCategorizationContext(sb:any,userId:string,type:"income"|"expense",merchantKeys:string[]=[]){
  const keys=[...new Set(merchantKeys.map(normalizedPattern).filter(Boolean))].slice(0,200);
  let prefsQuery=sb.from("user_merchant_preferences").select("merchant_key,category_id,evidence_count").eq("user_id",userId).eq("transaction_type",type);
  let globalQuery=sb.from("merchant_global_knowledge").select("merchant_key,canonical_name,semantic_category_slug,confidence,source,status,patterns").eq("transaction_type",type).eq("source","consensus").eq("status","verified");
  if(keys.length){prefsQuery=prefsQuery.in("merchant_key",keys);globalQuery=globalQuery.in("merchant_key",keys);}
  const [catsRes,aliasesRes,prefsRes,globalRes,thresholds]=await Promise.all([
    sb.from("categories").select("id,name,slug,type,user_id").is("archived_at",null).eq("type",type).or(`user_id.eq.${userId},user_id.is.null`),
    sb.from("merchant_aliases").select("alias_key,normalized_pattern,category_id,confidence,confirmed_by_user_at,learned_from").eq("user_id",userId),
    prefsQuery,
    globalQuery,
    loadEffectiveThresholds(sb),
  ]);
  for(const r of [catsRes,aliasesRes,prefsRes,globalRes]) if(r?.error) throw new Error(`categorization_context_failed:${r.error.message}`);
  const candidates:CategoryCandidate[]=(catsRes.data??[]).map((r:any)=>({id:r.id,name:r.name,slug:r.slug,user_id:r.user_id})).sort((a:any,b:any)=>Number(b.user_id===userId)-Number(a.user_id===userId));
  const candidateIds=new Set(candidates.map(c=>c.id));
  // Higiene de alias (`merchant_truth.v2`): intermediador de pagamento e apelido
  // que contradiz marca canônica NUNCA entram como verdade categórica.
  const aliases:AliasRow[]=(aliasesRes.data??[])
    .filter((r:any)=>r.category_id&&candidateIds.has(r.category_id)&&(r.confirmed_by_user_at||r.learned_from==="manual"||r.learned_from==="confirmation"))
    .filter((r:any)=>{
      const raw=String(r.normalized_pattern??r.alias_key??"");
      if(isPassThroughDescriptor(raw))return false;
      const brand=matchAuthoritativeMerchant(raw);
      if(!brand)return true;
      const target=candidates.find((c)=>c.id===r.category_id);
      const same=(a?:string|null,b?:string|null)=>String(a??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")===String(b??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      return same(target?.name,brand.semantic_category);
    })
    .map((r:any)=>({pattern:normalizedPattern(r.normalized_pattern??r.alias_key),category_id:r.category_id,confidence:Number(r.confidence??0.98)}));
  // V2 never scans raw transaction history on the hot path. Personal truth is
  // materialized in user_merchant_preferences by explicit corrections/backfill.
  // This removes legacy/import/model poisoning and makes classification cost
  // independent of the user's lifetime transaction count.
  const history:HistoryRow[]=[];
  const preferences:PersonalPreferenceRow[]=(prefsRes.data??[]).filter((r:any)=>candidateIds.has(r.category_id)).map((r:any)=>({merchant_key:normalizedPattern(r.merchant_key),category_id:r.category_id,evidence_count:Number(r.evidence_count??1)}));
  const globalKnowledge:GlobalKnowledgeRow[]=(globalRes.data??[]).map((r:any)=>({...r,merchant_key:normalizedPattern(r.merchant_key),confidence:Number(r.confidence??0.95),patterns:Array.isArray(r.patterns)?r.patterns.map(normalizedPattern):[]}));
  return{candidates,aliases,history,preferences,globalKnowledge,thresholds};
}
// deno-lint-ignore no-explicit-any
export async function classifyDeterministic(sb:any,userId:string,input:ClassificationInput):Promise<ClassificationResult>{
  if(!isCategorizationEligible(input))return{category_id:null,category_source:"none",category_confidence:0,category_reason:"movimento contábil excluído da categorização de consumo",action:"exclude",reason_code:"non_consumption_movement",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
  const context=await loadCategorizationContext(sb,userId,input.type as "income"|"expense",[storageMerchantKey(input.description)]); return classifyWithContext(input,context);
}
export function classifyWithContext(input:ClassificationInput,context:CategorizationContext):ClassificationResult{
  if(!isCategorizationEligible(input))return{category_id:null,category_source:"none",category_confidence:0,category_reason:"movimento contábil excluído da categorização de consumo",action:"exclude",reason_code:"non_consumption_movement",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
  const decision=decideCategoryDeterministic({explicit:input.explicit_category,description:input.description??"",candidates:context.candidates,aliases:context.aliases,history:context.history,preferences:context.preferences??[],globalKnowledge:context.globalKnowledge??[]});
  return resultFromDecision(decision,shouldAutoApply(decision,context.thresholds));
}
/** LLM is semantic fallback only. It never auto-applies by itself in V2. */
export function resultFromLlm(input:{category_id:string|null;confidence:number},validIds:Set<string>):ClassificationResult|null{
  const confidence=Math.max(0,Math.min(0.9,Number(input.confidence??0))); if(!input.category_id||!validIds.has(input.category_id)||confidence<0.6)return null;
  return{category_id:input.category_id,category_source:"llm",category_confidence:confidence,category_reason:"inferência semântica restrita às categorias do mesmo tipo",action:"suggest_review",reason_code:"llm_match",engine_version:CATEGORY_ENGINE_VERSION,alternatives:[]};
}
