import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type SharedGoal = {
  id: string;
  title: string;
  target_amount: number;
  deadline: string | null;
  created_by: string;
  status: string;
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
  created_at: string;
};

const K = {
  list: ["shared_goals", "list"] as const,
  detail: (id: string) => ["shared_goals", "detail", id] as const,
  members: (id: string) => ["shared_goals", "members", id] as const,
  contribs: (id: string) => ["shared_goals", "contribs", id] as const,
  invites: (id: string) => ["shared_goals", "invites", id] as const,
};

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

export function useCreateSharedGoal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { title: string; target_amount: number; deadline?: string | null }) => {
      if (!user) throw new Error("unauthenticated");
      const { data, error } = await supabase
        .from("shared_goals")
        .insert({
          title: input.title,
          target_amount: input.target_amount,
          deadline: input.deadline ?? null,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      // owner como membro
      await supabase.from("shared_goal_members").insert({
        goal_id: data.id,
        user_id: user.id,
        role: "owner",
        invite_status: "accepted",
        joined_at: new Date().toISOString(),
      });
      return data as SharedGoal;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared_goals"] }),
  });
}

export function useDeleteSharedGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shared_goals").delete().eq("id", id);
      if (error) throw error;
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
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (phone_e164: string) => {
      if (!user) throw new Error("unauthenticated");
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      const token_hash = await sha256Hex(token);
      const { data, error } = await supabase
        .from("shared_goal_invites")
        .insert({ goal_id: goalId, phone_e164, invited_by: user.id, token_hash })
        .select()
        .single();
      if (error) throw error;
      // reserva slot no members (pending) para exibir no card
      await supabase
        .from("shared_goal_members")
        .insert({ goal_id: goalId, phone_e164, role: "member", invite_status: "pending" })
        .then(() => undefined, () => undefined);
      return { invite: data, token };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shared_goals"] });
    },
  });
}

export function useAddContribution(goalId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { amount: number; occurred_at?: string; note?: string }) => {
      if (!user) throw new Error("unauthenticated");
      const { data, error } = await supabase
        .from("shared_goal_contributions")
        .insert({
          goal_id: goalId,
          user_id: user.id,
          amount: input.amount,
          occurred_at: input.occurred_at ?? new Date().toISOString().slice(0, 10),
          note: input.note ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      // atualiza total do member (best-effort)
      const { data: current } = await supabase
        .from("shared_goal_members")
        .select("id, contribution_total")
        .eq("goal_id", goalId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (current) {
        await supabase
          .from("shared_goal_members")
          .update({ contribution_total: Number(current.contribution_total ?? 0) + input.amount })
          .eq("id", current.id);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shared_goals"] });
    },
  });
}
