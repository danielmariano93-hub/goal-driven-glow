import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";
import { MAPA_QUERY_KEY } from "@/lib/mapa/client";

type Db = { from: (t: string) => any };
const db = () => supabase as unknown as Db;
const KEY = "mapa-capture";

export const DEBT_KIND_OPTIONS = [
  { value: "cartao_rotativo", label: "Cartão (rotativo ou parcelado com juros)" },
  { value: "cheque_especial", label: "Cheque especial" },
  { value: "emprestimo_pessoal", label: "Empréstimo pessoal" },
  { value: "financiamento", label: "Financiamento (carro, casa…)" },
  { value: "informal", label: "Dívida com pessoa conhecida" },
  { value: "outro", label: "Outro" },
] as const;

export const LIQUIDITY_OPTIONS = [
  { value: "d0", label: "Na hora" },
  { value: "d1", label: "Em 1 dia útil" },
  { value: "d30", label: "Em até 30 dias" },
  { value: "longo", label: "Mais de 30 dias" },
] as const;

interface CaptureData {
  categories: Array<{ id: string; name: string; essential: boolean | null }>;
  debts: Array<{ id: string; name: string; kind: string | null; rate: number | null; period: string | null }>;
  investments: Array<{ id: string; name: string; liquidity: string | null }>;
}

function useCaptureData() {
  const { user } = useAuth();
  return useQuery<CaptureData>({
    queryKey: [KEY, user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const [cats, flags, debts, invs] = await Promise.all([
        db().from("categories").select("id,name").eq("type", "expense").is("archived_at", null).order("name"),
        db().from("category_essential_flags").select("category_id,essential"),
        db().from("debts").select("id,name,kind,interest_rate_pct,interest_rate_period,status").eq("status", "active"),
        db().from("investments").select("id,name,liquidity"),
      ]);
      for (const r of [cats, flags, debts, invs]) if (r.error) throw r.error;
      const flagBy = new Map<string, boolean>((flags.data ?? []).map((f: any) => [f.category_id, f.essential]));
      return {
        categories: (cats.data ?? []).map((c: any) => ({ id: c.id, name: c.name, essential: flagBy.has(c.id) ? flagBy.get(c.id)! : null })),
        debts: (debts.data ?? []).map((d: any) => ({ id: d.id, name: d.name, kind: d.kind, rate: d.interest_rate_pct, period: d.interest_rate_period })),
        investments: (invs.data ?? []).map((i: any) => ({ id: i.id, name: i.name, liquidity: i.liquidity })),
      };
    },
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: [KEY] }), qc.invalidateQueries({ queryKey: [MAPA_QUERY_KEY] })]);
}

