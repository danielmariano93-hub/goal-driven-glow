// Desenho do resumo em PDF: A4 (595×842 pt), uma página, texto selecionável, fontes embutidas, só vetor.
// Layout, cores e ordem são fixos aqui (nada disso vem de IA). Paleta do Nino: o destaque usa o mesmo
// degradê do cartão da Home; cada indicador fica no próprio cartão.
// deno-lint-ignore-file no-explicit-any
import {
  PDFDocument, PDFName, PDFOperator, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo,
  appendBezierCurve, closePath, clip, endPath, type PDFFont, type PDFPage, type RGB,
} from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { DM_SANS_BOLD, DM_SANS_REGULAR, DM_SANS_SEMIBOLD } from "./fonts.ts";
import { brl, ddmmyyyy } from "./format.ts";
import type { SummaryDTO, SummaryLine, SummaryMetric, Tone } from "./types.ts";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const PAGE = { w: 595, h: 842, margin: 32 } as const;
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const C = {
  bg: "#F8F7FC", surface: "#FFFFFF", primary: "#6D3BFF", violet: "#8B5CF6", border: "#DDD8E9", insight: "#EAE4F7",
  text: "#21164F", muted: "#666274", good: "#168361", risk: "#B52D46", attention: "#946000",
  heroFrom: "#17102E", heroMid: "#3C1B78", heroTo: "#6B2CFF",
} as const;
const TONE: Record<Tone, string> = { neutral: C.text, good: C.good, risk: C.risk, attention: C.attention };
/** Tamanho / entrelinha da especificação. */
const T = {
  logo: [24, 28], title: [22, 27], hero: [32, 36], kpi: [19, 23], section: [13, 17], body: [11, 15], caption: [10, 13], footer: [9, 12],
} as const;
const GAP = 8;
/** Alturas dos blocos (especificação). A ação ocupa o espaço que sobra até o rodapé. */
const H = { header: 64, hero: 125, kpis: 82, cats: 135, insight: 90, future: 100, action: 75, footer: 40 } as const;

const addDaysIso = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface Fonts { reg: PDFFont; semi: PDFFont; bold: PDFFont }

// ---------------------------------------------------------------------------
// Texto com algarismos de largura fixa (a DM Sans não traz `tnum`: cada dígito vai numa célula de 0,64 em)
// ---------------------------------------------------------------------------

const DIGIT_CELL = 0.64;
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

const FACES = new WeakMap<PDFFont, any>();

export function textWidth(text: string, font: PDFFont, size: number): number {
  let w = 0; let run = "";
  for (const ch of text) {
    if (isDigit(ch)) { if (run) { w += font.widthOfTextAtSize(run, size); run = ""; } w += DIGIT_CELL * size; } else run += ch;
  }
  if (run) w += font.widthOfTextAtSize(run, size);
  return w;
}

/**
 * Texto sem algarismos: texto PDF comum. Com algarismos: o desenho visível sai dos contornos da própria
 * fonte com cada dígito numa célula fixa (números tabulares), e o texto real vai numa camada invisível
 * por cima — selecionável e extraível sem espaços falsos ("16", não "1 6").
 */
