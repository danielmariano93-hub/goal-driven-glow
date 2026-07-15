import { useEffect, useState } from "react";
import { Loader2, Smile, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { correlateByMoodCategory, MIN_SAMPLE, type CorrelationRow } from "@/lib/emotions/correlations";
import { formatBRL } from "@/lib/split/math";

const MOODS = [
  { v: 1, label: "Péssimo", emoji: "😞" },
  { v: 2, label: "Ruim", emoji: "😕" },
  { v: 3, label: "Neutro", emoji: "😐" },
  { v: 4, label: "Bom", emoji: "🙂" },
  { v: 5, label: "Ótimo", emoji: "😄" },
];

export default function Emocoes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mood, setMood] = useState<number | null>(null);
  const [trigger, setTrigger] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: history } = useQuery({
    queryKey: ["emotional_checkins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emotional_checkins")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mood || !user) return;
    setSaving(true);
    const { error } = await supabase.from("emotional_checkins").insert({
      user_id: user.id,
      mood,
      trigger_label: trigger || null,
      notes: notes || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar");
      return;
    }
    setMood(null);
    setTrigger("");
    setNotes("");
    qc.invalidateQueries({ queryKey: ["emotional_checkins"] });
    toast.success("Check-in registrado");
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Check-in emocional</h1>
        <p className="text-sm text-muted-foreground">Registre como você se sente ao lidar com dinheiro hoje.</p>
      </header>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <p className="mb-2 text-sm font-medium">Como está seu humor financeiro?</p>
        <div className="grid grid-cols-5 gap-2">
          {MOODS.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setMood(m.v)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium transition-colors ${
                mood === m.v ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="text-2xl">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Gatilho (opcional)</label>
            <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Ex: ansiedade, tédio, celebração" className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Notas (opcional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base min-h-20" />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={!mood || saving} className="btn-brand inline-flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar"}
          </button>
        </div>
      </form>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Histórico recente</h2>
        {!history || history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            <Smile className="mx-auto mb-2 h-6 w-6" />
            Ainda não há check-ins registrados.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    {MOODS.find((m) => m.v === Number(h.mood))?.emoji ?? "🙂"} {MOODS.find((m) => m.v === Number(h.mood))?.label ?? h.mood}
                    {h.trigger_label ? ` · ${h.trigger_label}` : ""}
                  </p>
                  {h.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{h.notes}</p>}
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(h.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Correlations />
    </div>
  );
}

function Correlations() {
  const [rows, setRows] = useState<CorrelationRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const [{ data: txns }, { data: emo }] = await Promise.all([
        supabase.from("transactions").select("occurred_at,amount,type,categories(name)").eq("type", "expense").order("occurred_at", { ascending: false }).limit(500),
        supabase.from("emotional_checkins").select("occurred_at,mood").order("occurred_at", { ascending: false }).limit(500),
      ]);
      const byDay = new Map<string, string>();
      (emo ?? []).forEach((e: any) => {
        const d = String(e.occurred_at).slice(0, 10);
        if (!byDay.has(d)) byDay.set(d, String(e.mood));
      });
      const pairs = (txns ?? [])
        .map((t: any) => {
          const d = String(t.occurred_at).slice(0, 10);
          const mood = byDay.get(d);
          if (!mood) return null;
          return {
            mood,
            category: t.categories?.name ?? "Sem categoria",
            weekday: new Date(t.occurred_at).getDay(),
            amount: Number(t.amount),
          };
        })
        .filter(Boolean) as any[];
      setRows(correlateByMoodCategory(pairs));
    })();
  }, []);

  if (rows === null) return null;
  if (rows.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold flex items-center gap-1"><TrendingUp size={14} /> Correlações</h2>
        <p className="text-xs text-muted-foreground surface-card p-4">
          Sem dados suficientes ainda. Registre check-ins no mesmo dia de despesas para observar correlações.
        </p>
      </section>
    );
  }
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold flex items-center gap-1"><TrendingUp size={14} /> Correlações emoção × categoria</h2>
      <p className="text-[10px] text-muted-foreground mb-2">
        Observação factual, não causal. Marcamos como suficiente apenas com ≥{MIN_SAMPLE} ocorrências.
      </p>
      <div className="surface-card divide-y divide-border overflow-hidden">
        {rows.slice(0, 10).map((r, i) => {
          const moodLabel = MOODS.find((m) => m.v === Number(r.mood))?.label ?? r.mood;
          return (
            <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
              <div>
                <p className="font-medium">{moodLabel} · {r.category}</p>
                <p className="text-[10px] text-muted-foreground">
                  {r.count}x · média {formatBRL(r.avg)} {r.sufficient ? "" : "(amostra insuficiente)"}
                </p>
              </div>
              <span className={r.sufficient ? "font-semibold" : "text-muted-foreground"}>{formatBRL(r.total)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
