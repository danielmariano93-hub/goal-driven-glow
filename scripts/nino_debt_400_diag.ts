import { interpretWithSingleSemanticAuthorityV3 } from "../supabase/functions/_shared/agent/v3/SemanticAuthorityV3.ts";

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await originalFetch(input, init);
  if (!response.ok) {
    const raw = await response.clone().text().catch(() => "");
    console.log("PROVIDER_ERROR", response.status, raw.replace(/(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g,"[redacted]").slice(0,1800));
  }
  return response;
};

const history = `Usuário: Agora mudando de assunto: quais dívidas eu tenho?\nNino: Você tem uma dívida ativa: Empréstimo Lucas, saldo R$ 1.200,00.\nUsuário: Quanto falta pagar dessa e quando vence a próxima parcela?`;
const context = JSON.stringify({conversation_state:{current_topic:"debt:Empréstimo Lucas",conversation_summary:null,active_category:null,active_merchant:null,active_period:null,comparison_period:null,awaiting:null,pending_conversation_action:null,last_tool_context:{tool:"get_debt_status"},last_analysis:{metric:"debt_balance",operation:"value"},active_references:[{target:"debt",entity_labels:["Empréstimo Lucas"],source_tool:"get_debt_status",query_id:"qa-debt-1"}]},workflow:null});
const out = await interpretWithSingleSemanticAuthorityV3({text:"Quanto falta pagar dessa e quando vence a próxima parcela?",history_text:history,context_text:context});
console.log("OUTCOME",JSON.stringify({tier:out.tier,error:out.telemetry.error,turn:out.turn,violations:out.violations,review:out.review_reasons}));
