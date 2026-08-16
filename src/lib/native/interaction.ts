// Marca quando uma interação nativa (câmera, picker, gravador) está em andamento.
// Enquanto isso, o retorno ao primeiro plano NÃO dispara novo gate biométrico —
// evita Face ID duplicado ao voltar da câmera.
let active = 0;
let releasedAt = 0;

export function beginNativeInteraction(): void {
  active += 1;
}

export function endNativeInteraction(): void {
  active = Math.max(0, active - 1);
  releasedAt = Date.now();
}

export async function withNativeInteraction<T>(run: () => Promise<T>): Promise<T> {
  beginNativeInteraction();
  try {
    return await run();
  } finally {
    endNativeInteraction();
  }
}

/** True quando uma interação nativa está ativa ou terminou nos últimos 2,5s. */
export function nativeInteractionInFlight(): boolean {
  return active > 0 || Date.now() - releasedAt < 2500;
}
