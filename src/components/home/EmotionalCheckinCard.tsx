import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SpinnerGap, LinkSimple, Check, Gauge, Heartbeat } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBRL } from "@/lib/engine/facts";
import { Button } from "@/components/ui/button";
import { EXTRA_EMOTIONS, PRIMARY_EMOTIONS, resolveEmotion } from "@/lib/emotions/catalog";

const PRIMARY_MOODS = PRIMARY_EMOTIONS.map((e) => ({ key: e.key, v: e.mood, label: e.label }));
const EXTRA_MOODS = EXTRA_EMOTIONS.map((e) => ({ key: e.key, v: e.mood, label: e.label }));
const ALL_MOODS = [...PRIMARY_MOODS, ...EXTRA_MOODS];

const CONTEXTS = [
  { key: "purchase", label: "Compra" },
  { key: "bill", label: "Conta" },
  { key: "debt", label: "Dívida" },
  { key: "goal", label: "Meta" },
  { key: "income", label: "Renda" },
  { key: "work", label: "Trabalho" },
  { key: "other", label: "Outro" },
];

function saoPauloDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function friendlyDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function ScoreSlider({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-foreground">{label}</p>
          <p className="text-[9px] text-muted-foreground">{hint}</p>
        </div>
        <span className="grid h-8 min-w-8 place-items-center rounded-xl bg-background px-2 text-sm font-bold text-primary">{value}</span>
      </div>
      <input type="range" min={0} max={10} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 h-1.5 w-full cursor-pointer accent-primary" />
    </div>
  );
}

