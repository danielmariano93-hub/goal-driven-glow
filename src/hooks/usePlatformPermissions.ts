import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * Carrega as permissões oficiais do usuário admin direto do servidor
 * (função `current_platform_permissions`). O frontend não decide mais nada
 * sozinho — apenas espelha o que o servidor autoriza. RPCs revalidam ao
 * executar cada ação.
 */
export function usePlatformPermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setPermissions(new Set());
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("current_platform_permissions");
      if (cancelled) return;
      if (error || !data) {
        setPermissions(new Set());
      } else {
        const rows = data as Array<{ action: string; allowed: boolean }>;
        setPermissions(new Set(rows.filter((r) => r.allowed).map((r) => r.action)));
      }
      setLoading(false);
    }
    setLoading(true);
    load();
    return () => { cancelled = true; };
  }, [user?.id]);

  return {
    permissions,
    loading,
    can: (action: string) => permissions.has(action),
  };
}
