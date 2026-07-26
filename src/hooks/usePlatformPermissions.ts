import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * Carrega permissões oficiais do admin direto do servidor
 * (`current_platform_permissions`). O frontend só espelha o que o servidor
 * autoriza — RPCs revalidam a cada ação.
 *
 * IMPORTANTE (Fase 0 — estabilização admin):
 *  - `permissions` é um Set estável (só troca quando a lista de permissões muda),
 *  - `can` é um `useCallback` estável dependente apenas de `permissions`,
 *  - `ready` sinaliza "carregamento concluído" para consumidores.
 *
 * Isso evita o antipattern que quebrava a aba Clientes: usar `can` como
 * dependência de `useEffect` disparava re-fetch a cada render.
 */
export function usePlatformPermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setPermissions((prev) => (prev.size === 0 ? prev : new Set()));
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase.rpc("current_platform_permissions");
      if (cancelled) return;
      if (error || !data) {
        setPermissions((prev) => (prev.size === 0 ? prev : new Set()));
      } else {
        const rows = data as Array<{ action: string; allowed: boolean }>;
        const next = new Set(rows.filter((r) => r.allowed).map((r) => r.action));
        setPermissions((prev) => {
          if (prev.size === next.size) {
            let same = true;
            for (const k of next) {
              if (!prev.has(k)) { same = false; break; }
            }
            if (same) return prev;
          }
          return next;
        });
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [user?.id]);

  const can = useCallback(
    (action: string) => permissions.has(action),
    [permissions],
  );

  return {
    permissions,
    loading,
    ready: !loading,
    can,
  };
}
