import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Gauge, MoonStar, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";
import { HealthPill } from "@/components/admin/kit/HealthPill";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type Limits = { max_per_day: number; max_per_week: number; updated_at: string | null };

type ReasonRow = { reason: string; channel: string; total: number; last_at: string | null };

type Summary = { by_reason?: ReasonRow[]; totals?: { generated: number; suppressed: number } };

/** Onde cada regra é ajustada, em linguagem de produto. */
const RULE_GUIDE: Record<
  string,
  { title: string; what: string; where: string; icon: typeof Gauge }
> = {
  weekly_frequency_cap: {
    title: "Limite semanal por cliente",
    what: "Segura mensagens quando o cliente já recebeu o máximo combinado na semana.",
    where: "Ajuste o limite global aqui em cima.",
    icon: Gauge,
  },
  daily_frequency_cap: {
    title: "Limite diário por cliente",
    what: "Segura mensagens quando o cliente já recebeu o máximo do dia.",
    where: "Ajuste o limite global aqui em cima.",
    icon: Gauge,
  },
  kind_cooldown_24h: {
    title: "Intervalo entre mensagens do mesmo tipo",
    what: "Evita repetir o mesmo assunto em menos de 24 horas.",
    where: "Ajuste em Fluxos, no campo de intervalo do tipo.",
    icon: Clock,
  },
  dedup_key_14d: {
    title: "Mensagem duplicada",
    what: "Descarta a mesma mensagem já enviada nos últimos 14 dias.",
    where: "Regra fixa de qualidade; não é ajustável.",
    icon: ShieldCheck,
  },
  logical_duplicate: {
    title: "Mensagem duplicada",
    what: "Descarta candidatas equivalentes geradas no mesmo ciclo.",
    where: "Regra fixa de qualidade; não é ajustável.",
    icon: ShieldCheck,
  },
  channel_disabled_in_catalog: {
    title: "Canal desligado para este tipo",
    what: "O tipo de comunicação não está liberado para o canal.",
    where: "Ligue o canal em Fluxos, no cartão do tipo.",
    icon: SlidersHorizontal,
  },
  below_materiality: {
    title: "Valor abaixo do mínimo",
    what: "O assunto não tinha impacto financeiro suficiente para incomodar o cliente.",
    where: "Ajuste o piso de materialidade em Jornadas › motor proativo.",
    icon: Gauge,
  },
  severity_below_whatsapp_threshold: {
    title: "Gravidade abaixo do mínimo do WhatsApp",
    what: "Só assuntos relevantes saem no WhatsApp; o resto fica no app.",
    where: "Ajuste a prioridade do tipo em Fluxos.",
    icon: SlidersHorizontal,
  },
  quiet_hours: {
    title: "Horário de silêncio",
    what: "A mensagem espera o fim do período de silêncio do cliente.",
    where: "Definido pelo cliente nas preferências dele.",
    icon: MoonStar,
  },
  whatsapp_opt_out: {
    title: "Cliente recusou o WhatsApp",
    what: "O cliente escolheu não receber mensagens proativas no WhatsApp.",
    where: "Só o próprio cliente pode reverter.",
    icon: ShieldCheck,
  },
  channel_not_ready: {
    title: "Canal ainda não estava pronto",
    what: "O WhatsApp do cliente não estava vinculado quando a mensagem foi gerada.",
    where: "Situação legada; não exige ajuste de regra.",
    icon: ShieldCheck,
  },
};

const LEGACY_REASONS = new Set(["channel_not_ready"]);

