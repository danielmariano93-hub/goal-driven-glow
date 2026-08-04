import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, Clock3, Copy, Loader2, MessageCircle, Pencil, RefreshCw, RotateCcw, Send, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/split/math";
import { dispatchSplitReminders } from "@/lib/split/dispatch";

const labels:Record<string,string>={active:"Aguardando pagamentos",settled:"Tudo recebido",cancelled:"Cancelada",pending:"Aguardando você",notified:"Convite enviado",partial:"Recebido em parte",paid:"Pago",waived:"Isento",opted_out:"Você saiu",payment_reported:"Pagamento informado",awaiting_owner_confirmation:"Comprovante recebido — confirme"};
const messageLabels:Record<string,string>={queued:"Preparando",processing:"Preparando",enqueued:"Na fila do WhatsApp",sent:"Enviada ao WhatsApp",delivered:"Entregue",read:"Lida",failed:"Falhou",dead:"Não entregue",skipped:"Não enviada"};
const terminalMessageStatuses=new Set(["sent","delivered","read","failed","dead","skipped"]);
function deliveryLabel(msg:any){const outbound=msg?.outbound_status;if(outbound==="queued")return "Na fila do WhatsApp";if(outbound==="processing")return "Enviando";return messageLabels[outbound??msg?.job_status]??outbound??msg?.job_status??"Preparando";}
// Confirmação real de entrega por participante: vem dos contadores de ACK do
// WhatsApp, não da nossa fila. "Enviada" não é o mesmo que "entregue".
const ackLabels:Record<string,{text:string;tone:string}>={read:{text:"Lida no WhatsApp",tone:"text-success"},delivered:{text:"Entregue no WhatsApp",tone:"text-success"},sent:{text:"Enviada — sem confirmação de entrega",tone:"text-muted-foreground"},failed_terminal:{text:"Não entregue no WhatsApp",tone:"text-destructive"},failed_retryable:{text:"Falhou — vamos tentar de novo",tone:"text-destructive"},provider_accepted:{text:"Aceita pelo WhatsApp",tone:"text-muted-foreground"},none:{text:"Sem envio ainda",tone:"text-muted-foreground"}};
function ackInfo(p:any){
  if(Number(p?.read_count??0)>0)return ackLabels.read;
  if(Number(p?.delivered_count??0)>0)return ackLabels.delivered;
  const status=String(p?.communication_status??"none");
  return ackLabels[status]??(Number(p?.sent_count??0)>0?ackLabels.sent:ackLabels.none);
}


