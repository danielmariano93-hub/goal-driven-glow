import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectRecurringSuggestions, type DetectionTx } from "@/lib/engine/recurringDetection";

let n = 0;
const tx = (description: string, amount: number, date: string, over: Partial<DetectionTx> = {}): DetectionTx => ({
  id: `t${++n}`, description, amount, occurred_at: date, type: "expense", status: "confirmed", account_id: "acc1", category_id: "cat1", movement_kind: "transaction", ...over,
});
const today = "2026-10-15";

describe("detecção de contas que se repetem", () => {
  const netflix = ["2026-07-27", "2026-08-27", "2026-09-27"].map((d) => tx("Netflix", 44.9, d));

  it("marca conhecida (assinatura) basta com 2 meses e vira sugestão por marca", () => {
    const two = netflix.slice(0, 2);
    const [s] = detectRecurringSuggestions({ txs: two, today });
    expect(s).toMatchObject({ name: "Netflix", key: "expense:brand:Netflix" });
  });
  it("assinatura fixa em 3 meses vira sugestão, com próxima data", () => {
    const [s] = detectRecurringSuggestions({ txs: netflix, today });
    expect(s).toMatchObject({ name: "Netflix", amount: 44.9, day_of_month: 27, months: 3, next_date: "2026-10-27", amount_varies: false });
    expect(s.confidence).toBe("alta");
  });
  it("conta de consumo com valor variável entra como 'cerca de'", () => {
    const luz = [["2026-06-10", 180], ["2026-07-11", 210], ["2026-08-10", 160], ["2026-09-10", 195]].map(([d, a]) => tx("Enel Energia", a as number, d as string));
    const [s] = detectRecurringSuggestions({ txs: luz, today });
    expect(s.amount_varies).toBe(true);
    expect(s.day_of_month).toBe(10);
  });
  it("compras frequentes (várias por mês) ou valores muito diferentes não viram sugestão", () => {
    const uber = ["2026-07-02", "2026-07-09", "2026-07-20", "2026-08-03", "2026-08-15", "2026-08-28", "2026-09-04", "2026-09-17", "2026-09-30"].map((d, i) => tx("Uber", 10 + i * 7, d));
    expect(detectRecurringSuggestions({ txs: uber, today })).toEqual([]);
    const mercado = ["2026-07-10", "2026-08-12", "2026-09-09"].map((d, i) => tx("Mercado Bairro", 80 + i * 90, d));
    expect(detectRecurringSuggestions({ txs: mercado, today })).toEqual([]);
  });
  it("não sugere: parcela de cartão, transferência, pix, já existente, dispensada ou que parou de acontecer", () => {
    const parcela = ["2026-07-05", "2026-08-05", "2026-09-05"].map((d, i) => tx(`Loja X parcela ${i + 1}/10`, 100, d));
    const pix = ["2026-07-05", "2026-08-05", "2026-09-05"].map((d) => tx("Pix enviado Maria", 100, d));
    const transfer = ["2026-07-05", "2026-08-05", "2026-09-05"].map((d) => tx("Netflix", 44.9, d, { transfer_group_id: "g" }));
    const parou = ["2026-03-13", "2026-04-13", "2026-05-13", "2026-06-13"].map((d) => tx("Seguro Cartao", 12.94, d));
    expect(detectRecurringSuggestions({ txs: [...parcela, ...pix, ...transfer, ...parou], today })).toEqual([]);
    expect(detectRecurringSuggestions({ txs: netflix, today, existingRules: [{ name: "Netflix" }] })).toEqual([]);
    expect(detectRecurringSuggestions({ txs: netflix, today, dismissedKeys: ["expense:netflix"] })).toEqual([]);
  });
  it("menos de 3 meses ou com buraco grande não basta", () => {
    const coral = ["2026-08-10", "2026-09-10"].map((d) => tx("Mensalidade Coral", 90, d));
    expect(detectRecurringSuggestions({ txs: coral, today })).toEqual([]);
    const buraco = ["2026-03-27", "2026-04-27", "2026-09-27"].map((d) => tx("Mensalidade Coral", 90, d));
    expect(detectRecurringSuggestions({ txs: buraco, today })).toEqual([]);
  });
});

describe("fiação da tela e do alerta ao organizador", () => {
  it("tela mostra sugestões com Confirmar/Ajustar/Agora não e parcelas de dívida só informativas", () => {
    const page = readFileSync("src/pages/Recorrencias.tsx", "utf8");
    expect(page).toContain("O Nino achou estas contas que se repetem");
    expect(page).toContain("Agora não");
    expect(page).toContain("não viram regra aqui");
  });
  it("aviso ao organizador usa colunas que existem em notifications e não depende do aviso no app", () => {
    const src = readFileSync("supabase/functions/_shared/split/participantPipeline.ts", "utf8");
    const fn = src.slice(src.indexOf("async function notifyOwner"), src.indexOf("export async function handleParticipantInbound"));
    expect(fn).toContain("action_url");
    expect(fn).toContain("dedup_key");
    expect(fn).not.toMatch(/\bdata:\s*\{/);
    expect(fn.indexOf('from("whatsapp_links")')).toBeGreaterThan(fn.indexOf('from("notifications")'));
    expect(fn).not.toContain("return false");
  });
});

import { compareReceipt, describeReceipt, parseReceiptJson } from "../../supabase/functions/_shared/split/receiptReader";
describe("leitura de comprovante", () => {
  it("normaliza o JSON do modelo e compara com a parte em aberto", () => {
    const read = parseReceiptJson('```json\n{"is_payment_receipt":true,"amount":"500,00","paid_at":"14/10/2026","payee":"Daniel M","institution":"Itaú","confidence":"alta"}\n```');
    expect(read).toMatchObject({ amount: 500, paid_at: "2026-10-14", payee: "Daniel M", confidence: "alta" });
    expect(describeReceipt(read!)).toContain("14/10/2026");
    expect(compareReceipt(read, 291.33)).toBe("amount_differs");
    expect(compareReceipt(read, 500)).toBe("matches");
  });
  it("imagem que não é comprovante e leitura vazia", () => {
    expect(compareReceipt(parseReceiptJson('{"is_payment_receipt":false,"amount":null,"confidence":"alta"}'), 100)).toBe("not_a_receipt");
    expect(parseReceiptJson("sem json")).toBeNull();
    expect(compareReceipt(null, 100)).toBeNull();
  });
});
