import fs from "node:fs";

const path = "supabase/functions/_shared/artifacts/png.ts";
const source = fs.readFileSync(path, "utf8");
const before = [
  'export function chartDayLabel(label: string): string {',
  '  return String(label).split("/")[0].padStart(2, "0").slice(0, 2);',
  '}',
].join("\n");
const after = [
  'const MONTH_AXIS_LABELS: Record<string, string> = {',
  '  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",',
  '  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",',
  '};',
  'export function chartDayLabel(label: string): string {',
  '  const raw = String(label ?? "").trim().toLowerCase();',
  '  const monthly = raw.match(/^([a-z]{3})\\/(\\d{2})$/);',
  '  if (monthly && MONTH_AXIS_LABELS[monthly[1]]) {',
  '    return `${MONTH_AXIS_LABELS[monthly[1]]}-${monthly[2]}`;',
  '  }',
  '  return raw.split("/")[0].padStart(2, "0").slice(0, 2);',
  '}',
].join("\n");
if (!source.includes(before)) throw new Error("chartDayLabel fragment drifted; refusing blind patch");
fs.writeFileSync(path, source.replace(before, after));
console.log("monthly chart axis patch applied");
