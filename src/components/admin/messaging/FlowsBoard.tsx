import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Smartphone, Pencil, Search, Power } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonList } from "@/components/admin/AdminSkeleton";
import { HealthPill } from "@/components/admin/kit/HealthPill";
import { TemplateEditor } from "@/components/admin/messaging/TemplateEditor";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type CatalogRow = {
  kind: string;
  label: string;
  family: string;
  active: boolean;
  base_priority: number;
  allowed_channels: string[];
  content_mode: string;
  cooldown_hours: number | null;
  max_per_day: number | null;
  requires_manual_approval: boolean | null;
};

type EffectivenessRow = {
  kind: string;
  total: number;
  delivered: number;
  suppressed: number;
  acted: number;
  dismissed: number;
  not_useful: number;
  action_rate: number;
};

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "app", label: "Aplicativo", icon: Smartphone },
] as const;

/**
 * Cada tipo de comunicação vira um cartão de fluxo: ligar/desligar, canais,
 * ritmo de convivência e saúde real — sem tabela de banco na cara do usuário.
 */
export function FlowsBoard() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [editing, setEditing] = useState<CatalogRow | null>(null);

  const catalog = useQuery({
    queryKey: ["admin_communication_catalog"],
    queryFn: async (): Promise<CatalogRow[]> => {
      try {
        return (await callAdminRpc<CatalogRow[]>("admin_communication_catalog")) ?? [];
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar os fluxos"));
      }
    },
  });

  const effectiveness = useQuery({
    queryKey: ["admin_v2_insight_effectiveness", 30],
    queryFn: async (): Promise<EffectivenessRow[]> => {
      const data = await callAdminRpc<{ by_kind?: EffectivenessRow[] }>(
        "admin_v2_insight_effectiveness",
        { _days: 30 },
      );
      return data?.by_kind ?? [];
    },
    staleTime: 60_000,
    retry: 1,
  });

  const update = useMutation({
    mutationFn: async (args: {
      kind: string;
      active?: boolean;
      cooldown_hours?: number;
      max_per_day?: number;
      requires_manual_approval?: boolean;
      allowed_channels?: string[];
    }) => {
      try {
        await callAdminRpc("admin_communication_catalog_update", {
          _kind: args.kind,
          _active: args.active ?? null,
          _cooldown_hours: args.cooldown_hours ?? null,
          _max_per_day: args.max_per_day ?? null,
          _requires_manual_approval: args.requires_manual_approval ?? null,
          _allowed_channels: args.allowed_channels ?? null,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao atualizar o fluxo"));
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_communication_catalog"] });
      adminToast.success("Fluxo atualizado");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  const stats = useMemo(() => {
    const map = new Map<string, EffectivenessRow>();
    (effectiveness.data ?? []).forEach((row) => map.set(row.kind, row));
    return map;
  }, [effectiveness.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (catalog.data ?? [])
      .filter((r) => (onlyActive ? r.active : true))
      .filter((r) => {
        if (!term) return true;
        return `${r.label} ${r.kind} ${r.family}`.toLocaleLowerCase("pt-BR").includes(term);
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || b.base_priority - a.base_priority);
  }, [catalog.data, search, onlyActive]);

  if (catalog.isLoading) return <SkeletonList rows={4} />;
  if (catalog.isError) {
    return (
      <EmptyState
        title="Não foi possível carregar os fluxos"
        description={(catalog.error as Error).message}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar fluxo por nome"
            className="pl-9"
            aria-label="Buscar fluxo"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} aria-label="Somente ativos" />
          Somente ativos
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum fluxo encontrado"
          description="Ajuste a busca para ver os fluxos disponíveis."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const stat = stats.get(row.kind);
            const deliveryRate =
              stat && stat.total > 0 ? Math.round((stat.delivered / stat.total) * 100) : null;
            const actionRate = stat ? Math.round((stat.action_rate ?? 0) * 100) : null;
            const channels = row.allowed_channels ?? [];

            return (
              <article
                key={row.kind}
                className={`surface-card space-y-4 p-4 ${row.active ? "" : "opacity-70"}`}
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold">
                      {row.label || dict.commKind(row.kind)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {dict.commKind(row.kind)} · prioridade {row.base_priority}
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <Power size={12} />
                    <Switch
                      checked={row.active}
                      onCheckedChange={(v) => update.mutate({ kind: row.kind, active: v })}
                      aria-label={`Ativar fluxo ${row.label || row.kind}`}
                    />
                  </label>
                </header>

                <div className="flex flex-wrap gap-1.5">
                  {CHANNELS.map(({ id, label, icon: Icon }) => {
                    const on = channels.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          const next = on
                            ? channels.filter((c) => c !== id)
                            : [...channels, id];
                          if (next.length === 0) {
                            adminToast.error("O fluxo precisa de pelo menos um canal.");
                            return;
                          }
                          if (!on && id === "whatsapp" &&
                            !window.confirm(
                              "Liberar WhatsApp neste fluxo permite envios reais para os clientes. Confirma?",
                            )
                          ) {
                            return;
                          }
                          update.mutate({ kind: row.kind, allowed_channels: next });
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          on
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        aria-pressed={on}
                      >
                        <Icon size={12} />
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Intervalo mínimo (horas)
                    <Input
                      type="number"
                      min={0}
                      defaultValue={row.cooldown_hours ?? 0}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value !== (row.cooldown_hours ?? 0)) {
                          update.mutate({ kind: row.kind, cooldown_hours: value });
                        }
                      }}
                      className="mt-1 h-9"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Máximo por dia
                    <Input
                      type="number"
                      min={0}
                      defaultValue={row.max_per_day ?? 0}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value !== (row.max_per_day ?? 0)) {
                          update.mutate({ kind: row.kind, max_per_day: value });
                        }
                      }}
                      className="mt-1 h-9"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {stat && stat.total > 0 ? (
                    <>
                      <HealthPill tone="info">{stat.total} enviadas em 30 dias</HealthPill>
                      <HealthPill tone={(deliveryRate ?? 0) >= 90 ? "success" : "warn"}>
                        {deliveryRate}% entregues
                      </HealthPill>
                      <HealthPill
                        tone={
                          (actionRate ?? 0) >= 20
                            ? "success"
                            : stat.dismissed > stat.acted
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {actionRate}% geraram ação
                      </HealthPill>
                    </>
                  ) : (
                    <HealthPill tone="neutral">sem envios nos últimos 30 dias</HealthPill>
                  )}
                  {row.requires_manual_approval && (
                    <HealthPill tone="warn">aprovação manual</HealthPill>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                    <Pencil size={14} /> Editar mensagem
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      update.mutate({
                        kind: row.kind,
                        requires_manual_approval: !row.requires_manual_approval,
                      })
                    }
                  >
                    {row.requires_manual_approval ? "Passar para automático" : "Exigir aprovação"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TemplateEditor
        kind={editing?.kind ?? null}
        kindLabel={editing?.label || dict.commKind(editing?.kind ?? "")}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