export function EmotionalCheckinCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [txId, setTxId] = useState<string | "">("");
  const [showMore, setShowMore] = useState(false);
  const [collapsedAfterSave, setCollapsedAfterSave] = useState(false);
  const [calm, setCalm] = useState(6);
  const [control, setControl] = useState(6);
  const [urge, setUrge] = useState(4);
  const [contextKey, setContextKey] = useState<string | null>(null);

  const { data: today } = useQuery({
    queryKey: ["emotional-today", user?.id], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from("emotional_checkins") as any)
        .select("id,mood,notes,trigger_label,emotion_key,declared_emotion_key,transaction_id,occurred_at,financial_calm_score,financial_control_score,spending_urge_score,context_key")
        .order("occurred_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []).find((item: any) => saoPauloDate(new Date(item.occurred_at)) === saoPauloDate()) ?? null;
    },
  });

  const { data: recentTxs } = useQuery({
    queryKey: ["recent-txs-for-emotion", user?.id], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions")
        .select("id,description,amount,occurred_at,type").eq("type", "expense")
        .order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data as Array<{ id: string; description: string | null; amount: number; occurred_at: string }>;
    },
  });

  useEffect(() => {
    if (!today) return;
    const emotion = resolveEmotion(today.declared_emotion_key ?? today.emotion_key ?? today.trigger_label);
    setSelectedKey(emotion?.key ?? null);
    setNote(today.notes ?? "");
    setTxId((today.transaction_id as string | null) ?? "");
    setCalm(Number(today.financial_calm_score ?? Math.max(0, Math.min(10, Number(today.mood ?? 3) * 2))));
    setControl(Number(today.financial_control_score ?? 6));
    setUrge(Number(today.spending_urge_score ?? 4));
    setContextKey(today.context_key ?? (resolveEmotion(today.trigger_label) ? null : today.trigger_label) ?? null);
    setCollapsedAfterSave(true);
  }, [today?.id]);

  const selected = useMemo(() => ALL_MOODS.find((m) => m.key === selectedKey), [selectedKey]);
  const saved = !!today && collapsedAfterSave;
  const visibleMoods = showMore || (selected && EXTRA_MOODS.some((m) => m.key === selected.key)) ? ALL_MOODS : PRIMARY_MOODS;

  async function save() {
    if (!user || !selected) return;
    setSaving(true);
    try {
      const payload = {
        mood: selected.v,
        emotion_key: selected.key,
        declared_emotion_key: selected.key,
        declared_text: selected.label,
        trigger_label: contextKey,
        context_key: contextKey,
        financial_calm_score: calm,
        financial_control_score: control,
        spending_urge_score: urge,
        measurement_version: "money_mood.v1",
        notes: note || null,
        transaction_id: txId || null,
      };
      if (today) {
        const { error } = await (supabase.from("emotional_checkins") as any).update(payload).eq("id", today.id);
        if (error) throw error;
        toast.success("Check-in atualizado.");
      } else {
        const checkinId = crypto.randomUUID();
        const { error } = await (supabase.from("emotional_checkins") as any).insert({
          ...payload, id: checkinId, user_id: user.id, occurred_at: new Date().toISOString(),
        });
        if (error) throw error;
        await supabase.rpc("challenge_progress_add", {
          p_slug: "checkin-emocional", p_delta: 1, p_source_type: "emotion_checkin", p_source_id: checkinId,
        });
        toast.success("Registrado. O Nino já usa esse contexto na sua evolução.");
      }
      setCollapsedAfterSave(true);
      for (const key of ["emotional-today", "pulse", "emotional_checkins", "behavioral-evolution"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      const msg = (e as { code?: string }).code === "23505"
        ? "Você já tem um check-in de hoje — atualize o que já existe."
        : "Não deu para salvar agora. Tente de novo em instantes.";
      toast.error(msg);
    } finally { setSaving(false); }
  }

  return (
    <section aria-label="Check-in emocional" className="rounded-[22px] border border-border bg-card p-4 shadow-card animate-fade-in">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Heartbeat size={19} weight="bold" /></span>
        <div>
          <h3 className="text-sm font-bold text-foreground">Como você está com o dinheiro hoje?</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Um check-in de poucos segundos vira contexto para hábitos e highlights.</p>
        </div>
      </div>

      {saved && selected ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1.5 text-[12px] font-semibold text-success"><Check size={12} weight="bold" /> {selected.label} · hoje</span>
            <Button type="button" onClick={() => setCollapsedAfterSave(false)} variant="ghost" size="sm" className="rounded-full text-[12px] font-bold">Editar</Button>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-secondary/20">
            <div className="p-2.5 text-center"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Tranquilidade</p><p className="mt-1 font-bold">{calm}</p></div>
            <div className="p-2.5 text-center"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Controle</p><p className="mt-1 font-bold">{control}</p></div>
            <div className="p-2.5 text-center"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Vontade</p><p className="mt-1 font-bold">{urge}</p></div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar">
            {visibleMoods.map((m) => {
              const active = selectedKey === m.key;
              return <Button key={m.key} type="button" variant={active ? "default" : "outline"} size="sm" onClick={() => { setSelectedKey(m.key); if (!today) setCalm(Math.max(0, Math.min(10, m.v * 2))); }} className="h-10 shrink-0 rounded-full px-3 text-[11px] font-semibold" aria-pressed={active}>{m.label}</Button>;
            })}
            {!showMore && !visibleMoods.some((m) => EXTRA_MOODS.some((e) => e.key === m.key)) && (
              <Button type="button" onClick={() => setShowMore(true)} variant="outline" size="sm" className="h-10 shrink-0 rounded-full px-3 text-[11px] font-semibold">Outro</Button>
            )}
          </div>

          {selected && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><Gauge size={13} /> Três notas rápidas — 0 a 10</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <ScoreSlider label="Tranquilidade" hint="Como o dinheiro pesa hoje" value={calm} onChange={setCalm} />
                <ScoreSlider label="Controle" hint="Quanto você sente que escolhe" value={control} onChange={setControl} />
                <ScoreSlider label="Vontade de gastar" hint="Impulso de comprar hoje" value={urge} onChange={setUrge} />
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground">O que mais influenciou? <span className="opacity-70">(opcional)</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CONTEXTS.map((context) => <button key={context.key} type="button" onClick={() => setContextKey((current) => current === context.key ? null : context.key)} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-semibold ${contextKey === context.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{context.label}</button>)}
                </div>
              </div>

              {(recentTxs?.length ?? 0) > 0 && (
                <div>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground"><LinkSimple size={11} weight="bold" /> Relacionar a um gasto <span className="opacity-70">(opcional)</span></label>
                  <select value={txId} onChange={(e) => setTxId(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <option value="">Sem relação com um gasto</option>
                    {recentTxs!.map((t) => <option key={t.id} value={t.id}>{friendlyDate(t.occurred_at)} · {t.description ?? "(sem descrição)"} · {formatBRL(Number(t.amount))}</option>)}
                  </select>
                </div>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full resize-none rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="Quer contar o que aconteceu? (opcional)" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to="/app/emocoes" className="text-[12px] font-semibold text-primary hover:underline">Ver minha evolução</Link>
                <Button type="button" onClick={save} disabled={saving || !selected} size="sm" className="min-h-11 rounded-full px-5 text-[12px] font-semibold">
                  {saving ? <SpinnerGap size={12} className="animate-spin" /> : null}{today ? "Atualizar" : "Registrar"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
