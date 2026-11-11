// Cola dos lembretes de Hábitos com o motor proativo existente: devolve sugestões no formato de
// `pending_proactive_suggestions`, que o despachante (política, silêncio, catálogo, canais) já sabe entregar.
// Só gera algo para quem tem Hábitos liberado; qualquer falha devolve [] (nunca derruba o motor).
import { habitReminders, type HabitReminder } from "./reminders.ts";
import type { HbSnapshotAs, RpcLike } from "./whatsappReply.ts";

/** Cadeia mínima de consulta usada aqui (select/eq/in/gte/order/limit). */
type Chain = {
  select: (c: string) => Chain; eq: (c: string, v: unknown) => Chain; in: (c: string, v: unknown[]) => Chain;
  gte: (c: string, v: unknown) => Chain; order: (c: string, o: { ascending: boolean }) => Chain;
  limit: (n: number) => PromiseLike<{ data: unknown }>;
};
type DbLike = RpcLike & { from: (t: string) => Chain };

export type HabitSuggestion = {
  user_id: string;
  kind: HabitReminder["kind"];
  severity: "info";
  title: string;
  body: string;
  action: { type: "habit_reminder"; route: string };
  evidence: Record<string, unknown>;
  channel_ready: "both";
  dedup_key: string;
  expires_at: string;
};

const ACCEPTED = new Set(["queued", "sent", "delivered", "acted"]);

export async function habitSuggestions(client: unknown, userId: string, now: Date, cooldowns?: ReadonlySet<string>): Promise<HabitSuggestion[]> {
  try {
    const sb = client as DbLike;
    const { data, error } = await sb.rpc("hb_snapshot_as", { p_user: userId, p_days: 14 });
    if (error || !data) return [];
    const snap = data as HbSnapshotAs;
    if (!snap.nudges_enabled || snap.habits.length === 0) return [];

    const { data: rows } = await sb.from("communication_deliveries")
      .select("kind,dedup_key,status,interacted_at,created_at")
      .eq("user_id", userId)
      .in("kind", ["hb_cue_reminder", "hb_daily_recap"])
      .gte("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(40);
    const history = ((rows as Array<{ kind: string; dedup_key: string | null; status: string; interacted_at: string | null; created_at: string }> | null) ?? []);

    const sentKeys = new Set<string>(cooldowns ?? []);
    for (const r of history) if (r.dedup_key && ACCEPTED.has(r.status)) sentKeys.add(r.dedup_key);
    const alreadySentToday = [...sentKeys].filter((k) => k.startsWith("hb-") && k.includes(`:${snap.today}`) || k === `hb-recap:${snap.today}`).length;

    // Lembretes de gatilho mais recentes seguidos sem resposta (só os já entregues há mais de 2 h contam como "ignorados").
    let ignored = 0;
    for (const r of history.filter((x) => x.kind === "hb_cue_reminder" && (x.status === "sent" || x.status === "delivered" || x.status === "acted"))) {
      const old = now.getTime() - Date.parse(r.created_at) >= 2 * 3_600_000;
      if (r.interacted_at) break;
      if (!old) continue;
      ignored += 1;
    }

    return habitReminders({ snap, now, alreadySentToday, sentKeys, ignoredCueStreak: ignored }).map((r) => ({
      user_id: userId, kind: r.kind, severity: r.severity, title: r.title, body: r.body,
      action: { type: "habit_reminder" as const, route: "/h/hoje" },
      evidence: r.evidence, channel_ready: "both" as const, dedup_key: r.dedup_key,
      expires_at: new Date(now.getTime() + r.expires_in_min * 60_000).toISOString(),
    }));
  } catch (e) {
    console.warn("[habits] reminders_failed", String((e as Error)?.message ?? "").slice(0, 160));
    return [];
  }
}
