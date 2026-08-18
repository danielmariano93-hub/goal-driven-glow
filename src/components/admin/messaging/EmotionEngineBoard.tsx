import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, MessageCircle, Smartphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";

type EmotionConfig = {
  window_days: number;
  min_sample: number;
  min_composite_sample: number;
  min_uplift_pct: number;
  min_delta_abs: number;
  lookback_days: number;
  prospective_enabled: boolean;
  prospective_channels: string[];
  updated_at: string | null;
};

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "app", label: "Aplicativo", icon: Smartphone },
] as const;

/**
 * Motor emocional-financeiro: define quando o Nino tem base suficiente para
 * falar de associação entre emoção e gasto. Nada aqui autoriza linguagem
 * causal — o contrato do motor proíbe.
 */
export function EmotionEngineBoard() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<EmotionConfig | null>(null);

  const config = useQuery({
    queryKey: ["admin_emotion_finance_config"],
    queryFn: async (): Promise<EmotionConfig> => {
      try {
        const data = await callAdminRpc<EmotionConfig>("admin_emotion_finance_config");
        return {
          window_days: Number(data?.window_days ?? 1),
          min_sample: Number(data?.min_sample ?? 5),
          min_composite_sample: Number(data?.min_composite_sample ?? 4),
          min_uplift_pct: Number(data?.min_uplift_pct ?? 15),
          min_delta_abs: Number(data?.min_delta_abs ?? 30),
          lookback_days: Number(data?.lookback_days ?? 120),
          prospective_enabled: data?.prospective_enabled ?? true,
          prospective_channels: data?.prospective_channels ?? ["app", "whatsapp"],
          updated_at: data?.updated_at ?? null,
        };
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar o motor emocional"));
      }
    },
  });

  useEffect(() => {
    if (config.data) setDraft(config.data);
  }, [config.data]);

  const save = useMutation({
    mutationFn: async (next: EmotionConfig) => {
      try {
        await callAdminRpc("admin_emotion_finance_config_update", {
          _window_days: next.window_days,
          _min_sample: next.min_sample,
          _min_composite_sample: next.min_composite_sample,
          _min_uplift_pct: next.min_uplift_pct,
          _min_delta_abs: next.min_delta_abs,
          _lookback_days: next.lookback_days,
          _prospective_enabled: next.prospective_enabled,
          _prospective_channels: next.prospective_channels,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao salvar o motor emocional"));
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_emotion_finance_config"] });
      adminToast.success("Motor emocional atualizado");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  if (config.isLoading) return <SkeletonList rows={3} />;
  if (config.isError || !draft) {
    return (
      <EmptyState
        title="Não foi possível carregar o motor emocional"
        description={(config.error as Error)?.message ?? "Tente novamente em instantes."}
      />
    );
  }

  const patch = (values: Partial<EmotionConfig>) => setDraft({ ...draft, ...values });

  return (
    <div className="space-y-4">
      <article className="surface-card space-y-3 p-4">
        <div>
          <p className="inline-flex items-center gap-2 font-display text-sm font-semibold">
            <Brain size={15} className="text-primary" /> Base mínima para falar de padrão
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            O Nino compara o gasto flexível dos dias com registro de emoção contra o padrão da
            própria pessoa no mesmo dia da semana. Abaixo dos limites daqui, ele diz que ainda não
            tem base — e nunca afirma causa.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-medium text-muted-foreground">
            Registros mínimos por emoção
            <Input
              type="number" min={3} max={30} className="mt-1 h-9"
              value={draft.min_sample}
              onChange={(e) => patch({ min_sample: Number(e.target.value) })}
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Registros mínimos com contexto (fim de semana, véspera de fatura)
            <Input
              type="number" min={3} max={30} className="mt-1 h-9"
              value={draft.min_composite_sample}
              onChange={(e) => patch({ min_composite_sample: Number(e.target.value) })}
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Diferença mínima em % para virar padrão
            <Input
              type="number" min={5} max={200} className="mt-1 h-9"
              value={draft.min_uplift_pct}
              onChange={(e) => patch({ min_uplift_pct: Number(e.target.value) })}
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Diferença mínima em reais
            <Input
              type="number" min={0} max={5000} className="mt-1 h-9"
              value={draft.min_delta_abs}
              onChange={(e) => patch({ min_delta_abs: Number(e.target.value) })}
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Dias observados após o registro (0 = só o dia)
            <Input
              type="number" min={0} max={3} className="mt-1 h-9"
              value={draft.window_days}
              onChange={(e) => patch({ window_days: Number(e.target.value) })}
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Histórico analisado (dias)
            <Input
              type="number" min={30} max={365} className="mt-1 h-9"
              value={draft.lookback_days}
              onChange={(e) => patch({ lookback_days: Number(e.target.value) })}
            />
          </label>
        </div>
      </article>

      <article className="surface-card space-y-4 p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-sm font-semibold">Aviso preventivo no dia do registro</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando a pessoa registra uma emoção que, no histórico dela, costuma vir junto de gasto
              acima do padrão, o Nino oferece ajuda — como convite, nunca como julgamento.
            </p>
          </div>
          <Switch
            checked={draft.prospective_enabled}
            onCheckedChange={(v) => patch({ prospective_enabled: v })}
            aria-label="Ativar aviso preventivo"
          />
        </header>

        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(({ id, label, icon: Icon }) => {
            const on = draft.prospective_channels.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  patch({
                    prospective_channels: on
                      ? draft.prospective_channels.filter((c) => c !== id)
                      : [...draft.prospective_channels, id],
                  });
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
      </article>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {draft.updated_at
            ? `Última alteração em ${new Date(draft.updated_at).toLocaleString("pt-BR")}`
            : "Ainda sem alterações registradas."}
        </p>
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          {save.isPending ? "Salvando..." : "Salvar motor emocional"}
        </Button>
      </div>
    </div>
  );
}
