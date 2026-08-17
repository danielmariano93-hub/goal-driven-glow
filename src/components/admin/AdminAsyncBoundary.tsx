import type { ReactNode } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";

type Props = {
  loading?: boolean;
  error?: string | null;
  /** Quando falso, mostra o estado "sem permissão" em vez do conteúdo. */
  allowed?: boolean;
  /** Verdadeiro quando a consulta terminou sem nenhum dado. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  errorTitle?: string;
  onRetry?: () => void;
  /**
   * Degradação parcial: se já existem dados carregados, um erro secundário
   * vira apenas um aviso acima do conteúdo, sem apagar a tela.
   */
  hasData?: boolean;
  children: ReactNode;
};

/**
 * Padroniza os quatro estados de toda tela administrativa: carregando, erro,
 * vazio e sem permissão — com degradação parcial segura.
 */
export function AdminAsyncBoundary({
  loading,
  error,
  allowed = true,
  empty,
  emptyTitle = "Ainda não há dados aqui",
  emptyDescription = "Assim que houver movimento, os números aparecem automaticamente.",
  errorTitle = "Não foi possível carregar estes dados",
  onRetry,
  hasData,
  children,
}: Props) {
  if (!allowed) {
    return (
      <EmptyState
        icon={Lock}
        title="Você não tem acesso a esta área"
        description="Peça a um administrador da plataforma para liberar esta permissão."
      />
    );
  }

  if (loading && !hasData) return <SkeletonTable />;

  if (error && !hasData) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={errorTitle}
        description={error}
        action={
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Tentar novamente
            </button>
          ) : undefined
        }
      />
    );
  }

  if (empty && !error) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      {error && hasData && <PartialFailureNotice message={error} onRetry={onRetry} />}
      {children}
    </>
  );
}

export function PartialFailureNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
    >
      <span className="min-w-0">
        Parte das informações não carregou. O que está na tela continua válido.
      </span>
      <div className="flex items-center gap-3">
        <span className="hidden max-w-[18rem] truncate text-xs text-foreground md:inline" title={message}>
          {message}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-full border border-amber-400 px-3 py-1 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