function drawText(page: PDFPage, text: string, x: number, yTop: number, font: PDFFont, spec: readonly [number, number], color: string, opacity = 1) {
  const [size, lh] = spec;
  const baseline = PAGE.h - (yTop + (lh + size * 0.7) / 2);
  const fk = FACES.get(font);
  if (!/[0-9]/.test(text) || !fk) {
    page.drawText(text, { x, y: baseline, size, font, color: hex(color), opacity });
    return font.widthOfTextAtSize(text, size);
  }
  const scale = size / fk.unitsPerEm;
  let cx = x; let run = "";
  const drawRun = () => {
    if (!run) return;
    const lay = fk.layout(run);
    lay.glyphs.forEach((g: any, k: number) => {
      const d = g.path.scale(1, -1).toSVG();
      if (d) page.drawSvgPath(d, { x: cx + lay.positions[k].xOffset * scale, y: baseline, scale, color: hex(color), opacity, borderWidth: 0 });
      cx += lay.positions[k].xAdvance * scale;
    });
    run = "";
  };
  for (const ch of text) {
    if (isDigit(ch)) {
      drawRun();
      const g = fk.glyphForCodePoint(ch.codePointAt(0)!);
      const gw = g.advanceWidth * scale;
      const d = g.path.scale(1, -1).toSVG();
      if (d) page.drawSvgPath(d, { x: cx + (DIGIT_CELL * size - gw) / 2, y: baseline, scale, color: hex(color), opacity, borderWidth: 0 });
      cx += DIGIT_CELL * size;
    } else run += ch;
  }
  drawRun();
  const width = cx - x;
  // Camada de texto invisível, esticada para a mesma largura.
  const natural = font.widthOfTextAtSize(text, size);
  page.pushOperators(pushGraphicsState());
  page.drawText(text, { x, y: baseline, size, font, opacity: 0, color: hex(color) });
  page.pushOperators(popGraphicsState());
  void natural;
  return width;
}

function drawRight(page: PDFPage, text: string, xRight: number, yTop: number, font: PDFFont, spec: readonly [number, number], color: string, opacity = 1) {
  return drawText(page, text, xRight - textWidth(text, font, spec[0]), yTop, font, spec, color, opacity);
}

/** Quebra em linhas pela largura; acima de `maxLines` corta com reticências e marca o excesso. */
export function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number): { lines: string[]; overflow: boolean } {
  // "R$ 1.234,56" nunca quebra entre o símbolo e o número.
  const words = text.replace(/R\$ /g, "R$\u00A0").split(/[ \t\n]+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, font, size) <= width || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  for (let k = 0; k < lines.length; k++) lines[k] = lines[k].replace(/\u00A0/g, " ");
  if (lines.length <= maxLines) return { lines, overflow: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && textWidth(`${last}…`, font, size) > width) last = last.slice(0, last.lastIndexOf(" ") > 0 ? last.lastIndexOf(" ") : last.length - 1);
  kept[maxLines - 1] = `${last}…`;
  return { lines: kept, overflow: true };
}

/** Uma linha que cabe na largura (corta com reticências). */
function fit(text: string, font: PDFFont, size: number, width: number): { text: string; overflow: boolean } {
  if (textWidth(text, font, size) <= width) return { text, overflow: false };
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font, size) > width) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, overflow: true };
}

// ---------------------------------------------------------------------------
// Formas
// ---------------------------------------------------------------------------

const K = 0.5523; // aproximação de quarto de círculo por Bézier
function roundedPathOps(x: number, yTop: number, w: number, h: number, r: number) {
  const x0 = x; const x1 = x + w; const y1 = PAGE.h - yTop; const y0 = y1 - h; const k = r * K;
  return [
    moveTo(x0 + r, y0), lineTo(x1 - r, y0), appendBezierCurve(x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r),
    lineTo(x1, y1 - r), appendBezierCurve(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1),
    lineTo(x0 + r, y1), appendBezierCurve(x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r),
    lineTo(x0, y0 + r), appendBezierCurve(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0), closePath(),
  ];
}

function svgRounded(w: number, h: number, r: number) {
  const k = r * K;
  return `M ${r} 0 H ${w - r} C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} V ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} H ${r} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} V ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`;
}

function card(page: PDFPage, x: number, yTop: number, w: number, h: number, opts: { r?: number; fill?: string; border?: string | null } = {}) {
  const r = opts.r ?? 14;
  page.drawSvgPath(svgRounded(w, h, r), { x, y: PAGE.h - yTop, color: hex(opts.fill ?? C.surface), borderColor: opts.border === null ? undefined : hex(opts.border ?? C.border), borderWidth: opts.border === null ? 0 : 0.75 });
}

