// ToneVariants (`nino_brain.v3`) — variação determinística de fala.
//
// O Nino soava robótico porque cada situação tinha UMA frase fixa. Aqui cada
// situação tem um pequeno repertório e a escolha é determinística por semente
// (id do rascunho, texto do turno, dia), então dá para testar e ao mesmo tempo
// não repete a mesma abertura duas vezes seguidas.

export type VariantSlot =
  | "draft_open"
  | "draft_ask"
  | "receipt_open"
  | "missing_description"
  | "ack_generic";

const POOLS: Record<VariantSlot, readonly string[]> = {
  draft_open: [
    "Deixa eu confirmar antes de salvar:",
    "Anotei assim — confere pra mim:",
    "Montei o lançamento, olha só:",
    "É isso? Ficou assim:",
  ],
  draft_ask: [
    "Posso registrar?",
    "Confirmo?",
    "Fecho assim?",
    "Pode salvar?",
  ],
  receipt_open: [
    "Prontinho, registrei",
    "Feito, tá salvo",
    "Registrado",
    "Salvei aqui",
  ],
  missing_description: [
    "em quê foi?",
    "esse foi em quê?",
    "me conta em quê foi?",
  ],
  ack_generic: [
    "Só um instante — já estou com isso 👀",
    "Dá um segundo que eu já volto com isso 👀",
    "Tô olhando aqui, já te falo 👀",
  ],
};

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Escolhe uma variante estável para a semente. `avoid` remove frases usadas
 * recentemente (histórico do canal), evitando repetição percebida.
 */
export function pickVariant(slot: VariantSlot, seed: string, avoid: string[] = []): string {
  const pool = POOLS[slot];
  const blocked = new Set(
    avoid.map((t) => String(t ?? "").toLowerCase()).filter(Boolean),
  );
  const usable = pool.filter((p) => ![...blocked].some((b) => b.includes(p.toLowerCase())));
  const list = usable.length ? usable : pool;
  return list[hash(String(seed ?? "")) % list.length];
}

export function variantPool(slot: VariantSlot): readonly string[] {
  return POOLS[slot];
}
