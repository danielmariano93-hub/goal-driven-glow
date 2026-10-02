// Comparação de segredos em tempo constante. `a === b` vaza, pelo tempo de resposta,
// quantos caracteres iniciais estão corretos; em endpoints públicos com verify_jwt=false
// isso permite descobrir o segredo de cron/webhook por tentativa.
const enc = new TextEncoder();

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = enc.encode(String(a ?? ""));
  const y = enc.encode(String(b ?? ""));
  // Percorre sempre o maior comprimento: o tempo não depende de onde os valores divergem.
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Verdadeiro se `provided` bate com algum segredo configurado (e não vazio). */
export function matchesAnySecret(provided: string | null | undefined, secrets: readonly string[]): boolean {
  let ok = false;
  for (const secret of secrets) {
    if (secret && safeEqual(provided, secret)) ok = true;
  }
  return ok;
}
