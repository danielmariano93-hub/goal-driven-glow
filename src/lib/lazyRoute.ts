import { lazy, type ComponentType } from "react";

/**
 * Carregamento de rota resiliente a deploy novo com cache antigo.
 *
 * Depois de uma publicação, o navegador pode ainda ter o HTML/index antigo em
 * cache e tentar buscar um chunk que já não existe. O `import()` falha, o
 * Suspense estoura e o usuário vê a tela de erro genérica. Aqui:
 *  1) tentamos de novo uma vez (falha de rede momentânea),
 *  2) se ainda falhar, recarregamos a página uma única vez (flag em
 *     sessionStorage) para pegar o index novo — sem loop de reload.
 */

const RELOAD_FLAG = "nino:chunk-reload";

export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? "");
  return (
    /dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk|ChunkLoadError/i.test(msg) ||
    /Failed to fetch/i.test(msg) && /\.js/i.test(msg)
  );
}

export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function clearChunkReloadFlag() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
}

export function lazyRoute<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      try {
        return await factory();
      } catch (retryError) {
        if (recoverFromChunkError()) {
          // A página está recarregando: devolve um componente vazio para não
          // renderizar tela de erro no meio do reload.
          return { default: (() => null) as unknown as T };
        }
        throw retryError;
      }
    }
  });
}
