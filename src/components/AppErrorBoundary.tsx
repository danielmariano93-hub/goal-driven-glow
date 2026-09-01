import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/lazyRoute";

type State = { hasError: boolean };

/**
 * Boundary global: erro inesperado de plugin nativo, auth, câmera, biometria,
 * áudio ou rede não pode deixar o app em tela branca.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    if (isChunkLoadError(error) && recoverFromChunkError()) return { hasError: false };
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] boundary", error.message, info.componentStack?.slice(0, 400));
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-8 text-center">
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-2xl" />
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">Algo saiu do previsto</h1>
          <p className="text-sm text-muted-foreground">
            Tivemos uma falha inesperada nesta tela. Seus dados estão salvos — recarregue para continuar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground"
        >
          Recarregar o Meu Nino
        </button>
      </div>
    );
  }
}