let shadingSeq = 0;
/** Degradê linear vetorial (sombreamento axial do PDF) recortado num retângulo arredondado. */
function gradientRect(doc: PDFDocument, page: PDFPage, x: number, yTop: number, w: number, h: number, r: number, stops: Array<[number, string]>, angleDeg = 135) {
  const ctx = doc.context;
  const c = (s: string) => { const v = hex(s) as any; return [v.red, v.green, v.blue]; };
  const segs = stops.slice(1).map(([, col], idx) => ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: c(stops[idx][1]), C1: c(col), N: 1 }));
  const fn = segs.length === 1 ? segs[0] : ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: segs, Bounds: stops.slice(1, -1).map(([p]) => p), Encode: segs.flatMap(() => [0, 1]) });
  // Linha do degradê como no CSS: passa pelo centro; comprimento |w·sen a| + |h·cos a|.
  const a = (angleDeg * Math.PI) / 180;
  const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const cx = x + w / 2; const cy = PAGE.h - yTop - h / 2;
  // CSS: direção (sen a, −cos a) com y para baixo; no PDF (y para cima) vira (sen a, cos a).
  const dx = Math.sin(a) * len / 2; const dy = Math.cos(a) * len / 2;
  const shading = ctx.obj({ ShadingType: 2, ColorSpace: "DeviceRGB", Coords: [cx - dx, cy - dy, cx + dx, cy + dy], Function: fn, Extend: [true, true] });
  const ref = ctx.register(shading);
  const name = `NinoSh${++shadingSeq}`;
  const res = page.node.Resources()!;
  let dict = res.lookupMaybe(PDFName.of("Shading"), (ctx.obj({}) as any).constructor) as any;
  if (!dict) { dict = ctx.obj({}); res.set(PDFName.of("Shading"), dict); }
  dict.set(PDFName.of(name), ref);
  page.pushOperators(pushGraphicsState(), ...roundedPathOps(x, yTop, w, h, r), clip(), endPath(), PDFOperator.of("sh" as any, [PDFName.of(name)]), popGraphicsState());
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

export interface RenderIssue { block: string; kind: "overflow" | "missing"; detail: string }
interface Ctx { doc: PDFDocument; page: PDFPage; f: Fonts; issues: RenderIssue[] }

const X = PAGE.margin;
const W = PAGE.w - PAGE.margin * 2;

function header(c: Ctx, dto: SummaryDTO, y: number) {
  const { page, f } = c;
  const t = fit(dto.title, f.bold, T.title[0], W - 110);
  if (t.overflow) c.issues.push({ block: "header", kind: "overflow", detail: dto.title });
  drawText(page, t.text, X, y + 4, f.bold, T.title, C.text);
  drawText(page, fit(dto.subtitle, f.reg, T.caption[0], W - 110).text, X, y + 4 + T.title[1] + 4, f.reg, T.caption, C.muted);
  // Logotipo: palavra "nino" em degradê roxo não é possível em texto selecionável; usa a cor primária.
  drawRight(page, "nino", X + W, y + 2, f.bold, T.logo, C.primary);
  drawRight(page, "Insights", X + W, y + 2 + T.logo[1], f.semi, T.footer, C.violet);
  page.drawLine({ start: { x: X, y: PAGE.h - (y + H.header - 4) }, end: { x: X + W, y: PAGE.h - (y + H.header - 4) }, thickness: 0.75, color: hex(C.border) });
}

