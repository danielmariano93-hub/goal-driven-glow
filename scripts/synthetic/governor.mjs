// Regulador de vazão das rodadas sintéticas. O provedor de IA tem limite de tokens por minuto (TPM); passar dele
// faz o Nino cair no caminho de contingência e piora as respostas, o que contamina a medição e ainda disputa
// cota com clientes reais. Duas travas:
//   1. orçamento de tokens por minuto (janela deslizante de 60 s, contando também o que está em andamento);
//   2. concorrência adaptativa (AIMD): ao ver degradação, corta pela metade e espera; com turnos limpos, sobe de 1 em 1.
export function createGovernor({
  tokensPerMin = 150_000, startLimit = 3, minLimit = 1, maxLimit = 6, cooldownMs = 20_000,
  assumedTokensPerTurn = 8_000, growAfter = 8,
  clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let limit = startLimit, active = 0, clean = 0, cooldownUntil = 0, peak = 0;
  const win = [];
  const stats = { turns: 0, degraded: 0, waits: 0, minLimit: startLimit, maxLimit: startLimit };
  const prune = (t) => { while (win.length && win[0].t <= t - 60_000) win.shift(); };
  const used = (t) => { prune(t); return win.reduce((s, x) => s + x.tokens, 0); };

  async function acquire() {
    for (;;) {
      const t = clock();
      if (t < cooldownUntil) { stats.waits++; await sleep(cooldownUntil - t); continue; }
      const projected = used(t) + active * assumedTokensPerTurn;
      if (active < limit && projected < tokensPerMin) { active++; return; }
      stats.waits++;
      await sleep(250);
    }
  }
  function release({ tokens = 0, degraded = false } = {}) {
    active = Math.max(0, active - 1);
    const t = clock();
    win.push({ t, tokens });
    peak = Math.max(peak, used(t));
    stats.turns++;
    if (degraded) {
      stats.degraded++;
      limit = Math.max(minLimit, Math.floor(limit / 2));
      cooldownUntil = t + cooldownMs;
      clean = 0;
    } else if (++clean >= growAfter) {
      limit = Math.min(maxLimit, limit + 1);
      clean = 0;
    }
    stats.minLimit = Math.min(stats.minLimit, limit);
    stats.maxLimit = Math.max(stats.maxLimit, limit);
  }
  return { acquire, release, get limit() { return limit; }, get active() { return active; }, snapshot: () => ({ ...stats, limit, peak_tokens_per_min: peak, tokens_per_min_budget: tokensPerMin }) };
}

/** O turno rodou em caminho de contingência ou o provedor falhou? (sinal de degradação, não de erro do Nino) */
export function isDegraded(turn) {
  const model = String(turn?.run?.model ?? "");
  if (/^v3-fallback|provider_recover/.test(model)) return true;
  if (turn?.status === 429 || turn?.status >= 500) return true;
  return /não consegui processar isso com segurança agora/i.test(String(turn?.reply ?? ""));
}
