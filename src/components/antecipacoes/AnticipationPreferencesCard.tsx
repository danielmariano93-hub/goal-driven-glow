import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Prefs = {
  anticipation_enabled: boolean;
  anticipation_whatsapp: boolean;
  anticipation_max_per_week: number;
  anticipation_consent_at: string | null;
};

const DEFAULTS: Prefs = {
  anticipation_enabled: true,
  anticipation_whatsapp: false,
  anticipation_max_per_week: 3,
  anticipation_consent_at: null,
};

/**
 * Controle explícito do usuário sobre antecipações. O WhatsApp só é usado
 * depois de consentimento registrado — sem consentimento, o Nino fala apenas
 * dentro do app.
 */
export default function AnticipationPreferencesCard() {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<Prefs>(DEFAULTS);

  const query = useQuery({
    queryKey: ["anticipation-prefs"],
    queryFn: async (): Promise<Prefs> => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return DEFAULTS;
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("anticipation_enabled,anticipation_whatsapp,anticipation_max_per_week,anticipation_consent_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ...DEFAULTS, ...(data ?? {}) } as Prefs;
    },
  });

  useEffect(() => {
    if (query.data) setLocal(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente para salvar.");
      const next: Record<string, unknown> = { user_id: uid, ...patch };
      // Consentimento é registrado no momento exato em que o WhatsApp é ligado.
      if (patch.anticipation_whatsapp === true) next.anticipation_consent_at = new Date().toISOString();
      if (patch.anticipation_whatsapp === false) next.anticipation_consent_at = null;
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(next as never, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["anticipation-prefs"] });
      toast.success("Preferências de antecipação salvas.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar agora."),
  });

  const update = (patch: Partial<Prefs>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    save.mutate(patch);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Como você quer ser avisado</h2>
        {(query.isLoading || save.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <label className="mt-4 flex items-start justify-between gap-3">
        <span className="text-sm">
          Receber antecipações
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Avisos antes do gasto acontecer, sempre com o motivo e os números na frente.
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
          checked={local.anticipation_enabled}
          onChange={(e) => update({ anticipation_enabled: e.target.checked })}
        />
      </label>

      <label className="mt-4 flex items-start justify-between gap-3">
        <span className="text-sm">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" /> Também no WhatsApp
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {local.anticipation_consent_at
              ? `Autorizado em ${new Date(local.anticipation_consent_at).toLocaleDateString("pt-BR")}. O card no app continua sempre disponível.`
              : "Sem autorização, o Nino antecipa apenas dentro do app."}
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
          disabled={!local.anticipation_enabled}
          checked={local.anticipation_whatsapp}
          onChange={(e) => update({ anticipation_whatsapp: e.target.checked })}
        />
      </label>

      <div className="mt-4">
        <label className="text-sm" htmlFor="anticipation-cap">
          Máximo de avisos por semana
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Acima desse limite o Nino guarda a antecipação em vez de insistir.
          </span>
        </label>
        <input
          id="anticipation-cap"
          type="range"
          min={1}
          max={7}
          step={1}
          value={local.anticipation_max_per_week}
          disabled={!local.anticipation_enabled}
          onChange={(e) => setLocal((prev) => ({ ...prev, anticipation_max_per_week: Number(e.target.value) }))}
          onMouseUp={() => update({ anticipation_max_per_week: local.anticipation_max_per_week })}
          onTouchEnd={() => update({ anticipation_max_per_week: local.anticipation_max_per_week })}
          className="mt-2 w-full accent-[hsl(var(--primary))]"
        />
        <p className="mt-1 text-xs font-semibold tabular-nums">
          {local.anticipation_max_per_week} por semana
        </p>
      </div>
    </section>
  );
}
