import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Users, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";

type Split = {
  id: string;
  title: string;
  total_amount: number;
  occurred_at: string;
  due_date: string | null;
  status: string;
};

export default function DivisaoDoRole() {
  const nav = useNavigate();
  const [items, setItems] = useState<Split[] | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "settled">("all");

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("shared_expenses" as any)
        .select("id,title,total_amount,occurred_at,due_date,status")
        .order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data } = await q;
      setItems((data as any) ?? []);
    })();
  }, [filter]);

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Divisão do Rolê</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Divida contas com clareza e sem constrangimento</p>
        </div>
        <button
          onClick={() => nav("/app/divisao-do-role/nova")}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
        >
          <Plus size={14} /> Nova
        </button>
      </div>

      <div className="flex gap-2">
        {(["all", "active", "settled"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
          >
            {f === "all" ? "Todas" : f === "active" ? "Ativas" : "Quitadas"}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <Users className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma divisão ainda</p>
          <p className="text-xs text-muted-foreground mt-1">Crie uma para dividir uma conta com amigos.</p>
        </div>
      ) : (
        <div className="surface-card divide-y divide-border overflow-hidden">
          {items.map((s) => (
            <Link key={s.id} to={`/app/divisao-do-role/${s.id}`} className="block px-4 py-3 hover:bg-secondary/40">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(s.occurred_at).toLocaleDateString("pt-BR")} · {s.status}</p>
                </div>
                <span className="text-sm font-semibold">{formatBRL(Number(s.total_amount))}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
