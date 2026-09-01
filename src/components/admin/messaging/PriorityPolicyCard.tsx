import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";
import { HealthPill } from "@/components/admin/kit/HealthPill";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";

type Policy = {
  pilot_mode: boolean;
  high_priority_threshold: number;
  critical_priority_threshold: number;
  allow_high_priority_override: boolean;
  high_priority_kinds: string[];
  cap_behavior: "defer" | "suppress";
  quiet_hours_high_priority_behavior: "defer" | "immediate";
  attention_weights: { care: number; informational: number; financial: number };
  pilot_budget_multiplier: number;
  updated_at?: string | null;
};

type OverrideMetrics = {
  days: number;
  totals?: {
    total: number; delivered: number; blocked_by_cap: number; deferred: number;
    override_delivered: number; dismissed: number; acted: number;
    dismiss_rate: number; action_rate: number;
  };
  override_by_band?: Array<{ band: string; total: number }>;
  by_kind?: Array<{ kind: string; overrides: number; blocked: number; delivered: number; acted: number; dismissed: number }>;
  by_user?: Array<{ user_id: string; overrides: number; delivered: number; blocked: number }>;
  commitments_from_override?: number;
};

const pct = (value: number) => `${Math.round((value ?? 0) * 100)}%`;

export function PriorityPolicyCard() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Policy | null>(null);

  const policy = useQuery({
    queryKey: ["admin_communication_policy"],
    queryFn: async (): Promise<Policy> => {
      try {
        return await callAdminRpc<Policy>("admin_communication_policy");
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar a política de prioridade"));
      }
    },
  });

  const metrics = useQuery({
    queryKey: ["admin_communication_override_metrics", 30],
    queryFn: async (): Promise<OverrideMetrics> =>
      (await callAdminRpc<OverrideMetrics>("admin_v2_communication_override_metrics", { _days: 30 })) ?? { days: 30 },
    staleTime: 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (policy.data && !form) setForm(policy.data);
  }, [policy.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (form.critical_priority_threshold < form.high_priority_threshold) {
        throw new Error("O limiar de prioridade muito alta precisa ser maior ou igual ao de alta.");
      }
      try {
        await callAdminRpc("admin_communication_policy_update", {
          _pilot_mode: form.pilot_mode,
          _high_priority_threshold: form.high_priority_threshold,
          _critical_priority_threshold: form.critical_priority_threshold,
          _allow_high_priority_override: form.allow_high_priority_override,
          _high_priority_kinds: form.high_priority_kinds,
          _cap_behavior: form.cap_behavior,
          _quiet_hours_high_priority_behavior: form.quiet_hours_high_priority_behavior,
          _pilot_budget_multiplier: form.pilot_budget_multiplier,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao salvar a política de prioridade"));
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_communication_policy"] });
      adminToast.success("Política de prioridade atualizada");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  if (policy.isLoading) return <SkeletonStats count={3} />;
  if (policy.isError) {
    return <EmptyState title="Não foi possível carregar a política de prioridade" description={(policy.error as Error)?.message} />;
  }
  if (!form) return <SkeletonStats count={3} />;

  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setForm({ ...form, [key]: value });
  const totals = metrics.data?.totals;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Modo piloto e prioridade</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Nesta fase, mensagens de alta relevância podem passar por cima do limite de
              convivência. Mensagens de valor baixo continuam segurando a vez. Nada aqui afeta
              duplicidade, silêncio ou recusa do cliente.
            </p>
          </div>
          <HealthPill tone={form.pilot_mode ? "warn" : "info"}>
            {form.pilot_mode ? "piloto ligado" : "piloto desligado"}
          </HealthPill>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-3">
            <span className="text-sm">
              Modo piloto
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Multiplica o orçamento de atenção por {form.pilot_budget_multiplier}× enquanto validamos o comportamento.
              </span>
            </span>
            <Switch checked={form.pilot_mode} onCheckedChange={(v) => set("pilot_mode", v)} />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-3">
            <span className="text-sm">
              Deixar alta relevância furar o limite
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Vale para prioridade a partir do limiar de alta ou para os tipos listados abaixo.
              </span>
            </span>
            <Switch
              checked={form.allow_high_priority_override}
              onCheckedChange={(v) => set("allow_high_priority_override", v)}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-muted-foreground">
            Limiar de alta prioridade
            <Input
              type="number" min={0} step={1} className="mt-1"
              value={String(form.high_priority_threshold)}
              onChange={(e) => set("high_priority_threshold", Number(e.target.value))}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Limiar de prioridade muito alta
            <Input
              type="number" min={0} step={1} className="mt-1"
              value={String(form.critical_priority_threshold)}
              onChange={(e) => set("critical_priority_threshold", Number(e.target.value))}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Multiplicador do piloto
            <Input
              type="number" min={1} max={20} step={1} className="mt-1"
              value={String(form.pilot_budget_multiplier)}
              onChange={(e) => set("pilot_budget_multiplier", Number(e.target.value))}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Ao atingir o limite
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.cap_behavior}
              onChange={(e) => set("cap_behavior", e.target.value as Policy["cap_behavior"])}
            >
              <option value="defer">Adiar para a próxima janela</option>
              <option value="suppress">Descartar</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Alta prioridade em horário de silêncio
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.quiet_hours_high_priority_behavior}
              onChange={(e) =>
                set("quiet_hours_high_priority_behavior", e.target.value as Policy["quiet_hours_high_priority_behavior"])
              }
            >
              <option value="defer">Adiar até o fim do silêncio</option>
              <option value="immediate">Enviar na hora</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-3">
            Tipos de alta relevância (um por linha)
            <textarea
              className="mt-1 min-h-[92px] w-full rounded-md border border-input bg-background p-3 text-sm"
              value={form.high_priority_kinds.join("\n")}
              onChange={(e) =>
                set("high_priority_kinds", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
              }
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar política"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Pesos de atenção: cuidado {form.attention_weights.care} · informativo{" "}
            {form.attention_weights.informational} · decisão financeira {form.attention_weights.financial}.
            Desligar piloto e override restaura exatamente o comportamento anterior.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="font-semibold">Efeito da prioridade (30 dias)</h3>
        {!totals ? (
          <p className="mt-3 text-xs text-muted-foreground">Sem dados no período.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Entregues", totals.delivered],
                ["Bloqueadas por limite", totals.blocked_by_cap],
                ["Adiadas", totals.deferred],
                ["Furaram o limite", totals.override_delivered],
                ["Dispensadas", totals.dismissed],
                ["Com ação", totals.acted],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-border/70 bg-secondary/30 p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{Number(value ?? 0)}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Dispensa {pct(totals.dismiss_rate)} · ação {pct(totals.action_rate)} · compromissos originados{" "}
              {metrics.data?.commitments_from_override ?? 0}
            </p>

            {(metrics.data?.override_by_band ?? []).length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Overrides por faixa:{" "}
                {(metrics.data?.override_by_band ?? []).map((b) => `${b.band}: ${b.total}`).join(" · ")}
              </p>
            )}

            {(metrics.data?.by_kind ?? []).length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/70">
                      <th className="py-2 text-left font-medium">Tipo</th>
                      <th className="py-2 text-right font-medium">Entregues</th>
                      <th className="py-2 text-right font-medium">Furaram limite</th>
                      <th className="py-2 text-right font-medium">Bloqueadas</th>
                      <th className="py-2 text-right font-medium">Com ação</th>
                      <th className="py-2 text-right font-medium">Dispensadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics.data?.by_kind ?? []).slice(0, 12).map((row) => (
                      <tr key={row.kind} className="border-b border-border/40">
                        <td className="py-2">{row.kind}</td>
                        <td className="py-2 text-right tabular-nums">{row.delivered}</td>
                        <td className="py-2 text-right tabular-nums">{row.overrides}</td>
                        <td className="py-2 text-right tabular-nums">{row.blocked}</td>
                        <td className="py-2 text-right tabular-nums">{row.acted}</td>
                        <td className="py-2 text-right tabular-nums">{row.dismissed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
