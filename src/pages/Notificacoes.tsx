import { useEffect, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function Notificacoes() {
  const [items, setItems] = useState<any[] | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("notifications" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    await supabase.rpc("mark_all_notifications_read" as any);
    await load();
  };
  const markRead = async (id: string) => {
    await supabase.from("notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
    await load();
  };

  if (items === null) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Notificações</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Confirmações, lembretes e conquistas</p>
        </div>
        <button onClick={markAllRead} className="rounded-full border border-border px-3 py-1.5 text-xs">Marcar todas lidas</button>
      </div>

      {items.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <Bell className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma notificação</p>
          <p className="text-xs text-muted-foreground mt-1">Você verá aqui confirmações do agente, recorrências, metas e conquistas.</p>
        </div>
      ) : (
        <div className="surface-card divide-y divide-border overflow-hidden">
          {items.map((n: any) => {
            const Body = (
              <>
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-[11px] text-muted-foreground mt-0.5">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
                </div>
                {!n.read_at && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
              </>
            );
            const content = n.action_url ? (
              <Link to={n.action_url} onClick={() => markRead(n.id)} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/40">
                {Body}
              </Link>
            ) : (
              <button onClick={() => markRead(n.id)} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40">
                {Body}
              </button>
            );
            return <div key={n.id}>{content}</div>;
          })}
        </div>
      )}
    </div>
  );
}
