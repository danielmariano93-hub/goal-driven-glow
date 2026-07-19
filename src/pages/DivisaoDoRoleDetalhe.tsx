import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, Copy, Loader2, Pencil, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";

const labels:Record<string,string>={active:"Aguardando pagamentos",settled:"Tudo recebido",cancelled:"Cancelada",pending:"Pendente",partial:"Recebido em parte",paid:"Pago",notified:"Avisado"};
const messageLabels:Record<string,string>={queued:"Aguardando envio",processing:"Enviando",enqueued:"Na fila",sent:"Enviada",delivered:"Entregue",read:"Lida",failed:"Falhou",dead:"Não entregue",skipped:"Não enviada"};

export default function DivisaoDoRoleDetalhe() {
  const { id }=useParams(); const nav=useNavigate();
  const [split,setSplit]=useState<any>(null); const [parts,setParts]=useState<any[]>([]); const [events,setEvents]=useState<any[]>([]);
  const [messages,setMessages]=useState<Record<string,any>>({}); const [busy,setBusy]=useState(false);
  const load=async()=>{
    const [{data:s,error},{data:p},{data:e},{data:m}]=await Promise.all([
      supabase.from("shared_expenses" as never).select("*").eq("id" as never,id as never).single(),
      supabase.from("shared_expense_participants" as never).select("*").eq("shared_expense_id" as never,id as never).order("created_at" as never),
      supabase.from("shared_expense_events" as never).select("*").eq("shared_expense_id" as never,id as never).order("created_at" as never,{ascending:false}).limit(30),
      supabase.rpc("split_message_status" as never,{p_id:id} as never),
    ]);
    if(error){toast.error("Divisão não encontrada");nav("/app/divisao-do-role");return;}
    setSplit(s);setParts((p??[]) as any[]);setEvents((e??[]) as any[]);
    setMessages(Object.fromEntries(((m??[]) as any[]).map((x)=>[x.participant_id,x])));
  };
  useEffect(()=>{load();},[id]);
  const external=useMemo(()=>parts.filter((p)=>p.phone_e164),[parts]);
  const received=external.reduce((s,p)=>s+Number(p.amount_paid),0), pending=external.reduce((s,p)=>s+Math.max(0,Number(p.amount_due)-Number(p.amount_paid)),0);
  const externalTotal=received+pending,progress=externalTotal?Math.min(100,Math.round(received/externalTotal*100)):100;
  const overdue=split?.due_date&&split.status==="active"&&split.due_date<new Date().toISOString().slice(0,10);
  const act=async(fn:()=>PromiseLike<{error?:any}>,ok:string)=>{setBusy(true);try{const r=await fn();if(r.error)throw r.error;toast.success(ok);await load();}catch(e:any){toast.error(e.message||"Não consegui concluir");}finally{setBusy(false)}};
  const payment=(pid:string,amount:number)=>act(()=>supabase.rpc("split_add_payment_v2" as never,{p_participant_id:pid,p_amount:amount} as never),"Pagamento registrado");
  const retry=(pid:string)=>act(()=>supabase.rpc("split_enqueue_message" as never,{p_expense_id:id,p_participant_id:pid,p_kind:"reminder",p_when:new Date().toISOString()} as never),"Mensagem preparada para envio");
  const cancel=async()=>{const reason=prompt("Motivo do cancelamento (opcional):")??"";const hasReceived=received>0;if(!confirm(hasReceived?"Esta divisão já recebeu pagamentos. Ela será cancelada, mas os lançamentos serão preservados. Continuar?":"Cancelar esta divisão e remover o gasto vinculado?"))return;await act(()=>supabase.rpc("split_cancel" as never,{p_id:id,p_reason:reason||null,p_remove_transaction:!hasReceived} as never),"Divisão cancelada");};
  const sendAll=()=>act(()=>supabase.rpc("split_send_reminders" as never,{p_shared_expense_id:id} as never),"Lembretes preparados");
  if(!split)return <div className="grid place-items-center py-12"><Loader2 className="animate-spin"/></div>;
  return <div className="space-y-5 pb-8 pt-2">
    <button onClick={()=>nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={14}/> Voltar</button>
    <header className="flex items-start justify-between gap-3"><div><h1 className="font-display text-2xl font-bold">{split.title}</h1><p className="text-xs text-muted-foreground">{new Date(`${split.occurred_at}T12:00:00`).toLocaleDateString("pt-BR")} · <span className={overdue?"font-semibold text-destructive":""}>{overdue?"Vencida":labels[split.status]??split.status}</span></p></div>{split.status!=="cancelled"&&<button onClick={()=>nav(`/app/divisao-do-role/${id}/editar`)} className="rounded-full border p-2" aria-label="Editar"><Pencil size={16}/></button>}</header>
    <section className="surface-card p-4"><div className="grid grid-cols-3 gap-3"><Metric label="Total" value={formatBRL(Number(split.total_amount))}/><Metric label="Recebido" value={formatBRL(received)} tone="text-success"/><Metric label="Falta" value={formatBRL(pending)} tone={pending?"text-destructive":"text-success"}/></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-gradient-to-r from-primary to-brand-coral transition-all" style={{width:`${progress}%`}}/></div><p className="mt-1 text-right text-[11px] text-muted-foreground">{progress}% recebido</p></section>
    {overdue&&<div className="flex gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><AlertTriangle size={16}/> Há pessoas com pagamento atrasado.</div>}
    {split.status==="active"&&<button disabled={busy} onClick={sendAll} className="btn-primary w-full"><Bell size={14}/> Lembrar quem ainda não pagou</button>}
    <section className="surface-card divide-y divide-border overflow-hidden">{parts.map((p)=>{const left=Math.max(0,Number(p.amount_due)-Number(p.amount_paid));const msg=messages[p.id];const isOwner=!p.phone_e164;return <article key={p.id} className="space-y-2 p-4"><div className="flex justify-between gap-2"><div><p className="text-sm font-semibold">{isOwner?`${p.name} (você)`:p.name}</p><p className="text-[11px] text-muted-foreground">{isOwner?"Sua parte":p.phone_masked??"Sem WhatsApp"} · {formatBRL(Number(p.amount_paid))} de {formatBRL(Number(p.amount_due))}</p></div><span className={`h-fit rounded-full px-2 py-1 text-[10px] ${p.status==="paid"?"bg-success/15 text-success":"bg-secondary text-muted-foreground"}`}>{labels[p.status]??p.status}</span></div>{!isOwner&&msg&&<div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-[11px]"><span>Mensagem: {messageLabels[msg.outbound_status??msg.job_status]??msg.outbound_status??msg.job_status}</span>{msg.last_error&&<span className="text-destructive" title={msg.last_error}>Erro no envio</span>}</div>}{left>0&&split.status==="active"&&<div className="flex flex-wrap gap-2"><button disabled={busy} onClick={()=>payment(p.id,left)} className="rounded-full bg-success/15 px-3 py-1 text-xs text-success"><CheckCircle2 size={12} className="inline"/> Marcar {formatBRL(left)}</button><button disabled={busy} onClick={()=>{const v=prompt("Quanto foi recebido?");const n=Number((v??"").replace(",","."));if(n>0)payment(p.id,n)}} className="rounded-full border px-3 py-1 text-xs">Valor parcial</button>{!isOwner&&<button disabled={busy} onClick={()=>retry(p.id)} className="rounded-full border px-3 py-1 text-xs"><RefreshCw size={12} className="inline"/> Reenviar</button>}</div>}{Number(p.amount_paid)>0&&!isOwner&&<button disabled={busy} onClick={()=>act(()=>supabase.rpc("split_reverse_payment_v2" as never,{p_participant_id:p.id} as never),"Pagamento desfeito")} className="text-xs text-muted-foreground"><RotateCcw size={11} className="inline"/> Desfazer</button>}</article>})}</section>
    <div className="grid grid-cols-2 gap-2"><button onClick={()=>navigator.clipboard.writeText(`${split.title} · ${formatBRL(pending)} pendente${split.pix_key?` · Pix ${split.pix_key}`:""}`).then(()=>toast.success("Dados copiados"))} className="btn-ghost-brand"><Copy size={14}/> Copiar dados</button>{split.status!=="cancelled"&&<button onClick={cancel} className="inline-flex items-center justify-center gap-2 rounded-full border border-destructive/30 px-4 py-2 text-sm text-destructive"><XCircle size={14}/> Cancelar</button>}</div>
    {events.length>0&&<details className="surface-card p-4"><summary className="cursor-pointer text-xs font-semibold">Histórico da divisão</summary><ul className="mt-3 space-y-2 text-[11px] text-muted-foreground">{events.map((e)=><li key={e.id}>{new Date(e.created_at).toLocaleString("pt-BR")} · {eventLabel(e.event_type)}</li>)}</ul></details>}
  </div>;
}
function Metric({label,value,tone=""}:{label:string;value:string;tone?:string}){return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`text-sm font-bold ${tone}`}>{value}</p></div>}
function eventLabel(v:string){return ({created:"Divisão criada",updated:"Divisão editada",payment:"Pagamento registrado",reverse_payment:"Pagamento desfeito",message_queued:"Mensagem agendada",message_enqueued:"Mensagem enviada para a fila",cancelled:"Divisão cancelada",reminders_scheduled:"Lembretes agendados"} as Record<string,string>)[v]??v.replace(/_/g," ")}
