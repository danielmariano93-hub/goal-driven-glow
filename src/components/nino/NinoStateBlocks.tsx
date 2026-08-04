import { AlertTriangle, Loader2, LogIn, RefreshCw } from "lucide-react";
import { NinoRpcError, type NinoErrorKind } from "@/lib/nino/intelligence";
import { hourBR } from "@/lib/nino/format";

export function NinoLoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-[18px] p-4"
          style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface)" }}
        >
          <div className="h-3 w-24 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
          <div className="mt-2 h-3 w-full animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
        </div>
      ))}
      <span className="sr-only">Carregando leituras do Nino</span>
    </div>
  );
}

function messageFor(kind: NinoErrorKind): { title: string; body: string } {
  if (kind === "auth")
    return {
      title: "Sua sessão expirou",
      body: "Entre novamente para o Nino voltar a ler seus dados.",
    };
  if (kind === "network")
    return {
      title: "Sem conexão com o Nino",
      body: "Verifique sua internet e tente de novo.",
    };
  if (kind === "contract")
    return {
      title: "Não conseguimos ler as leituras agora",
      body: "Recebemos uma resposta em formato inesperado. Já registramos para correção.",
    };
  return {
    title: "Não conseguimos carregar as leituras",
    body: "Isso é uma falha técnica, não uma conclusão sobre suas finanças.",
  };
}

export function NinoErrorBlock({
  error,
  onRetry,
  retrying,
  hasStaleData,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  hasStaleData?: boolean;
}) {
  const kind: NinoErrorKind = error instanceof NinoRpcError ? error.kind : "rpc";
  const { title, body } = messageFor(kind);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-[18px] p-4"
      style={{ border: "1px solid rgba(255,107,95,0.35)", background: "rgba(255,107,95,0.08)" }}
    >
      <div className="flex items-start gap-2">
        {kind === "auth" ? (
          <LogIn className="mt-0.5 h-4 w-4" style={{ color: "#B8452F" }} />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4" style={{ color: "#B8452F" }} />
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-bold" style={{ color: "var(--home-text-1)" }}>
            {title}
          </p>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--home-text-2)" }}>
            {body}
            {hasStaleData ? " Mantivemos as últimas leituras carregadas abaixo." : ""}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="mt-2.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ background: "var(--home-brand-ink)" }}
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NinoEmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[18px] p-5 text-center text-[12px]"
      style={{ border: "1px dashed var(--home-hairline)", color: "var(--home-text-2)" }}
    >
      {children}
    </div>
  );
}

export function NinoStaleBadge({ asOf }: { asOf?: string | null }) {
  const h = hourBR(asOf);
  if (!h) return null;
  return (
    <span className="text-[10px] font-medium" style={{ color: "var(--home-text-3)" }}>
      dados de {h}
    </span>
  );
}
