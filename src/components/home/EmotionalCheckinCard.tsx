import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const MOODS = [
  { v: 5, label: "Tranquilo", emoji: "😌" },
  { v: 4, label: "Confiante", emoji: "😊" },
  { v: 3, label: "Ansioso", emoji: "😟" },
  { v: 2, label: "Impulsivo", emoji: "😅" },
  { v: 1, label: "Frustrado", emoji: "😤" },
  { v: 1, label: "Preocupado", emoji: "😰" },
];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EmotionalCheckinCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const { data: today } = useQuery({
    queryKey: ["emotional-today", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const start = `${todayIso()}T00:00:00`;
      const { data, error } = await supabase
        .from("emotional_checkins")
        .select("id, mood, notes")
        .gte("occurred_at", start)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && (error as { code?: string }).code !== "PGRST116") throw error;
      return data;
    },
  });

  useEffect(() => {
    if (today) {
      setSelected(today.mood);
      setNote(today.notes ?? "");
    }
  }, [today?.id]);

  async function save() {
    if (!user || selected == null) return;
    setSaving(true);
    try {
      if (today) {
        const { error } = await supabase
          .from("emotional_checkins")
          .update({ mood: selected, notes: note || null })
          .eq("id", today.id);
        if (error) throw error;
        toast.success("Check-in de hoje atualizado.");
      } else {
        const { error } = await supabase.from("emotional_checkins").insert({
          user_id: user.id,
          mood: selected,
          notes: note || null,
          occurred_at: new Date().toISOString(),
        });
        if (error) throw error;
        toast.success("Registrado. Obrigado por compartilhar.");
      }
      qc.invalidateQueries({ queryKey: ["emotional-today"] });
    } catch {
      toast.error("Não deu para salvar agora. Tente de novo em instantes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-card p-5 shadow-card ring-1 ring-border">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
          <Heart size={16} />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">Como você está com o dinheiro hoje?</h3>
          <p className="text-xs text-muted-foreground">
            {today ? "Você já fez o check-in de hoje — pode atualizar se quiser." : "Um toque pra gente entender seu momento."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {MOODS.map((m) => {
          const isActive = selected === m.v && (today?.mood ?? selected) === m.v;
          return (
            <button
              key={m.label}
              type="button"
              onClick={() => setSelected(m.v)}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs transition ${
                isActive ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/30 hover:bg-muted/60"
              }`}
              aria-pressed={isActive}
            >
              <span className="text-xl" aria-hidden>
                {m.emoji}
              </span>
              <span className="font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>

      <label className="mt-3 block text-xs text-muted-foreground">
        Quer contar o que aconteceu? <span className="opacity-70">(opcional)</span>
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mt-1 w-full resize-none rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        placeholder="Pode ser algo curto, do jeito que vier."
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/emocoes" className="text-xs text-primary underline-offset-2 hover:underline">
          Ver seu relatório emocional
        </Link>
        <button
          type="button"
          onClick={save}
          disabled={saving || selected == null}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {today ? "Atualizar" : "Registrar"}
        </button>
      </div>
    </section>
  );
}