export function RulesBoard() {
  const qc = useQueryClient();
  const [day, setDay] = useState<string>("");
  const [week, setWeek] = useState<string>("");

  const limits = useQuery({
    queryKey: ["admin_proactive_limits"],
    queryFn: async (): Promise<Limits> => {
      try {
        return await callAdminRpc<Limits>("admin_proactive_limits");
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar os limites"));
      }
    },
  });

  const summary = useQuery({
    queryKey: ["admin_proactive_summary", 30, "", ""],
    queryFn: async (): Promise<Summary> =>
      (await callAdminRpc<Summary>("admin_v2_proactive_summary", {
        _days: 30,
        _channel: null,
        _kind: null,
      })) ?? {},
    staleTime: 30_000,
    retry: 1,
  });

  const save = useMutation({
    mutationFn: async () => {
      const nextDay = Number(day === "" ? (limits.data?.max_per_day ?? 1) : day);
      const nextWeek = Number(week === "" ? (limits.data?.max_per_week ?? 3) : week);
      if (!Number.isInteger(nextDay) || nextDay < 0 || !Number.isInteger(nextWeek) || nextWeek < 0) {
        throw new Error("Informe números inteiros maiores ou iguais a zero.");
      }
      try {
        await callAdminRpc("admin_proactive_limits_update", {
          _max_per_day: nextDay,
          _max_per_week: nextWeek,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao salvar os limites"));
      }
    },
    onSuccess: async () => {
      setDay("");
      setWeek("");
      await qc.invalidateQueries({ queryKey: ["admin_proactive_limits"] });
      adminToast.success("Limites atualizados para todos os clientes");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  const reasons = useMemo(() => {
    const byReason = new Map<string, { reason: string; total: number; last_at: string | null }>();
    for (const row of summary.data?.by_reason ?? []) {
      const current = byReason.get(row.reason) ?? { reason: row.reason, total: 0, last_at: null };
      current.total += row.total;
      if (row.last_at && (!current.last_at || row.last_at > current.last_at)) current.last_at = row.last_at;
      byReason.set(row.reason, current);
    }
    const all = Array.from(byReason.values()).sort((a, b) => b.total - a.total);
    return {
      current: all.filter((r) => !LEGACY_REASONS.has(r.reason)),
      legacy: all.filter((r) => LEGACY_REASONS.has(r.reason)),
    };
  }, [summary.data]);

  if (limits.isLoading) return <SkeletonStats count={3} />;
  if (limits.isError) {
    return (
      <EmptyState
        title="Não foi possível carregar as regras"
        description={(limits.error as Error)?.message}
      />
    );
  }

  const currentDay = limits.data?.max_per_day ?? 1;
  const currentWeek = limits.data?.max_per_week ?? 3;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Limites de convivência</h3>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Quantas mensagens proativas um cliente pode receber. Vale para todos os clientes que
              não personalizaram as próprias preferências. Subir esses números libera mais
              mensagens e reduz as retenções.
            </p>
          </div>
          <HealthPill tone="info">
            hoje: {currentDay}/dia · {currentWeek}/semana
          </HealthPill>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Máximo por dia (sem teto fixo)
            <Input
              type="number"
              min={0}
              step={1}
              value={day === "" ? String(currentDay) : day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Máximo por semana (sem teto fixo)
            <Input
              type="number"
              min={0}
              step={1}
              value={week === "" ? String(currentWeek) : week}
              onChange={(e) => setWeek(e.target.value)}
              className="mt-1"
            />
          </label>
          <div className="flex items-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full sm:w-auto">
              {save.isPending ? "Salvando..." : "Salvar limites"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Não existe teto escondido no código: o valor salvo aqui é o valor usado pelo motor.
          Zero bloqueia mensagens não críticas. Mensagens críticas continuam podendo ignorar a
          cota por regra de segurança. Alterações ficam registradas na auditoria.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="font-semibold">Regras que mais retiveram mensagens (30 dias)</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Retida não é falha: é a regra protegendo o cliente. Aqui você vê qual regra está pesando e
          onde ajustá-la.
        </p>

        {reasons.current.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Nenhuma retenção no período.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reasons.current.map((row) => {
              const guide = RULE_GUIDE[row.reason];
              const Icon = guide?.icon ?? SlidersHorizontal;
              return (
                <li
                  key={row.reason}
                  className="flex items-start gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-3"
                >
                  <span className="mt-0.5 text-muted-foreground">
                    <Icon size={16} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {guide?.title ?? dict.commReason(row.reason)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {guide?.what ?? "Regra de convivência do motor proativo."}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {guide?.where ?? "Ajuste em Fluxos."}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{row.total}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.last_at ? new Date(row.last_at).toLocaleDateString("pt-BR") : "—"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {reasons.legacy.length > 0 && (
          <details className="mt-4 rounded-2xl border border-border/70 bg-secondary/20 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Histórico já resolvido ({reasons.legacy.length})
            </summary>
            <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {reasons.legacy.map((row) => (
                <li key={row.reason}>
                  {RULE_GUIDE[row.reason]?.title ?? dict.commReason(row.reason)} · {row.total}{" "}
                  ocorrência(s) · última em{" "}
                  {row.last_at ? new Date(row.last_at).toLocaleDateString("pt-BR") : "—"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
