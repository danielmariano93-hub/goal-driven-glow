import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/split/math";

type ParticipantSlim = {
  amount_due: number | string;
  amount_paid: number | string;
  phone_e164: string | null;
  linked_user_id?: string | null;
  status?: string;
};

type OwnedItem = {
  id: string;
  title: string;
  total_amount: number;
  occurred_at: string;
  due_date: string | null;
  status: string;
  deleted_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  owner_user_id: string;
  shared_expense_participants: ParticipantSlim[];
};

type JoinedItem = {
  id: string;
  title: string;
  total_amount: number;
  occurred_at: string;
  due_date: string | null;
  status: string;
  owner_user_id: string;
  my_due: number;
  my_paid: number;
  my_status: string;
};

type Scope = "owned" | "joined";
type Filter = "all" | "active" | "settled" | "cancelled";

export default function DivisaoDoRole() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>("owned");
  const [filter, setFilter] = useState<Filter>("all");
  const [owned, setOwned] = useState<OwnedItem[] | null>(null);
  const [joined, setJoined] = useState<JoinedItem[] | null>(null);

  useEffect(() => {
    if (scope !== "owned") return;
    (async () => {
      setOwned(null);
      let q = supabase
        .from("shared_expenses")
        .select(
          "id,title,total_amount,occurred_at,due_date,status,deleted_at,cancelled_at,cancellation_reason,owner_user_id,shared_expense_participants(amount_due,amount_paid,phone_e164,linked_user_id,status)",
        )
        .eq("owner_user_id", user?.id ?? "")
        .order("created_at", { ascending: false });
      if (filter === "all") q = q.is("deleted_at", null);
      else if (filter !== "cancelled") q = q.eq("status", filter);
      else q = q.eq("status", "cancelled");
      const { data } = await q;
      setOwned((data ?? []) as unknown as OwnedItem[]);
    })();
  }, [scope, filter, user?.id]);

  useEffect(() => {
    if (scope !== "joined") return;
    (async () => {
      setJoined(null);
      const { data: parts, error } = await supabase
        .from("shared_expense_participants")
        .select(
          "amount_due,amount_paid,status,shared_expense_id, shared_expenses(id,title,total_amount,occurred_at,due_date,status,owner_user_id,deleted_at)",
        )
        .eq("linked_user_id", user?.id ?? "");
      if (error || !parts) {
        setJoined([]);
        return;
      }
      const rows: JoinedItem[] = (parts as unknown as Array<{
        amount_due: number | string;
        amount_paid: number | string;
        status: string;
        shared_expenses: OwnedItem | null;
      }>)
        .map((r) => {
          const se = r.shared_expenses;
          if (!se || se.deleted_at) return null;
          if (filter !== "all" && se.status !== filter) return null;
          return {
            id: se.id,
            title: se.title,
            total_amount: Number(se.total_amount),
            occurred_at: se.occurred_at,
            due_date: se.due_date,
            status: se.status,
            owner_user_id: se.owner_user_id,
            my_due: Number(r.amount_due),
            my_paid: Number(r.amount_paid),
            my_status: String(r.status ?? ""),
          } satisfies JoinedItem;
        })
        .filter(Boolean) as JoinedItem[];
      setJoined(rows);
    })();
  }, [scope, filter, user?.id]);

  const items = scope === "owned" ? owned : joined;
  const isLoading = items === null;

  return (
    <div className="space-y-5 pt-2">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Divisão do Rolê</h1>
          <p className="text-xs text-muted-foreground">Clareza para dividir, leveza para cobrar</p>
        </div>
        <button onClick={() => nav("/app/divisao-do-role/nova")} className="btn-primary px-4 py-2">
          <Plus size={14} /> Nova
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-full border border-border bg-card p-1">
        <button
          onClick={() => setScope("owned")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${scope === "owned" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Criados por mim
        </button>
        <button
          onClick={() => setScope("joined")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${scope === "joined" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Estou participando
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "active", "settled", "cancelled"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
          >
            {({ all: "Todas", active: "Em andamento", settled: "Concluídas", cancelled: "Canceladas" } as const)[f]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : items!.length === 0 ? (
        <EmptyState scope={scope} />
      ) : scope === "owned" ? (
        <OwnedList items={owned!} />
      ) : (
        <JoinedList items={joined!} />
      )}
    </div>
  );
}

function EmptyState({ scope }: { scope: Scope }) {
  return (
    <div className="surface-card p-8 text-center">
      <Users className="mx-auto text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold">
        {scope === "owned" ? "Você ainda não criou rolês" : "Você ainda não participa de nenhum rolê"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {scope === "owned"
          ? "Divida uma conta com quem foi junto em segundos."
          : "Quando alguém te incluir em um rolê, ele aparece aqui automaticamente."}
      </p>
    </div>
  );
}

function OwnedList({ items }: { items: OwnedItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((s) => {
        const ext = s.shared_expense_participants.filter((p) => p.phone_e164);
        const received = ext.reduce((a, p) => a + Number(p.amount_paid), 0);
        const pending = ext.reduce((a, p) => a + Math.max(0, Number(p.amount_due) - Number(p.amount_paid)), 0);
        const count = ext.filter((p) => Number(p.amount_paid) < Number(p.amount_due)).length;
        const overdue = Boolean(s.due_date && s.status === "active" && s.due_date < new Date().toISOString().slice(0, 10));
        const pct = received + pending ? Math.round((received / (received + pending)) * 100) : 100;
        const deleted = Boolean(s.deleted_at);
        return (
          <Link key={s.id} to={`/app/divisao-do-role/${s.id}`} className={`surface-card block p-4 ${deleted ? "opacity-70" : ""}`}>
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.title}</p>
                <p className={`mt-0.5 text-[11px] ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                  {overdue && <AlertCircle size={11} className="mr-1 inline" />}
                  {deleted
                    ? "Excluído · mantido apenas no histórico"
                    : overdue
                    ? "Pagamento atrasado"
                    : s.status === "settled"
                    ? "Tudo recebido"
                    : s.status === "cancelled"
                    ? "Cancelada"
                    : `${count} pessoa${count === 1 ? "" : "s"} pendente${count === 1 ? "" : "s"}`}
                </p>
              </div>
              <p className="text-sm font-bold">{formatBRL(Number(s.total_amount))}</p>
            </div>
            {!deleted && (
              <>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                  <span>Recebido {formatBRL(received)}</span>
                  <span>Falta {formatBRL(pending)}</span>
                </div>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function JoinedList({ items }: { items: JoinedItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((s) => {
        const remaining = Math.max(0, s.my_due - s.my_paid);
        const pct = s.my_due > 0 ? Math.round((s.my_paid / s.my_due) * 100) : 100;
        const overdue = Boolean(s.due_date && s.status === "active" && s.due_date < new Date().toISOString().slice(0, 10));
        return (
          <Link key={s.id} to={`/app/divisao-do-role/${s.id}`} className="surface-card block p-4">
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.title}</p>
                <p className={`mt-0.5 text-[11px] ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                  {overdue && <AlertCircle size={11} className="mr-1 inline" />}
                  Minha parte
                </p>
              </div>
              <p className="text-sm font-bold">{formatBRL(s.my_due)}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-success" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>Paguei {formatBRL(s.my_paid)}</span>
              <span>Falta {formatBRL(remaining)}</span>
            </div>
          </Link>
        );
      })}
      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        Ao vincular seu WhatsApp com o mesmo número usado por quem criou, você entra automaticamente nos rolês.
      </p>
    </div>
  );
}

// Legacy usage of unused imports kept to satisfy tree-shaker warnings in test env.
export const __unused = useMemo;
