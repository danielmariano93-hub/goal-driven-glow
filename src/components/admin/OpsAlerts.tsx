import { useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Siren } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { sinceText, useOpsAlerts, useSaveOpsAlertSettings, type OpsAlertSettings } from "@/lib/admin/opsAlerts";

/** Faixa no topo de qualquer tela do admin enquanto houver alerta aberto. */
export function OpsAlertsBanner() {
  const { data } = useOpsAlerts();
  const open = data?.open ?? [];
  if (open.length === 0) return null;
  const critical = open.filter((a) => a.severity === "critical");
  const first = critical[0] ?? open[0];
  return (
    <div role="alert" data-testid="ops-alerts-banner" className={`mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${critical.length ? "border-destructive/40 bg-destructive/10" : "border-warning/50 bg-warning/10"}`}>
      {critical.length ? <Siren size={18} className="shrink-0 text-destructive" aria-hidden /> : <AlertTriangle size={18} className="shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{first.title}</p>
        <p className="text-xs text-muted-foreground">{first.detail ?? ""} {sinceText(first.since)}{open.length > 1 ? ` · mais ${open.length - 1} alerta${open.length > 2 ? "s" : ""}` : ""}</p>
      </div>
      <Link to="/admin/saude" className="shrink-0 text-xs font-semibold text-primary hover:underline">Ver detalhes</Link>
    </div>
  );
}

/** Avisos de funcionamento abertos agora (some quando não há nenhum). Fica na página de saúde, não na home. */
export function OpenAlertsList() {
  const { data } = useOpsAlerts();
  const open = data?.open ?? [];
  if (open.length === 0) return null;
  return (
    <section aria-label="Avisos de funcionamento abertos" className="space-y-2" data-testid="open-alerts-list">
      <h2 className="font-display text-sm font-semibold">Avisos de funcionamento abertos</h2>
      <ul className="space-y-2">
        {open.map((a) => (
          <li key={a.key} className={`rounded-2xl border px-3.5 py-3 ${a.severity === "critical" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/5"}`}>
            <p className="text-sm font-semibold">{a.title}</p>
            <p className="text-xs text-muted-foreground">{a.detail} · {sinceText(a.since)}</p>
          </li>
        ))}
      </ul>
      <Link to="/admin/administracao?secao=configuracoes" className="text-xs font-semibold text-primary hover:underline">Onde e com que frequência receber os avisos</Link>
    </section>
  );
}

/** Alertas abertos, histórico recente e onde receber os avisos. */
export function OpsAlertsPanel() {
  const { data } = useOpsAlerts();
  const save = useSaveOpsAlertSettings();
  const [draft, setDraft] = useState<OpsAlertSettings | null>(null);
  if (!data) return null;
  const s = draft ?? data.settings;
  const dirty = draft != null;
  const set = (patch: Partial<OpsAlertSettings>) => setDraft({ ...s, ...patch });

  return (
    <section className="surface-card space-y-4 p-4 md:p-5" data-testid="ops-alerts-panel">
      <header className="flex items-start gap-3">
        <BellRing size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 className="font-display text-base font-semibold">Alertas de funcionamento</h2>
          <p className="text-xs text-muted-foreground">O Nino confere mensagens presas, rotinas e IA a cada 5 minutos (é barato) e se o servidor do WhatsApp está no ar no intervalo que você escolher abaixo. Quando algo cai, avisa você.</p>
        </div>
      </header>

      {data.open.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl bg-success/10 px-3 py-2.5 text-sm text-success"><CheckCircle2 size={16} aria-hidden /> Nenhum aviso aberto agora.</p>
      ) : (
        <ul className="space-y-2">
          {data.open.map((a) => (
            <li key={a.key} className={`rounded-2xl border px-3 py-2.5 ${a.severity === "critical" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/5"}`}>
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.detail} · {sinceText(a.since)}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-2xl border border-border p-3">
        <p className="text-xs font-semibold text-muted-foreground">Onde você quer receber os avisos</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Avisos ligados</label>
        <label className="block text-xs">
          Código do celular (ntfy) <span className="text-muted-foreground">— chega no celular mesmo com o WhatsApp fora do ar</span>
          <input className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" value={s.ntfy_topic ?? ""} maxLength={64} placeholder="ex.: nino-alertas-x7k29fq3" onChange={(e) => set({ ntfy_topic: e.target.value })} />
        </label>
        <label className="block text-xs">Meu número de WhatsApp <span className="text-muted-foreground">— com DDI e DDD, ex.: +5511999999999</span>
          <input className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" inputMode="tel" value={s.whatsapp_to ?? ""} maxLength={20} onChange={(e) => set({ whatsapp_to: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.notify_whatsapp} onChange={(e) => set({ notify_whatsapp: e.target.checked })} /> Também avisar no meu WhatsApp (não vale para falhas do próprio WhatsApp)</label>
        <label className="block text-xs">Conferir se o servidor do WhatsApp está no ar a cada
          <select className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" value={s.waha_check_hours ?? 12} onChange={(e) => set({ waha_check_hours: Number(e.target.value) })}>
            {[1, 3, 6, 12, 24, 48, 168].map((h) => <option key={h} value={h}>{h === 168 ? "1 vez por semana" : h === 24 ? "1 vez por dia" : h === 48 ? "A cada 2 dias" : `A cada ${h} hora${h === 1 ? "" : "s"}`}</option>)}
          </select>
          <span className="mt-1 block text-muted-foreground">Se o WhatsApp cair, o Nino passa a conferir a cada 5 minutos até voltar.</span>
        </label>
        <label className="block text-xs">Repetir o aviso enquanto o problema durar
          <select className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" value={s.renotify_minutes} onChange={(e) => set({ renotify_minutes: Number(e.target.value) })}>
            <option value={0}>Não repetir</option>
            <option value={60}>A cada 1 hora</option>
            <option value={120}>A cada 2 horas</option>
            <option value={360}>A cada 6 horas</option>
          </select>
        </label>
        {dirty ? (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded-full border border-border px-4 py-2 text-sm">Descartar</button>
            <button type="button" disabled={save.isPending} className="btn-brand" onClick={() => save.mutate(s, { onSuccess: () => { setDraft(null); toast.success("Avisos salvos."); }, onError: () => toast.error("Não consegui salvar. Confira o código (8 a 64 letras, números, - ou _).") })}>Salvar</button>
          </div>
        ) : null}
      </div>

      {data.recent.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-muted-foreground">Histórico recente ({data.recent.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {data.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{r.title}</span>
                <span className="text-muted-foreground">{new Date(r.since).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {r.status === "open" ? "aberto" : "resolvido"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
