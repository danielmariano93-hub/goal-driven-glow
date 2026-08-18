import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake, MessageCircle, Smartphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";

type ReminderSettings = {
  emotional_enabled: boolean;
  emotional_hour: number;
  emotional_requires_activity: boolean;
  emotional_channels: string[];
  care_max_per_day: number;
  care_max_per_week: number;
  updated_at: string | null;
};

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "app", label: "Aplicativo", icon: Smartphone },
] as const;

/**
 * Lembretes de cuidado (check-in de humor e revisões) têm cota própria: não
 * disputam a vez com os alertas financeiros. Tudo editável aqui.
 */
export function RemindersBoard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ReminderSettings | null>(null);

  const settings = useQuery({
    queryKey: ["admin_reminder_settings"],
    queryFn: async (): Promise<ReminderSettings> => {
      try {
        const data = await callAdminRpc<ReminderSettings>("admin_reminder_settings");
        return {
          emotional_enabled: data?.emotional_enabled ?? true,
          emotional_hour: Number(data?.emotional_hour ?? 19),
          emotional_requires_activity: data?.emotional_requires_activity ?? false,
          emotional_channels: data?.emotional_channels ?? ["app", "whatsapp"],
          care_max_per_day: Number(data?.care_max_per_day ?? 1),
          care_max_per_week: Number(data?.care_max_per_week ?? 4),
          updated_at: data?.updated_at ?? null,
        };
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar os lembretes"));
      }
    },
  });

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (next: ReminderSettings) => {
      try {
        await callAdminRpc("admin_reminder_settings_update", {
          _emotional_enabled: next.emotional_enabled,
          _emotional_hour: next.emotional_hour,
          _emotional_requires_activity: next.emotional_requires_activity,
          _emotional_channels: next.emotional_channels,
          _care_max_per_day: next.care_max_per_day,
          _care_max_per_week: next.care_max_per_week,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao salvar os lembretes"));
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_reminder_settings"] });
      adminToast.success("Lembretes atualizados");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  if (settings.isLoading) return <SkeletonList rows={3} />;
  if (settings.isError || !draft) {
    return (
      <EmptyState
        title="Não foi possível carregar os lembretes"
        description={(settings.error as Error)?.message ?? "Tente novamente em instantes."}
      />
    );
  }

  const patch = (values: Partial<ReminderSettings>) => setDraft({ ...draft, ...values });

  return (
    <div className="space-y-4">
      <article className="surface-card space-y-4 p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 font-display text-sm font-semibold">
              <HeartHandshake size={15} className="text-primary" /> Lembrete de humor
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Convite carinhoso, uma vez ao dia, para a pessoa contar como se sentiu. A resposta em
              texto ou áudio já é registrada pelo Nino.
            </p>
          </div>
          <Switch
            checked={draft.emotional_enabled}
            onCheckedChange={(v) => patch({ emotional_enabled: v })}
            aria-label="Ativar lembrete de humor"
          />
        </header>

        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(({ id, label, icon: Icon }) => {
            const on = draft.emotional_channels.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on
                    ? draft.emotional_channels.filter((c) => c !== id)
                    : [...draft.emotional_channels, id];
                  if (next.length === 0) {
                    adminToast.error("O lembrete precisa de pelo menos um canal.");
                    return;
                  }
                  patch({ emotional_channels: next });
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  on
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-medium text-muted-foreground">
            Hora do convite (horário de Brasília)
            <Input
              type="number"
              min={0}
              max={23}
              value={draft.emotional_hour}
              onChange={(e) => patch({ emotional_hour: Number(e.target.value) })}
              className="mt-1 h-9"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
            Só lembrar quem usou o Nino no dia
            <Switch
              checked={draft.emotional_requires_activity}
              onCheckedChange={(v) => patch({ emotional_requires_activity: v })}
              aria-label="Exigir atividade no dia"
            />
          </label>
        </div>
      </article>

      <article className="surface-card space-y-3 p-4">
        <div>
          <p className="font-display text-sm font-semibold">Cota dos lembretes de cuidado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vale para check-in de humor e convites de revisão. É uma cota separada dos alertas
            financeiros, para que um não silencie o outro.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-medium text-muted-foreground">
            Máximo por dia
            <Input
              type="number"
              min={0}
              max={5}
              value={draft.care_max_per_day}
              onChange={(e) => patch({ care_max_per_day: Number(e.target.value) })}
              className="mt-1 h-9"
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Máximo por semana
            <Input
              type="number"
              min={0}
              max={21}
              value={draft.care_max_per_week}
              onChange={(e) => patch({ care_max_per_week: Number(e.target.value) })}
              className="mt-1 h-9"
            />
          </label>
        </div>
      </article>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {draft.updated_at
            ? `Última alteração em ${new Date(draft.updated_at).toLocaleString("pt-BR")}`
            : "Ainda sem alterações registradas."}
        </p>
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          {save.isPending ? "Salvando..." : "Salvar lembretes"}
        </Button>
      </div>
    </div>
  );
}