function hero(c: Ctx, dto: SummaryDTO, y: number) {
  const { doc, page, f } = c;
  gradientRect(doc, page, X, y, W, H.hero, 16, [[0, C.heroFrom], [0.54, C.heroMid], [1, C.heroTo]]);
  const m = dto.hero;
  const pad = 20;
  const leftW = W * 0.6 - pad;
  drawText(page, m.label, X + pad, y + 16, f.semi, T.body, "#FFFFFF", 0.82);
  const value = m.amount_cents == null ? "não disponível" : brl(m.amount_cents);
  drawText(page, value, X + pad, y + 16 + T.body[1] + 4, f.bold, T.hero, "#FFFFFF");
  // Selo da comparação (texto em branco; cor só quando o tom é risco/atenção).
  const chip = fit(m.delta_text, f.semi, T.caption[0], leftW - 16);
  const chipW = textWidth(chip.text, f.semi, T.caption[0]) + 16;
  const chipY = y + 16 + T.body[1] + 4 + T.hero[1] + 6;
  const alarm = m.tone === "risk" || m.tone === "attention";
  page.drawSvgPath(svgRounded(chipW, 20, 10), { x: X + pad, y: PAGE.h - chipY, color: hex(alarm ? TONE[m.tone] : "#FFFFFF"), opacity: alarm ? 1 : 0.14, borderWidth: 0 });
  drawText(page, chip.text, X + pad + 8, chipY + 3.5, f.semi, T.caption, "#FFFFFF");
  if (m.note) drawText(page, fit(m.note, f.reg, T.caption[0], leftW).text, X + pad, chipY + 20 + 6, f.reg, T.caption, "#FFFFFF", 0.72);

  // Coluna direita: base da comparação, separada por um fio.
  const rx = X + W * 0.62;
  const rw = X + W - pad - rx;
  page.drawLine({ start: { x: rx - 12, y: PAGE.h - (y + 18) }, end: { x: rx - 12, y: PAGE.h - (y + H.hero - 18) }, thickness: 0.75, color: hex("#FFFFFF"), opacity: 0.18 });
  const side = dto.hero_side;
  drawText(page, fit(side.label, f.reg, T.caption[0], rw).text, rx, y + 20, f.reg, T.caption, "#FFFFFF", 0.72);
  drawText(page, fit(side.value, f.bold, T.kpi[0], rw).text, rx, y + 20 + T.caption[1] + 4, f.bold, T.kpi, "#FFFFFF", 0.92);
  const sideNote = side.note ? wrap(side.note, f.reg, T.caption[0], rw, 1) : null;
  if (sideNote?.overflow) c.issues.push({ block: "hero.side", kind: "overflow", detail: side.note! });
  if (sideNote) sideNote.lines.forEach((ln, k) => drawText(page, ln, rx, y + 20 + T.caption[1] + 4 + T.kpi[1] + 2 + k * T.caption[1], f.reg, T.caption, "#FFFFFF", 0.72));
  const open = dto.as_of < addDaysIso(dto.period_end_exclusive, -1);
  const st = !dto.is_partial ? "Período fechado" : open ? "Período em andamento" : "Fechamento parcial";
  drawText(page, st, rx, y + H.hero - 20 - T.caption[1] * 2, f.semi, T.caption, "#FFFFFF", 0.82);
  drawText(page, `Corte em ${ddmmyyyy(dto.as_of)}`, rx, y + H.hero - 20 - T.caption[1], f.reg, T.caption, "#FFFFFF", 0.72);
}

function kpiCards(c: Ctx, kpis: SummaryMetric[], y: number) {
  const { page, f } = c;
  const gap = 12;
  const w = (W - gap * 2) / 3;
  kpis.slice(0, 3).forEach((m, idx) => {
    const x = X + idx * (w + gap);
    card(page, x, y, w, H.kpis, { r: 12 });
    const p = 12;
    drawText(page, fit(m.label, f.semi, T.caption[0], w - p * 2).text, x + p, y + 10, f.semi, T.caption, C.muted);
    const value = m.amount_cents == null ? "não disponível" : brl(m.amount_cents);
    const vf = fit(value, f.bold, m.amount_cents == null ? T.body[0] : T.kpi[0], w - p * 2);
    if (vf.overflow) c.issues.push({ block: `kpi:${m.id}`, kind: "overflow", detail: value });
    drawText(page, vf.text, x + p, y + 10 + T.caption[1] + 3, f.bold, m.amount_cents == null ? [T.body[0], T.kpi[1]] : T.kpi, m.amount_cents == null ? C.muted : TONE[m.tone]);
    const d = m.amount_cents == null ? (m.reason ?? "não disponível") : m.delta_text;
    const df = wrap(d, f.reg, T.caption[0], w - p * 2, 2);
    df.lines.forEach((ln, k) => drawText(page, ln, x + p, y + 10 + T.caption[1] + 3 + T.kpi[1] + 2 + k * T.caption[1], f.reg, T.caption, C.muted));
  });
}

