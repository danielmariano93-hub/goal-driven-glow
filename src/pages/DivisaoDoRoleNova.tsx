import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useCategories } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { formatBRL } from "@/lib/split/math";
import { dispatchSplitReminders } from "@/lib/split/dispatch";
import { normalizeBrPhone } from "@/lib/phone";
import { CategorySelect } from "@/components/CategorySelect";

type Person = { id?: string; name: string; phone_e164: string; amount_due: string; amount_paid?: number };
type Source = "account" | "credit_card";
const money = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

export default function DivisaoDoRoleNova() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: cards = [] } = useCreditCards();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [includeOwner, setIncludeOwner] = useState(true);
  const [ownerAmount, setOwnerAmount] = useState("");
  const [reminders, setReminders] = useState(true);
  const [pixKey, setPixKey] = useState("");
  const [source, setSource] = useState<Source>("account");
  const [sourceId, setSourceId] = useState("");
  const [reimbursementAccountId, setReimbursementAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [people, setPeople] = useState<Person[]>([{ name: "", phone_e164: "", amount_due: "" }]);
  const [missingFinancialSource, setMissingFinancialSource] = useState(false);
  const totalNum = money(total || "0");

  const refreshFinance = () => {
    queryClient.invalidateQueries({ queryKey: ["shared_expenses"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["credit_cards"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  useEffect(() => {
    if (!editing) return;
    (async () => {
      const [{ data: split, error }, { data: participants }] = await Promise.all([
        supabase.from("shared_expenses" as never).select("*").eq("id" as never, id as never).single(),
        supabase.from("shared_expense_participants" as never).select("*").eq("shared_expense_id" as never, id as never).order("created_at" as never),
      ]);
      if (error || !split) { toast.error("Não consegui abrir esta divisão"); nav("/app/divisao-do-role"); return; }
      const s = split as any; const rows = (participants ?? []) as any[];
      setTitle(s.title); setTotal(String(s.total_amount).replace(".", ",")); setOccurredAt(s.occurred_at);
      setDueDate(s.due_date ?? ""); setMode(s.split_mode); setReminders(s.reminder_enabled);
      setPixKey(s.pix_key ?? ""); setCategoryId(s.category_id ?? "");
      setReimbursementAccountId(s.reimbursement_account_id ?? "");
      setMissingFinancialSource(!s.source_account_id && !s.source_credit_card_id);
      setSource(s.source_credit_card_id ? "credit_card" : "account");
      setSourceId(s.source_credit_card_id ?? s.source_account_id ?? "");
      const owner = rows.find((p) => !p.phone_e164 && Number(p.amount_paid) === Number(p.amount_due));
      setIncludeOwner(Boolean(owner)); setOwnerAmount(owner ? String(owner.amount_due).replace(".", ",") : "");
      setPeople(rows.filter((p) => p !== owner).map((p) => ({ id:p.id,name:p.name,phone_e164:p.phone_e164??"",amount_due:String(p.amount_due).replace(".",","),amount_paid:Number(p.amount_paid) })));
      setLoading(false);
    })();
  }, [editing, id, nav]);

  useEffect(() => {
    if (!sourceId && source === "account" && accounts[0]) setSourceId(accounts[0].id);
    if (!reimbursementAccountId && accounts[0]) setReimbursementAccountId(accounts[0].id);
  }, [accounts, reimbursementAccountId, source, sourceId]);

  const shares = useMemo(() => {
    if (!(totalNum > 0)) return [];
    if (mode === "custom") return [
      ...(includeOwner ? [{ name:"Você", amount:money(ownerAmount||"0") }] : []),
      ...people.filter((p)=>p.name.trim()).map((p)=>({ name:p.name,amount:money(p.amount_due||"0") })),
    ];
    const active = people.filter((p)=>p.name.trim()); const count=active.length+(includeOwner?1:0);
    if (!count) return [];
    const cents=Math.round(totalNum*100), base=Math.floor(cents/count); let rest=cents-base*count;
    return [...(includeOwner?[{name:"Você"}]:[]),...active].map((p)=>({ name:p.name,amount:(base+(rest-->0?1:0))/100 }));
  }, [includeOwner, mode, ownerAmount, people, totalNum]);
  const sharesTotal = shares.reduce((sum,p)=>sum+p.amount,0);
  const valid = title.trim() && totalNum>0 && shares.length>0 && Math.round(sharesTotal*100)===Math.round(totalNum*100)
    && Boolean(sourceId);

  const save = async () => {
    if (!valid) { toast.error("Revise os valores e a origem do pagamento"); return; }
    setSaving(true);
    try {
      const participantPayload: Array<{ id: string | null; name: string; phone_e164: string | null; amount_due: number }> = [];
      const invalidPhones: string[] = [];
      for (const p of people.filter((x)=>x.name.trim())) {
        const share = shares.find((s)=>s.name===p.name)?.amount ?? 0;
        const raw = p.phone_e164.trim();
        let phone: string | null = null;
        if (raw) {
          phone = normalizeBrPhone(raw);
          if (!phone) invalidPhones.push(p.name.trim());
        }
        participantPayload.push({ id:p.id??null, name:p.name.trim(), phone_e164:phone, amount_due:share });
      }
      if (invalidPhones.length) {
        setSaving(false);
        toast.error(`Telefone inválido: ${invalidPhones.join(", ")}. Use DDD + número (ex.: 11 91234-5678).`);
        return;
      }
      if (editing) {
        const ownerExisting = includeOwner ? [{ id: null, name:"Você", phone_e164:null, amount_due:shares.find((s)=>s.name==="Você")?.amount ?? 0 }] : [];
        // O servidor protege pessoas já pagas; o proprietário é representado
        // pelo registro sem telefone que já veio do banco.
        const { data: existing } = await supabase.from("shared_expense_participants" as never).select("id,name,phone_e164,amount_due,amount_paid").eq("shared_expense_id" as never,id as never);
        const owner = ((existing??[]) as any[]).find((p)=>!p.phone_e164 && Number(p.amount_paid)===Number(p.amount_due));
        if (ownerExisting.length && owner) ownerExisting[0].id=owner.id;
        const { error } = await supabase.rpc("split_update" as never, {
          p_id:id,p_title:title.trim(),p_total:totalNum,p_occurred_at:occurredAt,p_due_date:dueDate||null,
          p_split_mode:mode,p_reminder_enabled:reminders,p_pix_key:pixKey||null,
          p_participants:[...ownerExisting,...participantPayload],p_source_account_id:source==="account"?sourceId:null,
          p_source_credit_card_id:source==="credit_card"?sourceId:null,p_reimbursement_account_id:reimbursementAccountId||null,p_category_id:categoryId||null,p_register_transaction:true,
        } as never);
        if (error) throw error;
        refreshFinance();
        toast.success("Divisão atualizada"); nav(`/app/divisao-do-role/${id}`);
      } else {
        const { data, error } = await supabase.rpc("split_create_v2" as never, {
          p_title:title.trim(),p_total:totalNum,p_occurred_at:occurredAt,p_due_date:dueDate||null,p_split_mode:mode,
          p_include_owner:includeOwner,p_reminder_enabled:reminders,p_pix_key:pixKey||null,p_participants:participantPayload,
          p_owner_amount:includeOwner?(shares.find((s)=>s.name==="Você")?.amount??null):null,
          p_source_account_id:source==="account"?sourceId:null,p_source_credit_card_id:source==="credit_card"?sourceId:null,
          p_reimbursement_account_id:reimbursementAccountId||null,p_category_id:categoryId||null,p_register_transaction:true,
        } as never);
        if (error) throw error;
        refreshFinance();
        // O convite faz parte do resultado da criação: não esconda falhas do
        // dispatcher. O detalhe da divisão permite retomar sem duplicar jobs.
        const recipients = participantPayload.filter((p) => Boolean(p.phone_e164)).length;
        if (recipients > 0) {
          const dispatch = await dispatchSplitReminders();
          if (dispatch.status === "timeout") {
            toast.info("Divisão criada. O envio continua em segundo plano e você pode acompanhar por aqui.");
          } else if (dispatch.status === "error") {
            toast.warning("Divisão criada, mas o convite ainda não foi entregue. Abra a divisão para tentar novamente.");
          } else if (
            dispatch.data.failed > 0
            || (dispatch.data.outbound_failed ?? 0) > 0
            || !dispatch.data.outbound_kicked
          ) {
            toast.warning("Divisão criada, mas houve uma falha no envio. Abra a divisão para tentar novamente.");
          } else if ((dispatch.data.outbound_sent ?? 0) > 0) {
            toast.success("Divisão criada e convite enviado.");
          } else if (
            dispatch.data.enqueued > 0
            || (dispatch.data.outbound_pending ?? 0) > 0
          ) {
            toast.info("Divisão criada. O convite está na fila do WhatsApp.");
          } else {
            toast.info("Divisão criada. O convite ficou agendado e você pode acompanhar o envio.");
          }
        } else {
          toast.success("Divisão criada.");
        }
        nav(`/app/divisao-do-role/${data}`);
      }
    } catch (e:any) { toast.error(friendlyError(e)); } finally { setSaving(false); }
  };

  if (loading) return <div className="grid place-items-center py-12"><Loader2 className="animate-spin" /></div>;
  return <div className="split-form space-y-5 pb-8 pt-2">
    <button onClick={()=>nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={14}/> Voltar</button>
    <div><h1 className="font-display text-2xl font-bold">{editing?"Editar divisão":`Nova divisão · ${step}/3`}</h1><p className="text-xs text-muted-foreground">Tudo fica sincronizado com seus lançamentos.</p></div>
    {(editing||step===1)&&<section className="surface-card space-y-3 p-4">
      <Field label="Nome do rolê"><input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Jantar com a turma" className="input"/></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Valor total"><input value={total} onChange={(e)=>setTotal(e.target.value)} inputMode="decimal" className="input"/></Field><Field label="Data"><input type="date" value={occurredAt} onChange={(e)=>setOccurredAt(e.target.value)} className="input"/></Field></div>
      <Field label="Vencimento"><input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} className="input"/></Field>
    </section>}
    {(editing||step===2)&&<section className="space-y-3">
      <div className="surface-card space-y-3 p-4"><div className="flex gap-2"><Choice active={mode==="equal"} onClick={()=>setMode("equal")}>Dividir igual</Choice><Choice active={mode==="custom"} onClick={()=>setMode("custom")}>Personalizar</Choice></div><label className="flex gap-2 text-xs"><input type="checkbox" checked={includeOwner} onChange={(e)=>setIncludeOwner(e.target.checked)}/> Incluir você</label>{includeOwner&&mode==="custom"&&<Field label="Sua parte"><input value={ownerAmount} onChange={(e)=>setOwnerAmount(e.target.value)} className="input" inputMode="decimal"/></Field>}</div>
      <div className="surface-card space-y-3 p-4">{people.map((p,i)=><div key={p.id??i} className="grid grid-cols-[1fr_8rem_auto] gap-2"><input value={p.name} onChange={(e)=>setPeople(people.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder="Nome" className="input"/><input value={p.phone_e164} onChange={(e)=>setPeople(people.map((x,j)=>j===i?{...x,phone_e164:e.target.value}:x))} placeholder="+55…" className="input"/><button disabled={Boolean(p.amount_paid)} onClick={()=>setPeople(people.filter((_,j)=>j!==i))} className="text-destructive disabled:opacity-30"><Trash2 size={15}/></button>{mode==="custom"&&<input value={p.amount_due} onChange={(e)=>setPeople(people.map((x,j)=>j===i?{...x,amount_due:e.target.value}:x))} placeholder="Parte em R$" inputMode="decimal" className="input col-span-2"/>}</div>)}<button onClick={()=>setPeople([...people,{name:"",phone_e164:"",amount_due:""}])} className="inline-flex items-center gap-1 text-xs text-primary"><Plus size={13}/> Adicionar pessoa</button><div className="border-t pt-3 text-xs">{shares.map((s,i)=><p key={i} className="flex justify-between"><span>{s.name}</span><strong>{formatBRL(s.amount)}</strong></p>)}<p className={`mt-2 flex justify-between ${Math.round(sharesTotal*100)===Math.round(totalNum*100)?"text-success":"text-destructive"}`}><span>Soma</span><strong>{formatBRL(sharesTotal)}</strong></p></div></div>
    </section>}
    {(editing||step===3)&&<section className="surface-card space-y-3 p-4">
      <div className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">Para manter seu saldo correto, toda divisão registra o gasto na conta ou no cartão usado no pagamento.</div>
      {missingFinancialSource&&<div className="flex gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-foreground"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning"/> Esta divisão foi criada antes do vínculo financeiro. Escolha a conta ou o cartão usado para salvar e refletir nos movimentos.</div>}
      <Field label="De onde saiu o pagamento? *"><select value={source} onChange={(e)=>{setSource(e.target.value as Source);setSourceId("")}} className="input"><option value="account">Conta bancária</option><option value="credit_card">Cartão de crédito</option></select></Field><Field label={source==="account"?"Qual conta? *":"Qual cartão? *"}><select value={sourceId} onChange={(e)=>setSourceId(e.target.value)} className="input"><option value="">Selecione</option>{(source==="account"?accounts:cards).filter((x:any)=>x.active).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Categoria"><CategorySelect value={categoryId||null} onChange={(id)=>setCategoryId(id??"")} type="expense" className="input"/></Field><Field label="Conta para receber os reembolsos"><select value={reimbursementAccountId} onChange={(e)=>setReimbursementAccountId(e.target.value)} className="input"><option value="">Registrar baixa sem lançamento</option>{accounts.filter((a)=>a.active).map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={reminders} onChange={(e)=>setReminders(e.target.checked)}/> Ativar lembretes amigáveis</label><Field label="Chave Pix"><input value={pixKey} onChange={(e)=>setPixKey(e.target.value)} className="input"/></Field>
    </section>}
    <div className="flex gap-2">{!editing&&step>1&&<button onClick={()=>setStep(step-1)} className="rounded-full border px-4 py-2 text-sm">Voltar</button>}{!editing&&step<3?<button disabled={step===1?!(title&&totalNum>0):shares.length===0} onClick={()=>setStep(step+1)} className="ml-auto rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40">Continuar</button>:<button disabled={!valid||saving} onClick={save} className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-40">{saving&&<Loader2 size={14} className="animate-spin"/>}{editing?"Salvar alterações":"Criar e avisar"}</button>}</div>
  </div>;
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("Escolha de onde saiu")) return "Escolha a conta ou o cartão usado no pagamento para salvar a divisão.";
  if (message.includes("menor que o valor já recebido")) return "Uma pessoa já pagou mais do que a nova parte dela. Ajuste os valores antes de salvar.";
  if (message.includes("remover alguém que já pagou")) return "Não dá para remover quem já pagou. Desfaça o pagamento antes, se for o caso.";
  if (message.includes("soma das partes")) return "A soma das partes precisa bater exatamente com o valor total.";
  return message || "Não consegui salvar";
}

function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="block space-y-1 text-xs font-medium"><span>{label}</span>{children}</label>; }
function Choice({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}) { return <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 text-xs ${active?"border-primary bg-primary text-primary-foreground":"border-border"}`}>{children}</button>; }
