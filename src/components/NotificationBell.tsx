import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export function NotificationBell() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      const { count: c } = await supabase
        .from("notifications" as any)
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (active) setCount(c ?? 0);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { active = false; clearInterval(t); };
  }, [user]);

  return (
    <Link
      to="/app/notificacoes"
      className="relative inline-flex items-center justify-center rounded-full border border-border bg-card w-8 h-8 text-muted-foreground hover:text-foreground"
      aria-label={`Notificações${count > 0 ? `, ${count} não lidas` : ""}`}
    >
      <Bell size={14} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 grid place-items-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