function categoriesCard(c: Ctx, dto: SummaryDTO, x: number, y: number, w: number) {
  const { page, f, doc } = c;
  card(page, x, y, w, H.cats);
  const p = 14;
  drawText(page, dto.categories_title, x + p, y + 12, f.bold, T.section, C.text);
  if (!dto.categories.length) {
    drawText(page, dto.categories_empty ?? "Nenhum lançamento registrado.", x + p, y + 12 + T.section[1] + 10, f.reg, T.body, C.muted);
    return;
  }
  const rowH = 30;
  const top = y + 12 + T.section[1] + 6;
  const deltaW = Math.min(150, w * 0.36);
  dto.categories.forEach((cat, k) => {
    const ry = top + k * rowH;
    const amount = brl(cat.amount_cents);
    const aw = textWidth(amount, f.bold, T.body[0]);
    drawText(page, fit(cat.name, f.semi, T.body[0], w - p * 2 - aw - 12).text, x + p, ry, f.semi, T.body, C.text);
    drawRight(page, amount, x + w - p, ry, f.bold, T.body, C.text);
    const barY = ry + T.body[1] + 3;
    const barW = w - p * 2 - deltaW - 10;
    page.drawSvgPath(svgRounded(barW, 6, 3), { x: x + p, y: PAGE.h - barY, color: hex(C.insight), borderWidth: 0 });
    if (cat.bar != null && cat.bar > 0) gradientRect(doc, page, x + p, barY, Math.max(6, barW * cat.bar), 6, 3, [[0, "#6D4AFF"], [1, C.violet]], 90);
    drawRight(page, fit(cat.delta_text, f.reg, T.caption[0], deltaW).text, x + w - p, barY - 4, f.reg, T.caption, C.muted);
  });
}

function evolutionCard(c: Ctx, dto: SummaryDTO, x: number, y: number, w: number) {
  const { page, f } = c;
  card(page, x, y, w, H.cats);
  const p = 14;
  drawText(page, "Sua evolução", x + p, y + 12, f.bold, T.section, C.text);
  const lines = dto.evolution?.lines ?? [];
  lines.forEach((l, k) => {
    const ly = y + 12 + T.section[1] + 4 + k * 15;
    const vw = textWidth(l.value, f.semi, T.caption[0]);
    drawText(page, fit(l.label, f.reg, T.caption[0], w - p * 2 - vw - 8).text, x + p, ly, f.reg, T.caption, C.muted);
    drawRight(page, l.value, x + w - p, ly, f.semi, T.caption, TONE[l.tone ?? "neutral"]);
  });
  // Mini gráfico do resultado mensal: zero visível, barra do mês parcial tracejada.
  const bars = dto.evolution?.bars ?? [];
  const chartTop = y + 12 + T.section[1] + 4 + lines.length * 15 + 6;
  const chartH = H.cats - (chartTop - y) - 12 - 11;
  if (bars.length < 2 || chartH < 16) return;
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value_cents)));
  const hasNeg = bars.some((b) => b.value_cents < 0);
  const hasPos = bars.some((b) => b.value_cents > 0);
  const zeroY = hasNeg && hasPos ? chartTop + chartH / 2 : hasNeg ? chartTop : chartTop + chartH;
  const scale = (hasNeg && hasPos ? chartH / 2 : chartH) / max;
  const slot = (w - p * 2) / bars.length;
  const bw = Math.min(18, slot * 0.55);
  bars.forEach((b, k) => {
    const bx = x + p + k * slot + (slot - bw) / 2;
    const bh = Math.max(1, Math.abs(b.value_cents) * scale);
    const by = b.value_cents >= 0 ? zeroY - bh : zeroY;
    const color = b.value_cents < 0 ? C.risk : C.violet;
    page.drawRectangle({ x: bx, y: PAGE.h - by - bh, width: bw, height: bh, color: b.partial ? undefined : hex(color), borderColor: b.partial ? hex(color) : undefined, borderWidth: b.partial ? 0.75 : 0, borderDashArray: b.partial ? [2, 1.5] : undefined, opacity: 1 });
    const lw = textWidth(b.label, f.reg, T.footer[0]);
    drawText(page, b.label, x + p + k * slot + (slot - lw) / 2, chartTop + chartH + 1, f.reg, T.footer, C.muted);
  });
  page.drawLine({ start: { x: x + p, y: PAGE.h - zeroY }, end: { x: x + w - p, y: PAGE.h - zeroY }, thickness: 0.75, color: hex(C.muted) });
}