const card = "rounded-[22px] border border-border bg-card p-4 shadow-card";
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground";
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-[13px] ${on ? "border-primary bg-primary/10 font-semibold" : "border-border"}`;

/** Quais categorias são essenciais (moradia, mercado, saúde…). Sem isso a Segurança usa os gastos totais. */
function EssentialCard({ data }: { data: CaptureData }) {
  const { user } = useAuth();
  const refresh = useRefresh();
  const pending = data.categories.filter((c) => c.essential === null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const save = useMutation({
    mutationFn: async (essentialIds: Set<string>) => {
      const rows = data.categories.map((c) => ({ user_id: user!.id, category_id: c.id, essential: essentialIds.has(c.id), updated_at: new Date().toISOString() }));
      const { error } = await db().from("category_essential_flags").upsert(rows, { onConflict: "user_id,category_id" });
      if (error) throw error;
    },
    onSuccess: async () => { notifySuccess("Anotado. Já uso isso na sua leitura de segurança."); await refresh(); },
    onError: () => notifyError("Não consegui salvar agora. Tente de novo em instantes."),
  });
  if (!pending.length) return null;
  return (
    <section aria-label="O que é essencial" className={card}>
      <p className={eyebrow}>Uma pergunta rápida</p>
      <p className="mt-2 text-sm font-semibold leading-snug">Quais destes gastos você não consegue cortar de um mês para o outro?</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Moradia, mercado, saúde, transporte para trabalhar… Com isso eu calculo quantos meses a sua reserva cobre só do essencial.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.categories.map((c) => {
          const on = picked.has(c.id);
          return (
            <button key={c.id} type="button" aria-pressed={on} className={chip(on)}
              onClick={() => setPicked((p) => { const n = new Set(p); on ? n.delete(c.id) : n.add(c.id); return n; })}>
              {c.name}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={save.isPending || picked.size === 0} onClick={() => save.mutate(picked)}
          className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {save.isPending ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate(new Set())} className="min-h-11 px-3 text-sm font-semibold text-muted-foreground">
          Não sei dizer
        </button>
      </div>
    </section>
  );
}

/** Tipo e taxa de cada dívida. Cada campo aceita "não sei". */
function DebtCard({ data }: { data: CaptureData }) {
  const refresh = useRefresh();
  const pending = data.debts.filter((d) => !d.kind || d.rate === null || !d.period);
  const [id, setId] = useState<string | null>(null);
  const debt = pending.find((d) => d.id === (id ?? pending[0]?.id)) ?? null;
  const [kind, setKind] = useState<string>("");
  const [rate, setRate] = useState("");
  const [period, setPeriod] = useState<"mes" | "ano">("mes");
  const save = useMutation({
    mutationFn: async () => {
      if (!debt) return;
      const patch: Record<string, unknown> = {};
      if (kind) patch.kind = kind;
      const n = Number(rate.replace(",", "."));
      if (rate.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1000) { patch.interest_rate_pct = n; patch.interest_rate_period = period; }
      if (!Object.keys(patch).length) return;
      const { error } = await db().from("debts").update(patch).eq("id", debt.id);
      if (error) throw error;
    },
    onSuccess: async () => { notifySuccess("Anotado."); setKind(""); setRate(""); setId(null); await refresh(); },
    onError: () => notifyError("Não consegui salvar agora. Tente de novo em instantes."),
  });
  if (!debt) return null;
  return (
    <section aria-label="Detalhes das dívidas" className={card}>
      <p className={eyebrow}>Sobre as suas dívidas</p>
      {pending.length > 1 ? (
        <select aria-label="Dívida" value={debt.id} onChange={(e) => { setId(e.target.value); setKind(""); setRate(""); }}
          className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
          {pending.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      ) : <p className="mt-2 text-sm font-semibold">{debt.name}</p>}
      {!debt.kind ? (
        <fieldset className="mt-3">
          <legend className="text-[13px] font-semibold">Que tipo de dívida é?</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DEBT_KIND_OPTIONS.map((o) => <button key={o.value} type="button" aria-pressed={kind === o.value} onClick={() => setKind(o.value)} className={chip(kind === o.value)}>{o.label}</button>)}
          </div>
        </fieldset>
      ) : null}
      {debt.rate === null || !debt.period ? (
        <fieldset className="mt-3">
          <legend className="text-[13px] font-semibold">Quanto de juros ela cobra?</legend>
          <div className="mt-1.5 flex items-center gap-2">
            <input inputMode="decimal" aria-label="Taxa de juros em porcentagem" placeholder="Ex.: 3,5" value={rate} onChange={(e) => setRate(e.target.value)}
              className="min-h-11 w-24 rounded-xl border border-border bg-background px-3 text-sm" />
            <span className="text-sm">%</span>
            {(["mes", "ano"] as const).map((p) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={chip(period === p)}>{p === "mes" ? "ao mês" : "ao ano"}</button>)}
          </div>
        </fieldset>
      ) : null}
      <p className="mt-2 text-[12px] text-muted-foreground">Se não souber algum dos dois, deixe em branco. Prefiro não saber a chutar.</p>
      <button type="button" disabled={save.isPending || (!kind && rate.trim() === "")} onClick={() => save.mutate()}
        className="mt-2 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {save.isPending ? "Salvando…" : "Salvar"}
      </button>
    </section>
  );
}

/** Em quanto tempo cada investimento vira dinheiro. Sem isso, não conto o investimento como reserva. */
function LiquidityCard({ data }: { data: CaptureData }) {
  const refresh = useRefresh();
  const pending = data.investments.filter((i) => !i.liquidity || i.liquidity === "desconhecida");
  const save = useMutation({
    mutationFn: async (v: { id: string; liquidity: string }) => {
      const { error } = await db().from("investments").update({ liquidity: v.liquidity }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: async () => { await refresh(); },
    onError: () => notifyError("Não consegui salvar agora. Tente de novo em instantes."),
  });
  if (!pending.length) return null;
  return (
    <section aria-label="Liquidez dos investimentos" className={card}>
      <p className={eyebrow}>Sobre os seus investimentos</p>
      <p className="mt-2 text-sm font-semibold leading-snug">Se você precisasse do dinheiro, em quanto tempo ele estaria na conta?</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Só conto como reserva o que vira dinheiro em até 30 dias.</p>
      <ul className="mt-3 space-y-3">
        {pending.map((i) => (
          <li key={i.id}>
            <p className="text-[13px] font-semibold">{i.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {LIQUIDITY_OPTIONS.map((o) => <button key={o.value} type="button" disabled={save.isPending} onClick={() => save.mutate({ id: i.id, liquidity: o.value })} className={chip(false)}>{o.label}</button>)}
              <button type="button" disabled={save.isPending} onClick={() => save.mutate({ id: i.id, liquidity: "desconhecida" })} className="min-h-11 px-3 text-[13px] font-semibold text-muted-foreground">Não sei</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cartões de captura guiada. Só aparecem para o que o Mapa realmente precisa saber. */
export function MapaCaptureCards({ needs }: { needs: ReadonlySet<string> }) {
  const { data } = useCaptureData();
  if (!data) return null;
  return (
    <>
      {needs.has("essencial_categoria") ? <EssentialCard data={data} /> : null}
      {needs.has("debt_rate") || needs.has("debt_kind") ? <DebtCard data={data} /> : null}
      {needs.has("liquidez_investimento") ? <LiquidityCard data={data} /> : null}
    </>
  );
}
