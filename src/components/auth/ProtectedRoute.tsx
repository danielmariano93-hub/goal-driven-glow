import { Navigate, useLocation } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

/**
 * Guard das rotas do usuário financeiro (/app/*).
 * Platform admins sem adesão financeira explícita são redirecionados a /admin.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const {
    status,
    user,
    profile,
    authError,
    retryProfile,
    recovering,
    isFinancialUser,
    isPlatformAdmin,
  } = useAuth();
  const location = useLocation();

  if (recovering && location.pathname !== "/reset-password") {
    return <Navigate to="/reset-password" replace />;
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-brand-coral" />
          <h1 className="mt-3 font-display text-xl font-bold">Erro ao carregar sua conta</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {authError ?? "Verifique sua conexão e tente novamente."}
          </p>
          <button
            onClick={retryProfile}
            className="mt-5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Platform admin sem role financeira: enviar para o Centro de Comando.
  if (isPlatformAdmin && !isFinancialUser) {
    return <Navigate to="/admin" replace />;
  }

  if (profile && !profile.onboarding_completed_at && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