function insightCard(c: Ctx, dto: SummaryDTO, y: number) {
  const { page, f } = c;
  card(page, X, y, W, H.insight, { r: 12, fill: C.insight, border: null });
  page.drawSvgPath(svgRounded(4, H.insight - 24, 2), { x: X + 12, y: PAGE.h - (y + 12), color: hex(TONE[dto.insight.tone] === C.text ? C.primary : TONE[dto.insight.tone]), borderWidth: 0 });
  const p = 26;
  drawText(page, "O que mais chamou atenção", X + p, y + 12, f.bold, T.caption, C.primary);
  const t = fit(dto.insight.title, f.bold, T.section[0], W - p - 16);
  if (t.overflow) c.issues.push({ block: "insight.title", kind: "overflow", detail: dto.insight.title });
  drawText(page, t.text, X + p, y + 12 + T.caption[1] + 3, f.bold, T.section, C.text);
  const body = wrap(dto.insight.body, f.reg, T.body[0], W - p - 16, 2);
  if (body.overflow) c.issues.push({ block: "insight.body", kind: "overflow", detail: dto.insight.body });
  body.lines.forEach((ln, k) => drawText(page, ln, X + p, y + 12 + T.caption[1] + 3 + T.section[1] + 3 + k * T.body[1], f.reg, T.body, C.text));
}

function futureCard(c: Ctx, title: string, lines: SummaryLine[], y: number) {
  const { page, f } = c;
  card(page, X, y, W, H.future);
  const p = 14;
  drawText(page, title, X + p, y + 12, f.bold, T.section, C.text);
  const cols = lines.slice(0, 3);
  const cw = (W - p * 2) / cols.length;
  cols.forEach((l, k) => {
    const cx = X + p + k * cw;
    const inner = cw - (k < cols.length - 1 ? 16 : 0);
    if (k > 0) page.drawLine({ start: { x: cx - 8, y: PAGE.h - (y + 12 + T.section[1] + 6) }, end: { x: cx - 8, y: PAGE.h - (y + H.future - 12) }, thickness: 0.75, color: hex(C.border) });
    const ox = k > 0 ? 0 : 0;
    const top = y + 12 + T.section[1] + 6;
    drawText(page, fit(l.label, f.semi, T.caption[0], inner).text, cx + ox, top, f.semi, T.caption, C.muted);
    // Valor em 15 pt; texto longo (ex.: "sem renda informada") desce para 13 pt antes de contar como cortado.
    const vsize = textWidth(l.value, f.bold, 15) <= inner ? 15 : 13;
    const vf = fit(l.value, f.bold, vsize, inner);
    if (vf.overflow) c.issues.push({ block: "future", kind: "overflow", detail: l.value });
    drawText(page, vf.text, cx + ox, top + T.caption[1] + 3, f.bold, [vsize, 19], TONE[l.tone ?? "neutral"]);
    if (l.note) wrap(l.note, f.reg, T.footer[0], inner, 2).lines.forEach((ln, j) => drawText(page, ln, cx + ox, top + T.caption[1] + 3 + 19 + 3 + j * T.footer[1], f.reg, T.footer, C.muted));
  });
}

function actionCard(c: Ctx, dto: SummaryDTO, y: number, h: number) {
  const { page, f, doc } = c;
  card(page, X, y, W, h, { r: 12, border: C.border });
  gradientRect(doc, page, X + 12, y + 12, 4, h - 24, 2, [[0, "#6D4AFF"], [1, C.violet]], 180);
  const p = 26;
  drawText(page, "Seu próximo passo", X + p, y + 12, f.bold, T.caption, C.primary);
  const t = fit(dto.action.title, f.bold, T.section[0], W - p - 16);
  if (t.overflow) c.issues.push({ block: "action.title", kind: "overflow", detail: dto.action.title });
  drawText(page, t.text, X + p, y + 12 + T.caption[1] + 3, f.bold, T.section, C.text);
  const maxLines = Math.max(1, Math.floor((h - (12 + T.caption[1] + 3 + T.section[1] + 3) - 6) / T.body[1]));
  const body = wrap(dto.action.body, f.reg, T.body[0], W - p - 16, maxLines);
  if (body.overflow) c.issues.push({ block: "action.body", kind: "overflow", detail: dto.action.body });
  body.lines.forEach((ln, k) => drawText(page, ln, X + p, y + 12 + T.caption[1] + 3 + T.section[1] + 3 + k * T.body[1], f.reg, T.body, C.muted));
}

