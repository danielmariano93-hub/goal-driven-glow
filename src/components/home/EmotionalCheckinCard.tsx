import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBRL } from "@/lib/engine/facts";

const MOODS = [
  { key: "tranquilo", v: 5, label: "Tranquilo", emoji: "😌" },
  { key: "confiante", v: 4, label: "Confiante", emoji: "😊" },
  { key: "ansioso", v: 3, label: "Ansioso", emoji: "😟" },
  { key: "impulsivo", v: 2, label: "Impulsivo", emoji: "😅" },
  { key: "frustrado", v: 1, label: "Frustrado", emoji: "😤" },
  { key: "preocupado", v: 1, label: "Preocupado", emoji: "😰" },
];

function saoPauloDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function EmotionalCheckinCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [txId, setTxId] = useState<string | "">("");

  const { data: today } = useQuery({
    queryKey: ["emotional-today", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emotional_checkins")
        .select("id, mood, notes, trigger_label, transaction_id, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []).find((item) => saoPauloDate(new Date(item.occurred_at)) === saoPauloDate()) ?? null;
    },
  });

  const { data: recentTxs } = useQuery({
    queryKey: ["recent-txs-for-emotion", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, description, amount, occurred_at, type")
        .eq("type", "expense")
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as Array<{ id: string; description: string | null; amount: number; occurred_at: string }>;
    },
  });

  useEffect(() => {
    if (today) {
      setSelectedKey(today.trigger_label ?? null);
      setNote(today.notes ?? "");
      setTxId((today.transaction_id as string | null) ?? "");
    }
  }, [today?.id]);

  const selected = useMemo(() => MOODS.find((m) => m.key === selectedKey), [selectedKey]);

  async function save() {
    if (!user || !selected) return;
    setSaving(true);
    try {
      if (today) {
        const { error } = await supabase
          .from("emotional_checkins")
          .update({
            mood: selected.v,
            trigger_label: selected.key,
            notes: note || null,
            transaction_id: txId || null,
          })
          .eq("id", today.id);
        if (error) throw error;
        toast.success("Check-in de hoje atualizado.");
      } else {
        const { error } = await supabase.from("emotional_checkins").insert({
          user_id: user.id,
          occurred_at: new Date().toISOString(),
          mood: selected.v,
          trigger_label: selected.key,
          notes: note || null,
          transaction_id: txId || null,
        });
        if (error) throw error;
        toast.success("Registrado. Obrigado por compartilhar.");
      }
      qc.invalidateQueries({ queryKey: ["emotional-today"] });
      qc.invalidateQueries({ queryKey: ["pulse"] });
    } catch (e) {
      const msg = (e as { code?: string }).code === "23505"
        ? "Você já tem um check-in de hoje — atualize o que já existe."
        : "Não deu para salvar agora. Tente de novo em instantes.";
      toast.error(msg);
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
          const active = selectedKey === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setSelectedKey(m.key)}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs transition ${
                active ? "border-primary bg-primary/5 text-primary" : "border-border bg-muted/30 hover:bg-muted/60"
              }`}
              aria-pressed={active}
            >
              <span className="text-xl" aria-hidden>{m.emoji}</span>
              <span className="font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <>
          {(recentTxs?.length ?? 0) > 0 && (
            <div className="mt-3">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link2 size={11} /> Relacionar a um gasto recente <span className="opacity-70">(opcional)</span>
              </label>
              <select
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Sem relação com um gasto</option>
                {recentTxs!.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.occurred_at} · {t.description ?? "(sem descrição)"} · {formatBRL(Number(t.amount))}
                  </option>
                ))}
              </select>
            </div>
          )}

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
              disabled={saving || !selected}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              {today ? "Atualizar" : "Registrar"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
