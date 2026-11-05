// Replay (somente leitura) das regras de pilares sobre mensagens de WhatsApp já entregues.
// Uso: node --experimental-strip-types --no-warnings scripts/comm-pillars-replay.mjs entregas.txt
// entregas.txt: uma linha por mensagem, "AAAA-MM-DDTHH:MM:SSZ|tipo", em ordem de envio (exportar de communication_deliveries).
// Limite: só vê o que saiu; não vê candidatos que o despachante nunca enviou. Proteger entra no melhor caso (todas furam).
import fs from "node:fs";
import { pillarOf, pillarGate, newPillarRound, usageFromDeliveries } from "../supabase/functions/_shared/proactive/pillars.ts";

const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => { const [at, kind] = l.split("|"); return { at, kind }; });
const allowed = []; const blocked = [];
for (const r of rows) {
  const usage = usageFromDeliveries(allowed.map((a) => ({ kind: a.kind, channel: "whatsapp", delivered_at: a.at })), new Date(r.at));
  const sit = { communication_kind: r.kind, severity: pillarOf(r.kind) === "proteger" ? "critical" : "info", days_until: null };
  const reason = pillarGate(sit, usage, newPillarRound());
  (reason ? blocked : allowed).push({ ...r, reason });
}
const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const day = (a) => new Date(new Date(a).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
console.log("entregues:", rows.length, "| permitidas:", allowed.length, "| barradas:", blocked.length);
console.log("pilar real      :", JSON.stringify(count(rows, (x) => pillarOf(x.kind))));
console.log("pilar permitidas:", JSON.stringify(count(allowed, (x) => pillarOf(x.kind))));
console.log("barradas por motivo:", JSON.stringify(count(blocked, (x) => x.reason)));
console.log("barradas por tipo  :", JSON.stringify(count(blocked, (x) => x.kind)));
const perDay = count(allowed, (x) => day(x.at));
console.log("máximo por dia (novo):", Math.max(0, ...Object.values(perDay)));
