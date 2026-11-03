import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { BenefitEntry, BenefitKind, BenefitWalletConfig } from "@/lib/engine/benefitWallet";
import type { BenefitStatementItem } from "@/lib/engine/benefitStatement";
import { isBenefitFoodCategory } from "@/lib/engine/benefitWallet";

// Ticket Alimentação (contexto separado do livro-razão). As tabelas ainda não estão nos tipos gerados do Supabase.
type Row = Record<string, unknown>;
type Result<T = unknown> = PromiseLike<{ data: T; error: unknown }>;
// Construtor de consulta mínimo (só o que este arquivo usa).
type Query = Result<Row[]> & {
  select: (columns: string) => Query & { maybeSingle: () => Result<Row | null>; single: () => Result<Row> };
  insert: (values: Row | Row[]) => Result<null> & { select: (columns: string) => { single: () => Result<Row> } };
  delete: () => { eq: (column: string, value: string) => Result<null> };
  eq: (column: string, value: unknown) => Query & { maybeSingle: () => Result<Row | null> };
  order: (column: string, opts: { ascending: boolean }) => Query;
  limit: (n: number) => Query;
};
type Loose = {
  from: (table: string) => Query;
  rpc: (name: string) => Promise<{ data: unknown; error: unknown }>;
};
const db = supabase as unknown as Loose;

export type BenefitWalletRow = BenefitWalletConfig & { id: string; name: string };

const KEYS = {
  enabled: (uid?: string) => ["benefit-wallet-enabled", uid] as const,
  wallet: (uid?: string) => ["benefit-wallet", uid] as const,
  entries: (walletId?: string) => ["benefit-entries", walletId] as const,
};

/** Liberação por usuário: falha fechada (qualquer erro = recurso escondido). */
export function useBenefitEnabled() {
  const { user } = useAuth();
  return useQuery({
    queryKey: KEYS.enabled(user?.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await db.rpc("benefit_wallet_enabled");
      return !error && data === true;
    },
  });
}

export function useBenefitWallet(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: KEYS.wallet(user?.id),
    enabled: !!user && enabled,
    queryFn: async (): Promise<BenefitWalletRow | null> => {
      const { data, error } = await db.from("benefit_wallets")
        .select("id,name,monthly_credit,credit_day,carries_over")
        .eq("active", true).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id), name: String(data.name),
        monthly_credit: Number(data.monthly_credit), credit_day: Number(data.credit_day), carries_over: data.carries_over === true,
      };
    },
  });
}

export type BenefitEntryRow = BenefitEntry & { note?: string | null; created_at: string };

export function useBenefitEntries(walletId?: string) {
  return useQuery({
    queryKey: KEYS.entries(walletId),
    enabled: !!walletId,
    queryFn: async (): Promise<BenefitEntryRow[]> => {
      const { data, error } = await db.from("benefit_entries")
        .select("id,kind,amount,occurred_on,merchant,note,created_at")
        .eq("wallet_id", walletId)
        .order("occurred_on", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id), kind: r.kind as BenefitKind, amount: Number(r.amount), occurred_on: String(r.occurred_on),
        merchant: (r.merchant as string | null) ?? null, note: (r.note as string | null) ?? null, created_at: String(r.created_at),
      }));
    },
  });
}

export type NewWallet = { monthly_credit: number; credit_day: number; carries_over: boolean; initial_balance: number; today: string };

/** Cria a carteira e já grava a primeira leitura de saldo (a âncora do cálculo). */
export function useCreateBenefitWallet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewWallet) => {
      if (!user) throw new Error("Sessão expirada");
      const { data, error } = await db.from("benefit_wallets")
        .insert({ user_id: user.id, monthly_credit: input.monthly_credit, credit_day: input.credit_day, carries_over: input.carries_over })
        .select("id").single();
      if (error) throw error;
      const { error: entryError } = await db.from("benefit_entries").insert({
        wallet_id: data.id, user_id: user.id, kind: "balance_reading", amount: input.initial_balance, occurred_on: input.today,
      });
      if (entryError) throw entryError;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["benefit-wallet"] }),
  });
}

export type NewEntry = { wallet_id: string; kind: BenefitKind; amount: number; occurred_on: string; merchant?: string | null };

export function useAddBenefitEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewEntry) => {
      if (!user) throw new Error("Sessão expirada");
      const { error } = await db.from("benefit_entries").insert({
        wallet_id: input.wallet_id, user_id: user.id, kind: input.kind, amount: input.amount,
        occurred_on: input.occurred_on, merchant: input.merchant?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: KEYS.entries(v.wallet_id) }),
  });
}

export function useDeleteBenefitEntry(walletId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("benefit_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.entries(walletId) }),
  });
}

export type StatementRead = { recognized: boolean; items: BenefitStatementItem[]; discarded: number };

/** Envia o print para a leitura (só transcreve; não grava nada). */
export function useReadBenefitStatement() {
  return useMutation({
    mutationFn: async (image: string): Promise<StatementRead> => {
      const { data, error } = await supabase.functions.invoke("benefit-statement-read", { body: { image } });
      if (error || !data?.ok) throw new Error(error?.message ?? "read_failed");
      return { recognized: data.recognized === true, items: data.items as BenefitStatementItem[], discarded: Number(data.discarded ?? 0) };
    },
  });
}

/** Grava as linhas que a pessoa confirmou (origem: documento). */
export function useImportBenefitEntries(walletId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: BenefitStatementItem[]) => {
      if (!user || !walletId) throw new Error("Sessão expirada");
      const rows = items.map((it) => ({
        wallet_id: walletId, user_id: user.id, kind: it.kind, amount: it.amount, occurred_on: it.occurred_on,
        merchant: it.merchant, note: it.time, source: "document",
      }));
      const { error } = await db.from("benefit_entries").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.entries(walletId) }),
  });
}

export type FoodLeak = { amount: number; count: number; categories: string[] };

/** Comida paga do bolso no ciclo (despesas reais de Restaurante, Mercado, Delivery… no livro-razão). Só lê quando há carteira. */
export function useBenefitFoodLeak(from: string | undefined, to: string, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["benefit-food-leak", user?.id, from, to],
    enabled: !!user && enabled && !!from,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FoodLeak> => {
      const cats = await supabase.from("categories").select("id,name").or(`user_id.eq.${user!.id},user_id.is.null`);
      if (cats.error) throw cats.error;
      const food = new Map((cats.data ?? []).filter((c) => isBenefitFoodCategory(c.name)).map((c) => [c.id, c.name as string]));
      if (!food.size) return { amount: 0, count: 0, categories: [] };
      const tx = await supabase.from("transactions").select("amount,category_id,movement_kind,type")
        .eq("user_id", user!.id).eq("type", "expense").gte("occurred_at", from!).lte("occurred_at", to).in("category_id", [...food.keys()]);
      if (tx.error) throw tx.error;
      const rows = (tx.data ?? []).filter((r) => (r.movement_kind ?? "transaction") === "transaction");
      return {
        amount: Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
        count: rows.length,
        categories: [...new Set(rows.map((r) => food.get(r.category_id as string)).filter(Boolean) as string[])].sort(),
      };
    },
  });
}
