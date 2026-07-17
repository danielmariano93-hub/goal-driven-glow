import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { setFinancialValuesHidden } from "@/lib/privacy";
import { toast } from "sonner";

type PrivacyModeValue = {
  valuesHidden: boolean;
  toggleValues: () => Promise<void>;
};

const PrivacyModeContext = createContext<PrivacyModeValue | undefined>(undefined);

export function PrivacyModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = user ? `nc:privacy:hidden:${user.id}` : "nc:privacy:hidden";
  const [valuesHidden, setValuesHidden] = useState(false);

  useEffect(() => {
    if (!user) {
      setValuesHidden(false);
      setFinancialValuesHidden(false);
      return;
    }
    let cancelled = false;
    const localValue = localStorage.getItem(storageKey) === "true";
    setValuesHidden(localValue);
    setFinancialValuesHidden(localValue);
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("hide_financial_values")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const remoteValue = Boolean((data as { hide_financial_values?: boolean }).hide_financial_values);
      setValuesHidden(remoteValue);
      setFinancialValuesHidden(remoteValue);
      localStorage.setItem(storageKey, String(remoteValue));
    })();
    return () => { cancelled = true; };
  }, [storageKey, user]);

  useEffect(() => {
    setFinancialValuesHidden(valuesHidden);
    document.documentElement.dataset.financialValuesHidden = String(valuesHidden);
  }, [valuesHidden]);

  const value = useMemo<PrivacyModeValue>(() => ({
    valuesHidden,
    async toggleValues() {
      if (!user) return;
      const next = !valuesHidden;
      setValuesHidden(next);
      setFinancialValuesHidden(next);
      localStorage.setItem(storageKey, String(next));
      const { error } = await supabase
        .from("profiles")
        .update({ hide_financial_values: next } as never)
        .eq("id", user.id);
      if (error) {
        console.error("[privacy] persist preference", error);
        toast.error("Não consegui sincronizar essa preferência", {
          description: "Ela continua ativa neste aparelho.",
        });
      }
    },
  }), [storageKey, user, valuesHidden]);

  return <PrivacyModeContext.Provider value={value}>{children}</PrivacyModeContext.Provider>;
}

export function usePrivacyMode() {
  const context = useContext(PrivacyModeContext);
  if (!context) throw new Error("usePrivacyMode deve ser usado dentro de PrivacyModeProvider");
  return context;
}
