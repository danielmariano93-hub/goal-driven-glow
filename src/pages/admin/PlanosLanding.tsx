import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { PRICE_INTENT_LABEL, type FeatureValue } from "@/lib/plans/landingPlans";

type PlanDraft = {
  slug: string; name: string; tagline: string; price_monthly: string; price_yearly: string;
  availability: "available" | "coming_soon"; cta_label: string; badge: string; highlighted: boolean; active: boolean;
};
type FeatureDraft = { key: string; label: string; description: string };
type Cell = { value: FeatureValue; note: string };
type Metric = { plan_slug: string; views: number; viewers: number; clicks: number; opens: number; joins: number };
type Server = {
  plans: Array<Record<string, any>>;
  features: Array<{ key: string; label: string; description: string | null }>;
  values: Array<{ plan: string; feature: string; value: FeatureValue; note: string | null }>;
  metrics: Metric[];
  intent: Array<{ plan: string; intent: string; n: number }>;
  waitlist: Array<{ plan: string; email: string; intent: string | null; at: string }>;
};

const cellKey = (plan: string, feature: string) => `${plan}|${feature}`;
const slugKey = (label: string) =>
  label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "recurso";
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

const input = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm";

/** Admin: planos e preços da landing, matriz de funcionalidades e leitura do interesse (fake door). */
export default function PlanosLanding() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-landing-plans"], queryFn: () => callAdminRpc<Server>("admin_landing_plans_get") });
  const [plans, setPlans] = useState<PlanDraft[]>([]);
  const [features, setFeatures] = useState<FeatureDraft[]>([]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const d = q.data;
    if (!d || dirty) return;
    setPlans(d.plans.map((p) => ({
      slug: p.slug, name: p.name, tagline: p.tagline ?? "", price_monthly: p.price_monthly == null ? "" : String(p.price_monthly),
      price_yearly: p.price_yearly == null ? "" : String(p.price_yearly), availability: p.availability, cta_label: p.cta_label,
      badge: p.badge ?? "", highlighted: !!p.highlighted, active: p.active !== false,
    })));
    setFeatures(d.features.map((f) => ({ key: f.key, label: f.label, description: f.description ?? "" })));
    setCells(Object.fromEntries(d.values.map((v) => [cellKey(v.plan, v.feature), { value: v.value, note: v.note ?? "" }])));
  }, [q.data, dirty]);

  const touch = () => setDirty(true);
  const setPlan = (i: number, patch: Partial<PlanDraft>) => { setPlans((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch(); };
  const setFeature = (i: number, patch: Partial<FeatureDraft>) => { setFeatures((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch(); };
  const setCell = (plan: string, feature: string, patch: Partial<Cell>) => {
    setCells((c) => ({ ...c, [cellKey(plan, feature)]: { value: "no", note: "", ...c[cellKey(plan, feature)], ...patch } })); touch();
  };
  const moveFeature = (i: number, dir: -1 | 1) => {
    setFeatures((f) => { const n = [...f]; const j = i + dir; if (j < 0 || j >= n.length) return f; [n[i], n[j]] = [n[j], n[i]]; return n; }); touch();
  };
  const addFeature = () => {
    setFeatures((f) => {
      let key = "novo_recurso"; let n = 2;
      while (f.some((x) => x.key === key)) key = `novo_recurso_${n++}`;
      return [...f, { key, label: "Novo recurso", description: "" }];
    }); touch();
  };
  const removeFeature = (key: string) => { setFeatures((f) => f.filter((x) => x.key !== key)); touch(); };

  const invalid = useMemo(() => {
    for (const p of plans) {
      if (!p.name.trim() || !p.cta_label.trim()) return `Preencha nome e texto do botão de "${p.slug}".`;
      for (const v of [p.price_monthly, p.price_yearly]) {
        const n = num(v);
        if (n != null && (!Number.isFinite(n) || n < 0)) return `Preço inválido em "${p.name}".`;
      }
    }
    if (features.some((f) => !f.label.trim())) return "Todo recurso precisa de um nome.";
    return null;
  }, [plans, features]);

  const save = useMutation({
    mutationFn: () => callAdminRpc("admin_landing_plans_save", {
      _doc: {
        plans: plans.map((p) => ({ ...p, price_monthly: num(p.price_monthly), price_yearly: num(p.price_yearly) })),
        features: features.map((f) => ({ ...f, key: f.key || slugKey(f.label) })),
        values: Object.entries(cells)
          .map(([k, c]) => { const [plan, feature] = k.split("|"); return { plan, feature, value: c.value, note: c.value === "limited" ? c.note.trim() || null : null }; })
          .filter((v) => plans.some((p) => p.slug === v.plan) && features.some((f) => f.key === v.feature)),
      },
    }),
    onSuccess: () => {
      setDirty(false);
      toast.success("Planos salvos. A landing já reflete as mudanças.");
      qc.invalidateQueries({ queryKey: ["admin-landing-plans"] });
      qc.invalidateQueries({ queryKey: ["landing-plans"] });
    },
    onError: () => toast.error("Não consegui salvar. Confira os campos e tente de novo."),
  });

  if (q.isLoading) return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">Não consegui carregar os planos agora.</p>;
  const metrics = q.data.metrics;

  return (
    <div className="space-y-6">
      <section className="surface-card space-y-3 p-4 md:p-5">
        <header>
          <h2 className="font-display text-base font-semibold">Interesse nos planos (últimos 30 dias)</h2>
          <p className="text-xs text-muted-foreground">Nenhum pagamento está conectado: isto mede só o interesse. Conversão = entradas na lista ÷ visitantes que viram os planos.</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Plano</th><th>Visitantes</th><th>Cliques no botão</th><th>Abriu a lista</th><th>Entrou na lista</th><th>Conversão</th></tr></thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.plan_slug} className="border-t border-border tabular-nums">
                  <td className="py-2 font-medium">{plans.find((p) => p.slug === m.plan_slug)?.name ?? m.plan_slug}</td>
                  <td>{m.viewers}</td><td>{m.clicks}</td><td>{m.opens}</td><td>{m.joins}</td>
                  <td>{m.viewers > 0 ? `${Math.round((m.joins / m.viewers) * 1000) / 10}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.data.intent.length > 0 ? (
          <div className="text-xs">
            <p className="mb-1 font-semibold text-muted-foreground">Quanto pagariam (quem entrou na lista)</p>
            <ul className="flex flex-wrap gap-2">
              {q.data.intent.map((i, k) => (
                <li key={k} className="rounded-full bg-secondary px-3 py-1">{PRICE_INTENT_LABEL[i.intent as keyof typeof PRICE_INTENT_LABEL] ?? i.intent}: <strong>{i.n}</strong></li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="surface-card space-y-4 p-4 md:p-5">
        <header>
          <h2 className="font-display text-base font-semibold">Planos</h2>
          <p className="text-xs text-muted-foreground">Nome, descrição, preço e botão de cada plano. Preço vazio com "Em breve" mostra só "Em breve" na landing.</p>
        </header>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.slug} className="space-y-2 rounded-2xl border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{p.slug}</p>
              <label className="block text-xs">Nome<input className={input} value={p.name} maxLength={40} onChange={(e) => setPlan(i, { name: e.target.value })} /></label>
              <label className="block text-xs">Descrição curta<input className={input} value={p.tagline} maxLength={160} onChange={(e) => setPlan(i, { tagline: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs">Preço/mês (R$)<input className={input} inputMode="decimal" value={p.price_monthly} onChange={(e) => setPlan(i, { price_monthly: e.target.value })} placeholder="vazio" /></label>
                <label className="block text-xs">Preço/ano (R$)<input className={input} inputMode="decimal" value={p.price_yearly} onChange={(e) => setPlan(i, { price_yearly: e.target.value })} placeholder="vazio" /></label>
              </div>
              <label className="block text-xs">Disponibilidade
                <select className={input} value={p.availability} onChange={(e) => setPlan(i, { availability: e.target.value as PlanDraft["availability"] })}>
                  <option value="available">Disponível (botão leva ao cadastro)</option>
                  <option value="coming_soon">Em breve (botão abre a lista de espera)</option>
                </select>
              </label>
              <label className="block text-xs">Texto do botão<input className={input} value={p.cta_label} maxLength={40} onChange={(e) => setPlan(i, { cta_label: e.target.value })} /></label>
              <label className="block text-xs">Selo (opcional)<input className={input} value={p.badge} maxLength={24} onChange={(e) => setPlan(i, { badge: e.target.value })} /></label>
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.highlighted} onChange={(e) => setPlan(i, { highlighted: e.target.checked })} /> Destacar</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.active} onChange={(e) => setPlan(i, { active: e.target.checked })} /> Mostrar na landing</label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 md:p-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold">Funcionalidades por plano</h2>
            <p className="text-xs text-muted-foreground">Incluído, limitado (com observação, ex.: "1 rolê por mês") ou não incluído. Isto só muda a vitrine; não bloqueia ninguém no app.</p>
          </div>
          <button type="button" onClick={addFeature} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"><Plus size={14} /> Recurso</button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Recurso</th>
                {plans.map((p) => <th key={p.slug}>{p.name}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr key={f.key} className="border-t border-border align-top">
                  <td className="space-y-1 py-2 pr-3">
                    <input className={input} value={f.label} maxLength={80} onChange={(e) => setFeature(i, { label: e.target.value })} aria-label="Nome do recurso" />
                    <input className={`${input} text-xs`} value={f.description} maxLength={160} placeholder="Descrição" onChange={(e) => setFeature(i, { description: e.target.value })} aria-label="Descrição do recurso" />
                  </td>
                  {plans.map((p) => {
                    const c = cells[cellKey(p.slug, f.key)] ?? { value: "no" as FeatureValue, note: "" };
                    return (
                      <td key={p.slug} className="space-y-1 py-2 pr-2">
                        <select className={input} value={c.value} onChange={(e) => setCell(p.slug, f.key, { value: e.target.value as FeatureValue })} aria-label={`${f.label} em ${p.name}`}>
                          <option value="yes">Incluído</option>
                          <option value="limited">Limitado</option>
                          <option value="no">Não incluído</option>
                        </select>
                        {c.value === "limited" ? <input className={`${input} text-xs`} value={c.note} maxLength={60} placeholder="ex.: 1 rolê por mês" onChange={(e) => setCell(p.slug, f.key, { note: e.target.value })} /> : null}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap py-2">
                    <button type="button" onClick={() => moveFeature(i, -1)} className="p-1.5 text-muted-foreground" aria-label="Subir"><ArrowUp size={14} /></button>
                    <button type="button" onClick={() => moveFeature(i, 1)} className="p-1.5 text-muted-foreground" aria-label="Descer"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => removeFeature(f.key)} className="p-1.5 text-destructive" aria-label="Remover recurso"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        {invalid ? <span className="mr-auto text-xs text-destructive">{invalid}</span> : dirty ? <span className="mr-auto text-xs text-muted-foreground">Alterações não salvas.</span> : null}
        {dirty ? <button type="button" onClick={() => { setDirty(false); q.refetch(); }} className="rounded-full border border-border px-4 py-2 text-sm">Descartar</button> : null}
        <button type="button" disabled={!dirty || !!invalid || save.isPending} onClick={() => save.mutate()} className="btn-brand inline-flex items-center gap-2 disabled:opacity-50">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar e publicar na landing"}
        </button>
      </div>

      <section className="surface-card space-y-2 p-4 md:p-5">
        <h2 className="font-display text-base font-semibold">Lista de espera ({q.data.waitlist.length})</h2>
        {q.data.waitlist.length === 0 ? <p className="text-xs text-muted-foreground">Ninguém entrou ainda.</p> : (
          <ul className="divide-y divide-border text-sm">
            {q.data.waitlist.map((w, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{w.email}</span>
                <span className="text-xs text-muted-foreground">
                  {plans.find((p) => p.slug === w.plan)?.name ?? w.plan} · {PRICE_INTENT_LABEL[(w.intent ?? "nao_informou") as keyof typeof PRICE_INTENT_LABEL]} · {new Date(w.at).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