export default function DivisaoDoRoleDetalhe() {
  const { id }=useParams(); const nav=useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [split,setSplit]=useState<any>(null); const [parts,setParts]=useState<any[]>([]); const [events,setEvents]=useState<any[]>([]);
  const [messages,setMessages]=useState<Record<string,any>>({}); const [busy,setBusy]=useState(false);
  const [ownerName,setOwnerName]=useState<string|null>(null);
  const [loadError,setLoadError]=useState<string|null>(null);
  const load=async()=>{
    const [{data:s,error},{data:p},{data:e},{data:m}]=await Promise.all([
      supabase.from("shared_expenses" as never).select("*").eq("id" as never,id as never).maybeSingle(),
      supabase.from("shared_expense_participants" as never).select("*").eq("shared_expense_id" as never,id as never).order("created_at" as never),
      supabase.from("shared_expense_events" as never).select("*").eq("shared_expense_id" as never,id as never).order("created_at" as never,{ascending:false}).limit(30),
      supabase.rpc("split_message_status" as never,{p_id:id} as never),
    ]);
    if(error){setLoadError(error.message||"Não foi possível carregar este rolê.");return;}
    if(!s){setLoadError("Você não tem acesso a este rolê ou ele foi removido.");return;}
    setLoadError(null);
    setSplit(s);setParts((p??[]) as any[]);setEvents((e??[]) as any[]);
    setMessages(Object.fromEntries(((m??[]) as any[]).map((x)=>[x.participant_id,x])));
    const ownerId=(s as any).owner_user_id;
    if(ownerId && user?.id && ownerId!==user.id){
      const {data:prof}=await supabase.from("profiles").select("display_name").eq("id",ownerId).maybeSingle();
      setOwnerName((prof as any)?.display_name ?? null);
    } else setOwnerName(null);
  };
  useEffect(()=>{load();const timer=window.setInterval(load,6000);return()=>window.clearInterval(timer);/* eslint-disable-next-line react-hooks/exhaustive-deps */},[id,user?.id]);

  const isOwner = Boolean(split && user && split.owner_user_id===user.id);
  const myParticipant = useMemo(()=>parts.find((p)=>p.linked_user_id && user && p.linked_user_id===user.id) ?? null,[parts,user]);
  const isParticipant = Boolean(myParticipant);
  const external=useMemo(()=>parts.filter((p)=>p.phone_e164),[parts]);
  const received=external.reduce((s,p)=>s+Number(p.amount_paid),0), pending=external.reduce((s,p)=>s+Math.max(0,Number(p.amount_due)-Number(p.amount_paid)),0);
  const externalTotal=received+pending,progress=externalTotal?Math.min(100,Math.round(received/externalTotal*100)):100;
  const overdue=split?.due_date&&split.status==="active"&&split.due_date<new Date().toISOString().slice(0,10);
  const refreshFinance=()=>{invalidateFinancialQueries(queryClient);};
  const act=async(fn:()=>PromiseLike<{error?:any}>,ok:string)=>{setBusy(true);try{const r=await fn();if(r.error)throw r.error;refreshFinance();toast.success(ok);await load();}catch(e:any){toast.error(friendlyError(e));}finally{setBusy(false)}};
  const payment=(pid:string,amount:number)=>act(()=>supabase.rpc("split_add_payment_v2" as never,{p_participant_id:pid,p_amount:amount} as never),"Pagamento registrado");
  const kick=async(showToast=true)=>{
    const result=await dispatchSplitReminders();
    if(showToast){
      if(result.status==="timeout")toast.info("O envio continua em segundo plano.");
      else if(result.status==="error"||result.data.failed>0||(result.data.outbound_failed??0)>0||!result.data.outbound_kicked)toast.error("Não conseguimos concluir agora. A fila fará uma nova tentativa.");
      else if((result.data.outbound_sent??0)>0)toast.success("Mensagem enviada");
      else toast.info("Mensagem na fila do WhatsApp");
    }
    await load();
    return result;
  };
  const resume=async()=>{setBusy(true);try{await kick();}finally{setBusy(false)}};
  const retry=async(pid:string,kind:string)=>{setBusy(true);try{const{error}=await supabase.rpc("split_enqueue_message" as never,{p_expense_id:id,p_participant_id:pid,p_kind:kind||"reminder",p_when:new Date().toISOString()} as never);if(error)throw error;await kick();}catch(e:any){toast.error(friendlyError(e));}finally{setBusy(false)}};
  const cancel=async()=>{const reason=prompt("Motivo do cancelamento (opcional):")??"";if(!confirm("Cancelar as cobranças e preservar este rolê no histórico? O lançamento financeiro será mantido."))return;await act(()=>supabase.rpc("split_cancel" as never,{p_id:id,p_reason:reason||null,p_remove_transaction:false} as never),"Divisão cancelada");};
  const remove=async()=>{if(!confirm("Excluir este rolê e remover o lançamento financeiro? O gasto sairá das movimentações, da conta e do patrimônio."))return;await act(()=>supabase.rpc("split_delete" as never,{p_id:id} as never),"Rolê excluído e lançamento removido");nav("/app/divisao-do-role",{replace:true});};
  const sendAll=async()=>{setBusy(true);try{const{data,error}=await supabase.rpc("split_send_reminders" as never,{p_shared_expense_id:id} as never);if(error)throw error;if(Number(data??0)===0){toast.info("Nenhum novo lembrete precisava ser enviado agora.");await load();return;}await kick();}catch(e:any){toast.error(friendlyError(e));}finally{setBusy(false)}};
  const participantMessages=external.map((p)=>messages[p.id]).filter(Boolean);
  const pendingInvite=participantMessages.some((m)=>m.kind==="invite"&&!terminalMessageStatuses.has(m.outbound_status??m.job_status));
  const deliveredCount=participantMessages.filter((m)=>["sent","delivered","read"].includes(m.outbound_status)).length;
  const failedCount=participantMessages.filter((m)=>["failed","dead"].includes(m.outbound_status??m.job_status)).length;
  const overallStatus=failedCount?`${failedCount} envio${failedCount===1?" precisa":"s precisam"} de atenção`:pendingInvite?"Estamos enviando os convites":deliveredCount===external.length&&external.length?"Convites enviados":"Acompanhamento do rolê";
  const canDelete=Boolean(!split?.deleted_at&&received===0&&(split?.linked_transaction_id||split?.status==="cancelled"));

  if(loadError){
    return <div className="space-y-4 pt-2">
      <button onClick={()=>nav("/app/divisao-do-role")} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={14}/> Voltar</button>
      <div className="surface-card p-6 text-center"><AlertTriangle className="mx-auto text-destructive"/><p className="mt-2 text-sm font-semibold">Não consegui abrir este rolê</p><p className="mt-1 text-xs text-muted-foreground">{loadError}</p><button onClick={()=>{setLoadError(null);load();}} className="btn-primary mx-auto mt-4 px-4 py-2"><RefreshCw size={13}/> Tentar novamente</button></div>
    </div>;
  }
  if(!split)return <div className="grid place-items-center py-12"><Loader2 className="animate-spin"/></div>;

  // === PARTICIPANT VIEW ===
  if(isParticipant && !isOwner){
    const myDue = Number(myParticipant.amount_due);
    const myPaid = Number(myParticipant.amount_paid);
    const myRemaining = Math.max(0, myDue-myPaid);
    const myPct = myDue>0 ? Math.round((myPaid/myDue)*100) : 100;
    return <div className="space-y-5 pb-8 pt-2">
      <button onClick={()=>nav("/app/divisao-do-role")} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={14}/> Voltar</button>
      <header>
        <h1 className="font-display text-2xl font-bold">{split.title}</h1>
        <p className="text-xs text-muted-foreground">Criado por {ownerName ?? "outro usuário"} · {new Date(`${split.occurred_at}T12:00:00`).toLocaleDateString("pt-BR")}</p>
        <p className={`mt-1 text-xs ${overdue?"font-semibold text-destructive":"text-muted-foreground"}`}>{overdue?`Vencido em ${new Date(`${split.due_date}T12:00:00`).toLocaleDateString("pt-BR")}`:split.due_date?`Vence em ${new Date(`${split.due_date}T12:00:00`).toLocaleDateString("pt-BR")}`:labels[split.status]??split.status}</p>
      </header>
      <section className="surface-card p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Minha parte</p>
        <p className="mt-1 text-3xl font-bold">{formatBRL(myDue)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="Paguei" value={formatBRL(myPaid)} tone="text-success"/>
          <Metric label="Falta" value={formatBRL(myRemaining)} tone={myRemaining?"text-destructive":"text-success"}/>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-gradient-to-r from-primary to-brand-coral transition-all" style={{width:`${myPct}%`}}/></div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">{myPct}% pago</p>
      </section>
      {split.pix_key && <section className="surface-card p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Chave Pix de {ownerName ?? "quem criou"}</p>
        <p className="mt-1 break-all text-sm font-medium">{split.pix_key}</p>
        <button onClick={()=>navigator.clipboard.writeText(split.pix_key).then(()=>toast.success("Chave copiada"))} className="btn-ghost-brand mt-3"><Copy size={13}/> Copiar chave</button>
      </section>}
      <section className="surface-card p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Como confirmar seu pagamento?</p>
        <p className="mt-1">Faça o Pix e avise {ownerName ?? "quem criou o rolê"}. Assim que a pessoa registrar o recebimento, esta tela é atualizada automaticamente.</p>
      </section>
    </div>;
  }

  // === OWNER VIEW (original) ===
  return <div className="space-y-5 pb-8 pt-2">
    <button onClick={()=>nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={14}/> Voltar</button>
    <header className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="font-display text-2xl font-bold">{split.title}</h1>{split.deleted_at&&<span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Excluída</span>}</div><p className="text-xs text-muted-foreground">{new Date(`${split.occurred_at}T12:00:00`).toLocaleDateString("pt-BR")} · <span className={overdue?"font-semibold text-destructive":""}>{split.deleted_at?"Somente no histórico":overdue?"Vencida":labels[split.status]??split.status}</span></p></div>{isOwner&&split.status!=="cancelled"&&<button onClick={()=>nav(`/app/divisao-do-role/${id}/editar`)} className="rounded-full border p-2" aria-label="Editar"><Pencil size={16}/></button>}</header>
    {!split.deleted_at&&external.length>0&&<section className="surface-card overflow-hidden"><div className="flex items-start gap-3 border-b border-border p-4"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${failedCount?"bg-destructive/10 text-destructive":pendingInvite?"bg-primary/10 text-primary":"bg-success/10 text-success"}`}>{failedCount?<AlertTriangle size={18}/>:pendingInvite?<Loader2 size={18} className="animate-spin"/>:<MessageCircle size={18}/>}</div><div><p className="text-sm font-semibold">{overallStatus}</p><p className="mt-0.5 text-xs text-muted-foreground">{pendingInvite?"Isso normalmente leva menos de um minuto. Você pode sair desta tela — continuaremos por aqui.":failedCount?"Veja abaixo quem precisa de uma nova tentativa.":"Você acompanha cada convite e pagamento nesta tela."}</p></div></div><div className="grid grid-cols-3 gap-1 p-3 text-center"><JourneyStep icon={<Clock3 size={14}/>} label="Preparado" active/><JourneyStep icon={<Send size={14}/>} label="Enviado" active={deliveredCount>0}/><JourneyStep icon={<CheckCircle2 size={14}/>} label="Recebido" active={received>0}/></div></section>}
    {split.deleted_at&&<div className="rounded-2xl border border-border bg-secondary/50 p-4 text-xs text-muted-foreground"><p className="font-semibold text-foreground">Este rolê foi excluído</p><p className="mt-1">O gasto foi removido das movimentações. Mantivemos este registro somente no histórico para não perder a rastreabilidade.</p></div>}
    <section className="surface-card p-4"><div className="grid grid-cols-3 gap-3"><Metric label="Total" value={formatBRL(Number(split.total_amount))}/><Metric label="Recebido" value={formatBRL(received)} tone="text-success"/><Metric label="Falta" value={formatBRL(pending)} tone={pending?"text-destructive":"text-success"}/></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-gradient-to-r from-primary to-brand-coral transition-all" style={{width:`${progress}%`}}/></div><p className="mt-1 text-right text-[11px] text-muted-foreground">{progress}% recebido</p></section>
    {overdue&&<div className="flex gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><AlertTriangle size={16}/> Há pessoas com pagamento atrasado.</div>}
    {isOwner&&split.status==="active"&&<button disabled={busy||pendingInvite} onClick={sendAll} className="btn-primary w-full disabled:opacity-50"><Bell size={14}/> {pendingInvite?"Enviando convite inicial…":"Lembrar quem ainda não pagou"}</button>}
    <section className="surface-card divide-y divide-border overflow-hidden">{parts.map((p)=>{const left=Math.max(0,Number(p.amount_due)-Number(p.amount_paid));const msg=messages[p.id];const isOwnerRow=!p.phone_e164;const messageStatus=msg?.outbound_status??msg?.job_status;const stalled=msg&&!["sent","delivered","read","failed","dead","skipped"].includes(messageStatus)&&Date.now()-new Date(msg.updated_at).getTime()>120000;const canRetry=["failed","dead","skipped"].includes(messageStatus);const attempts=Number(msg?.outbound_attempts??msg?.attempts??0);const ack=ackInfo(p);return <article key={p.id} className="space-y-2 p-4"><div className="flex justify-between gap-2"><div><p className="text-sm font-semibold">{isOwnerRow?`${p.name} (você)`:p.name}</p><p className="text-[11px] text-muted-foreground">{isOwnerRow?"Sua parte":p.phone_masked??"Sem WhatsApp"} · {formatBRL(Number(p.amount_paid))} de {formatBRL(Number(p.amount_due))}</p></div><span className={`h-fit rounded-full px-2 py-1 text-[10px] ${p.status==="paid"?"bg-success/15 text-success":"bg-secondary text-muted-foreground"}`}>{labels[p.status]??p.status}</span></div>{isOwner&&!isOwnerRow&&msg&&<div className={`rounded-xl px-3 py-2 text-[11px] ${canRetry||stalled?"bg-destructive/5 text-destructive":"bg-secondary/60"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{stalled?"O envio está demorando":deliveryLabel(msg)}</span><span className="text-[10px] opacity-70">{new Date(msg.updated_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span></div><p className={`mt-1 text-[10px] font-medium ${ack.tone}`}>{ack.text}</p><p className="mt-1 text-[10px] opacity-75">{attempts>0?`${attempts} tentativa${attempts===1?"":"s"}`:"Ainda sem tentativa de envio"}{msg.last_attempt_at?` · última ${new Date(msg.last_attempt_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`:""}</p>{(canRetry||stalled)&&<p className="mt-1">{stalled?"Você pode retomar o processamento sem criar outra cobrança.":"Não conseguimos concluir. Você pode tentar novamente."}</p>}</div>}{isOwner&&left>0&&split.status==="active"&&<div className="flex flex-wrap gap-2"><button disabled={busy} onClick={()=>payment(p.id,left)} className="rounded-full bg-success/15 px-3 py-1 text-xs text-success"><CheckCircle2 size={12} className="inline"/> Marcar {formatBRL(left)}</button><button disabled={busy} onClick={()=>{const v=prompt("Quanto foi recebido?");const n=Number((v??"").replace(",","."));if(n>0)payment(p.id,n)}} className="rounded-full border px-3 py-1 text-xs">Valor parcial</button>{!isOwnerRow&&stalled&&<button disabled={busy} onClick={resume} className="rounded-full border px-3 py-1 text-xs"><RefreshCw size={12} className="inline"/> Retomar envio</button>}{!isOwnerRow&&canRetry&&<button disabled={busy} onClick={()=>retry(p.id,msg?.kind??"reminder")} className="rounded-full border px-3 py-1 text-xs"><RefreshCw size={12} className="inline"/> Tentar novamente</button>}</div>}{isOwner&&!isOwnerRow&&msg?.outbound_status==="queued"&&<button disabled={busy} onClick={resume} className="rounded-full border px-3 py-1 text-xs"><RefreshCw size={12} className="inline"/> Retomar envio</button>}{isOwner&&Number(p.amount_paid)>0&&!isOwnerRow&&<button disabled={busy} onClick={()=>act(()=>supabase.rpc("split_reverse_payment_v2" as never,{p_participant_id:p.id} as never),"Pagamento desfeito")} className="text-xs text-muted-foreground"><RotateCcw size={11} className="inline"/> Desfazer</button>}</article>})}</section>
    {isOwner&&!split.deleted_at&&<div className="grid grid-cols-2 gap-2"><button onClick={()=>navigator.clipboard.writeText(`${split.title} · ${formatBRL(pending)} pendente${split.pix_key?` · Pix ${split.pix_key}`:""}`).then(()=>toast.success("Dados copiados"))} className="btn-ghost-brand"><Copy size={14}/> Copiar dados</button>{split.status!=="cancelled"&&<button onClick={cancel} className="inline-flex items-center justify-center gap-2 rounded-full border border-destructive/30 px-4 py-2 text-sm text-destructive"><XCircle size={14}/> Cancelar</button>}{canDelete&&<button onClick={remove} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground"><Trash2 size={13}/> Excluir rolê e remover lançamento</button>}</div>}
    {isOwner&&events.length>0&&<details className="surface-card p-4"><summary className="cursor-pointer text-xs font-semibold">Histórico da divisão</summary><ul className="mt-3 space-y-2 text-[11px] text-muted-foreground">{events.map((e)=><li key={e.id}>{new Date(e.created_at).toLocaleString("pt-BR")} · {eventLabel(e.event_type)}</li>)}</ul></details>}
  </div>;
}
function Metric({label,value,tone=""}:{label:string;value:string;tone?:string}){return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`text-sm font-bold ${tone}`}>{value}</p></div>}
function JourneyStep({icon,label,active}:{icon:ReactNode;label:string;active:boolean}){return <div className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] ${active?"bg-primary/10 font-semibold text-primary":"text-muted-foreground"}`}><span>{icon}</span><span>{label}</span></div>}
function eventLabel(v:string){return ({created:"Divisão criada",updated:"Divisão editada",payment:"Pagamento registrado",reverse_payment:"Pagamento desfeito",message_queued:"Mensagem preparada",message_enqueued:"Mensagem entrou na fila do WhatsApp",cancelled:"Divisão cancelada",deleted:"Divisão excluída",reminders_scheduled:"Lembretes preparados"} as Record<string,string>)[v]??v.replace(/_/g," ")}
function friendlyError(error: unknown){const message=error instanceof Error?error.message:typeof error==="string"?error:"";if(message.includes("Há pagamentos recebidos"))return "Esta divisão já recebeu pagamentos. Para preservar o histórico, cancele sem remover o lançamento.";if(message.includes("Divisão encerrada"))return "Esta divisão já foi encerrada.";if(message.includes("reminders_disabled"))return "Os lembretes estão desativados nesta divisão.";return message||"Não consegui concluir";}
