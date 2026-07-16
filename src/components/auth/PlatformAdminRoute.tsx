import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { PlatformRole } from "@/lib/admin/permissions";

/**
 * Guard exclusivo da experiência administrativa (Platform).
 * Verifica a role via RPC server-side; nunca confia no frontend.
 */
export function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<PlatformRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!user) { setChecking(false); setRole(null); return; }
      const { data, error } = await supabase.rpc("current_platform_admin_role");
      if (!cancelled) {
        setRole(!error && data ? (data as PlatformRole) : null);
        setChecking(false);
      }
    }
    check();
    return () => { cancelled = true; };
  }, [user]);

  if (status === "loading" || checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!role) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-brand-coral" />
          <h1 className="mt-4 font-display text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área é exclusiva para administradores da plataforma NoControle.ia.
          </p>
          <a
            href="/app"
            className="mt-6 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Voltar ao app
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
