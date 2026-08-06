import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SpinnerGap, LinkSimple, Check } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBRL } from "@/lib/engine/facts";
import { Button } from "@/components/ui/button";

const PRIMARY_MOODS = [
  { key: "tranquilo", v: 5, label: "Tranquilo" },
  { key: "ansioso", v: 3, label: "Atento" },
  { key: "preocupado", v: 1, label: "Preocupado" },
] as const;
const EXTRA_MOODS = [
  { key: "confiante", v: 4, label: "Confiante" },
  { key: "impulsivo", v: 2, label: "Impulsivo" },
  { key: "frustrado", v: 1, label: "Frustrado" },
] as const;
const ALL_MOODS = [...PRIMARY_MOODS, ...EXTRA_MOODS];

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

function friendlyDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
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
      setCollapsedAfterSave(true);
    }
  }, [today?.id]);

  const selected = useMemo(() => ALL_MOODS.find((m) => m.key === selectedKey), [selectedKey]);
  const saved = !!today && collapsedAfterSave;
  const visibleMoods = showMore || (selected && EXTRA_MOODS.some((m) => m.key === selected.key)) ? ALL_MOODS : PRIMARY_MOODS;

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
        toast.success("Check-in atualizado.");
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
      setCollapsedAfterSave(true);
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
    <section
      aria-label="Check-in emocional"
       className="rounded-[20px] border border-border bg-card p-5 animate-fade-in"
    >
      <h3 className="text-[15px] font-bold text-foreground">
        Como você está com o dinheiro hoje?
      </h3>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Um toque ajuda o Nino a entender seu momento.
      </p>

      {saved && selected ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1.5 text-[12px] font-semibold text-success">
            <Check size={12} weight="bold" /> {selected.label} · hoje
          </span>
          <Button
            type="button"
            onClick={() => setCollapsedAfterSave(false)}
            variant="ghost"
            size="sm"
            className="rounded-full text-[12px] font-bold"
          >
            Editar
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
            {visibleMoods.map((m) => {
              const active = selectedKey === m.key;
              return (
                <Button
                  key={m.key}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedKey(m.key)}
                  className="h-11 shrink-0 rounded-full px-3 text-[12px] font-semibold"
                  aria-pressed={active}
                >
                  {m.label}
                </Button>
              );
            })}
            {!showMore && !visibleMoods.some((m) => EXTRA_MOODS.some((e) => e.key === m.key)) && (
                <Button
                type="button"
                onClick={() => setShowMore(true)}
                  variant="outline"
                  size="sm"
                   className="h-11 shrink-0 rounded-full px-3 text-[12px] font-semibold"
              >
                Outro
                </Button>
            )}
          </div>

          {selected && (
            <div className="mt-3 space-y-2">
              {(recentTxs?.length ?? 0) > 0 && (
                <div>
                   <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <LinkSimple size={11} weight="bold" /> Relacionar a um gasto <span className="opacity-70">(opcional)</span>
                  </label>
                  <select
                    value={txId}
                    onChange={(e) => setTxId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">Sem relação com um gasto</option>
                    {recentTxs!.map((t) => (
                      <option key={t.id} value={t.id}>
                        {friendlyDate(t.occurred_at)} · {t.description ?? "(sem descrição)"} · {formatBRL(Number(t.amount))}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Quer contar o que aconteceu? (opcional)"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/app/emocoes" className="text-[12px] font-semibold text-primary hover:underline">
                  Ver relatório
                </Link>
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving || !selected}
                  size="sm"
                  className="min-h-11 rounded-full px-4 text-[12px] font-semibold"
                >
                  {saving ? <SpinnerGap size={12} className="animate-spin" /> : null}
                  {today ? "Atualizar" : "Registrar"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
