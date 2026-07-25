import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SharedGoal = {
  id: string;
  title: string;
  target_amount: number;
  deadline: string | null;
  created_by: string;
  status: string;
  cancelled_at?: string | null;
  completed_at?: string | null;
  last_milestone_pct?: number;
  created_at: string;
  updated_at: string;
};

export type SharedGoalMember = {
  id: string;
  goal_id: string;
  user_id: string | null;
  phone_e164: string | null;
  role: "owner" | "member";
  invite_status: "pending" | "accepted" | "declined" | "revoked";
  joined_at: string | null;
  contribution_total: number;
};

export type SharedGoalContribution = {
  id: string;
  goal_id: string;
  user_id: string;
  amount: number;
  occurred_at: string;
  note: string | null;
  idempotency_key?: string | null;
  created_at: string;
};

export type SharedGoalInvite = {
  id: string;
  goal_id: string;
  phone_e164: string;
  invited_by: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
};

export type SharedGoalRole = "owner" | "member" | "pending" | "outsider";

const K = {
  list: ["shared_goals", "list"] as const,
  detail: (id: string) => ["shared_goals", "detail", id] as const,
  members: (id: string) => ["shared_goals", "members", id] as const,
  contribs: (id: string) => ["shared_goals", "contribs", id] as const,
  pendingInvites: ["shared_goals", "pending_invites"] as const,
  role: (id: string) => ["shared_goals", "role", id] as const,
};

// Sem tipagem estrita do Database — usa cast controlado para RPCs custom novas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

async function callRpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- Queries ----------
export function useSharedGoals() {
  return useQuery({
    queryKey: K.list,
    queryFn: async (): Promise<SharedGoal[]> => {
      const { data, error } = await supabase
        .from("shared_goals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedGoal[];
    },
  });
}

export function useSharedGoal(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: K.detail(id ?? ""),
    queryFn: async (): Promise<SharedGoal | null> => {
      const { data, error } = await supabase.from("shared_goals").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as SharedGoal | null;
    },
  });
}

export function useSharedGoalMembers(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: K.members(id ?? ""),
    queryFn: async (): Promise<SharedGoalMember[]> => {
      const { data, error } = await supabase.from("shared_goal_members").select("*").eq("goal_id", id!);
      if (error) throw error;
      return (data ?? []) as SharedGoalMember[];
    },
  });
}

export function useSharedGoalContribs(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: K.contribs(id ?? ""),
    queryFn: async (): Promise<SharedGoalContribution[]> => {
      const { data, error } = await supabase
        .from("shared_goal_contributions")
        .select("*")
        .eq("goal_id", id!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedGoalContribution[];
    },
  });
}

export function useSharedGoalRole(id: string | undefined, userId: string | undefined) {
  return useQuery({
    enabled: Boolean(id && userId),
    queryKey: K.role(id ?? ""),
    queryFn: async (): Promise<SharedGoalRole> => {
      const data = await callRpc<string>("shared_goal_role", { _goal_id: id, _user_id: userId });
      return (data as SharedGoalRole) ?? "outsider";
    },
  });
}

/** Convites pendentes endereçados ao usuário atual (via WhatsApp link). */
export function usePendingSharedGoalInvites() {
  return useQuery({
    queryKey: K.pendingInvites,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_goal_invites")
        .select("id, goal_id, phone_e164, invited_by, status, expires_at, created_at, shared_goals(title,target_amount,deadline)")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());
      if (error) throw error;
      return (data ?? []) as Array<SharedGoalInvite & { shared_goals?: { title: string; target_amount: number; deadline: string | null } | null }>;
    },
  });
}

// ---------- Mutations (RPCs canônicas) ----------

export function useCreateSharedGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; target_amount: number; deadline?: string | null }) => {
      const id = await callRpc<string>("shared_goal_create", {
        p_title: input.title,
        p_target_amount: input.target_amount,
        p_deadline: input.deadline ?? null,
      });
      return { id } as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useInviteSharedGoal(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (phone_e164: string) => {
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      const token_hash = await sha256Hex(token);
      const id = await callRpc<string>("shared_goal_invite", {
        p_goal_id: goalId,
        p_phone_e164: phone_e164,
        p_token_hash: token_hash,
      });
      // Enqueue WhatsApp notifications (imediata + followup 72h). Falha aqui
      // NÃO desfaz o convite principal — apenas registra o erro em console.
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.functions.invoke("shared-goal-notify-invite", {
          body: { goal_id: goalId, phone_e164 },
        });
      } catch (err) {
        console.warn("shared_goal_notify_invite_failed", (err as Error).message);
      }
      return { id, token };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useAcceptSharedGoalInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (goalId: string) => callRpc<{ ok: boolean; goal_id: string }>("shared_goal_accept_invite", { p_goal_id: goalId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useDeclineSharedGoalInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (goalId: string) => callRpc<{ ok: boolean }>("shared_goal_decline_invite", { p_goal_id: goalId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useAddContribution(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { amount: number; occurred_at?: string; note?: string; idempotency_key?: string }) => {
      const id = await callRpc<string>("shared_goal_add_contribution", {
        p_goal_id: goalId,
        p_amount: input.amount,
        p_occurred_at: input.occurred_at ?? null,
        p_note: input.note ?? null,
        p_idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useLeaveSharedGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (goalId: string) => callRpc<{ ok: boolean }>("shared_goal_leave", { p_goal_id: goalId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useRemoveSharedGoalMember(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) =>
      callRpc<{ ok: boolean }>("shared_goal_remove_member", { p_goal_id: goalId, p_member_id: memberId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useUpdateSharedGoal(goalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string | null; target_amount?: number | null; deadline?: string | null }) =>
      callRpc<{ ok: boolean }>("shared_goal_update", {
        p_goal_id: goalId,
        p_title: input.title ?? null,
        p_target_amount: input.target_amount ?? null,
        p_deadline: input.deadline ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useCancelSharedGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (goalId: string) => callRpc<{ ok: boolean }>("shared_goal_cancel", { p_goal_id: goalId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

/** Compat: manter export legado usado por MetasConjuntas.tsx */
export function useDeleteSharedGoal() {
  return useCancelSharedGoal();
}