function footer(c: Ctx, dto: SummaryDTO, y: number, updatedAt: string) {
  const { page, f } = c;
  page.drawLine({ start: { x: X, y: PAGE.h - y }, end: { x: X + W, y: PAGE.h - y }, thickness: 0.75, color: hex(C.border) });
  const l1 = `Data de corte: ${ddmmyyyy(dto.as_of)} · Atualizado em ${updatedAt} · ${dto.template_version}`;
  drawText(page, fit(l1, f.reg, T.footer[0], W).text, X, y + 6, f.reg, T.footer, C.muted);
  if (dto.caveat) {
    const cv = fit(dto.caveat, f.reg, T.footer[0], W);
    if (cv.overflow) c.issues.push({ block: "footer.caveat", kind: "overflow", detail: dto.caveat });
    drawText(page, cv.text, X, y + 6 + T.footer[1] + 2, f.reg, T.footer, C.muted);
  }
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/** "26/11/2026 08:00 (America/Sao_Paulo)" a partir do instante e do fuso. */
export function localStamp(iso: string, tz: string): string {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
  } catch { return iso.slice(0, 16).replace("T", " "); }
}

export interface RenderResult { bytes: Uint8Array; pages: number; issues: RenderIssue[]; sizeBytes: number }

export async function renderSummaryPdf(dto: SummaryDTO): Promise<RenderResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytesOf = [b64(DM_SANS_REGULAR), b64(DM_SANS_SEMIBOLD), b64(DM_SANS_BOLD)];
  const [reg, semi, bold] = await Promise.all(bytesOf.map((b) => doc.embedFont(b, { subset: true })));
  [reg, semi, bold].forEach((f, k) => FACES.set(f, (fontkit as any).create(bytesOf[k])));
  const t = dto.type === "weekly" ? "Resumo semanal" : "Resumo mensal";
  doc.setTitle(`${dto.title} · Nino`);
  doc.setSubject(t);
  doc.setAuthor("Nino");
  doc.setCreator(dto.template_version);
  doc.setProducer("Nino Insights");
  doc.setLanguage("pt-BR");
  doc.setCreationDate(new Date(dto.generated_at));
  doc.setModificationDate(new Date(dto.generated_at));
  const page = doc.addPage([PAGE.w, PAGE.h]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: hex(C.bg) });
  const c: Ctx = { doc, page, f: { reg, semi, bold }, issues: [] };

  let y = PAGE.margin;
  header(c, dto, y); y += H.header + GAP;
  hero(c, dto, y); y += H.hero + GAP;
  kpiCards(c, dto.kpis, y); y += H.kpis + GAP;
  if (dto.type === "monthly") {
    const lw = Math.round(W * 0.55);
    categoriesCard(c, dto, X, y, lw);
    evolutionCard(c, dto, X + lw + 12, y, W - lw - 12);
  } else categoriesCard(c, dto, X, y, W);
  y += H.cats + GAP;
  insightCard(c, dto, y); y += H.insight + GAP;
  futureCard(c, dto.future_title, dto.future, y); y += H.future + GAP;
  const footerY = PAGE.h - PAGE.margin - H.footer;
  const actionH = footerY - GAP - y;
  if (actionH < H.action) c.issues.push({ block: "action", kind: "overflow", detail: `altura ${actionH}` });
  actionCard(c, dto, y, actionH);
  footer(c, dto, footerY + 6, localStamp(dto.generated_at, dto.timezone));

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount(), issues: c.issues, sizeBytes: bytes.byteLength };
}
