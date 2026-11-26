// Desenho do resumo em PDF, pensado para o celular: página na largura de uma tela (390 pt, como o app),
// altura do tamanho do conteúdo, uma página só, texto selecionável, fontes embutidas, só vetor.
// Segue o design system do Nino (mesmos tokens do app): fundo #F5F4FA, cartões brancos com borda #E8E6EF
// e raio 18, destaque com o degradê do "Disponível hoje" (raio 24), DM Sans, rótulos 11/semibold em roxo.
// Layout, cores e ordem são fixos aqui (nada disso vem de IA).
// deno-lint-ignore-file no-explicit-any
import {
  PDFDocument, PDFName, PDFOperator, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo,
  appendBezierCurve, closePath, clip, endPath, type PDFFont, type PDFPage, type RGB,
} from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { DM_SANS_BOLD, DM_SANS_REGULAR, DM_SANS_SEMIBOLD } from "./fonts.ts";
import { brl, ddmmyyyy } from "./format.ts";
import type { SummaryDTO, SummaryLine, Tone } from "./types.ts";

// ---------------------------------------------------------------------------
// Tokens (src/index.css do app)
// ---------------------------------------------------------------------------

/** Página alta de trabalho; no fim a área visível é recortada para a altura usada. */
export const PAGE = { w: 390, h: 3000, margin: 16 } as const;
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const C = {
  bg: "#F5F4FA", surface: "#FFFFFF", border: "#E8E6EF", text: "#101019", muted: "#6C6D7F", primary: "#6D2EFF",
  secondary: "#F4F0FF", neutralBg: "#F3F3F7", good: "#158962", risk: "#C94F68", attention: "#B45309",
  heroFrom: "#17102E", heroMid: "#3C1B78", heroTo: "#6B2CFF", barFrom: "#6D4AFF", barTo: "#8B5CF6", barPrev: "#DCD3FF",
} as const;
const TONE: Record<Tone, string> = { neutral: C.text, good: C.good, risk: C.risk, attention: C.attention };
/** Tamanho / entrelinha, iguais às classes usadas no app. */
const T = {
  logo: [20, 24], title: [22, 28], sub: [12, 16], eyebrow: [11, 14], cardTitle: [15, 20], body: [13, 18], small: [11, 14],
  heroLabel: [12, 16], hero: [30, 36], heroSecondary: [18, 22], value: [17, 22], footer: [10, 14],
} as const;
const GAP = 12;
const PAD = 16;

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
// Blocos (cada um desenha a partir de y e devolve a altura usada)
// ---------------------------------------------------------------------------

export interface RenderIssue { block: string; kind: "overflow" | "missing"; detail: string }
interface Ctx { doc: PDFDocument; page: PDFPage; f: Fonts; issues: RenderIssue[] }

const X = PAGE.margin;
const W = PAGE.w - PAGE.margin * 2;
const IN = W - PAD * 2;

/** Texto em várias linhas; devolve a altura. Corte vira problema registrado (o PDF não sai). */
function para(c: Ctx, block: string, text: string, x: number, y: number, width: number, font: PDFFont, spec: readonly [number, number], color: string, maxLines: number, opacity = 1): number {
  const w = wrap(text, font, spec[0], width, maxLines);
  if (w.overflow) c.issues.push({ block, kind: "overflow", detail: text });
  w.lines.forEach((ln, k) => drawText(c.page, ln, x, y + k * spec[1], font, spec, color, opacity));
  return w.lines.length * spec[1];
}

function eyebrow(c: Ctx, text: string, x: number, y: number, color: string = C.primary): number {
  drawText(c.page, text, x, y, c.f.semi, T.eyebrow, color);
  return T.eyebrow[1];
}

function header(c: Ctx, dto: SummaryDTO, y: number): number {
  const { page, f } = c;
  drawText(page, "nino", X, y, f.bold, T.logo, C.primary);
  const chip = dto.type === "weekly" ? "Resumo semanal" : "Resumo mensal";
  const cw = textWidth(chip, f.semi, T.eyebrow[0]) + 20;
  page.drawSvgPath(svgRounded(cw, 24, 12), { x: X + W - cw, y: PAGE.h - y, color: hex(C.secondary), borderWidth: 0 });
  drawText(page, chip, X + W - cw + 10, y + 5, f.semi, T.eyebrow, C.primary);
  let h = T.logo[1] + 10;
  h += para(c, "header.title", dto.title.replace(/^Resumo da semana · /, "Semana de ").replace(/^Resumo de (.)/, (_m, ch: string) => ch.toUpperCase()), X, y + h, W, f.bold, T.title, C.text, 2);
  h += 2;
  h += para(c, "header.subtitle", dto.subtitle, X, y + h, W, f.reg, T.sub, C.muted, 2);
  return h;
}

function hero(c: Ctx, dto: SummaryDTO, y: number): number {
  const { doc, page, f } = c;
  const m = dto.hero;
  const p = 20; const iw = W - p * 2;
  // Mede antes de desenhar o fundo (o degradê vai por baixo do texto).
  const rowW = (iw - 16) / 2;
  const rowNotes = dto.hero_row.map((r) => wrap(r.note ?? "", f.reg, T.small[0], rowW, 2).lines.length);
  const sideText = `${dto.hero_side.label}: ${dto.hero_side.value}${dto.hero_side.note ? ` · ${dto.hero_side.note}` : ""}`;
  const sideLines = wrap(sideText, f.reg, T.sub[0], iw, 2).lines.length;
  const rowH = dto.hero_row.length ? 14 + T.small[1] + 2 + T.heroSecondary[1] + 2 + Math.max(...rowNotes, 0) * T.small[1] : 0;
  const h = p + T.heroLabel[1] + 4 + T.hero[1] + 8 + 24 + 8 + sideLines * T.sub[1] + rowH + p;
  gradientRect(doc, page, X, y, W, h, 24, [[0, C.heroFrom], [0.54, C.heroMid], [1, C.heroTo]]);

  let cy = y + p;
  drawText(page, m.label.toUpperCase(), X + p, cy, f.semi, T.heroLabel, "#FFFFFF", 0.8); cy += T.heroLabel[1] + 4;
  const value = m.amount_cents == null ? "não disponível" : brl(m.amount_cents);
  const vf = fit(value, f.bold, T.hero[0], iw);
  if (vf.overflow) c.issues.push({ block: "hero.value", kind: "overflow", detail: value });
  drawText(page, vf.text, X + p, cy, f.bold, T.hero, "#FFFFFF"); cy += T.hero[1] + 8;
  const alarm = m.tone === "risk" || m.tone === "attention";
  const chip = fit(m.delta_text, f.semi, T.sub[0], iw - 20);
  if (chip.overflow) c.issues.push({ block: "hero.chip", kind: "overflow", detail: m.delta_text });
  const chipW = textWidth(chip.text, f.semi, T.sub[0]) + 20;
  page.drawSvgPath(svgRounded(chipW, 24, 12), { x: X + p, y: PAGE.h - cy, color: hex(alarm ? TONE[m.tone] : "#FFFFFF"), opacity: alarm ? 1 : 0.16, borderWidth: 0 });
  drawText(page, chip.text, X + p + 10, cy + 4, f.semi, T.sub, "#FFFFFF"); cy += 24 + 8;
  cy += para(c, "hero.side", sideText, X + p, cy, iw, f.reg, T.sub, "#FFFFFF", 2, 0.8);
  if (dto.hero_row.length) {
    cy += 10;
    page.drawLine({ start: { x: X + p, y: PAGE.h - cy }, end: { x: X + W - p, y: PAGE.h - cy }, thickness: 0.75, color: hex("#FFFFFF"), opacity: 0.2 });
    cy += 4;
    dto.hero_row.slice(0, 2).forEach((r, k) => {
      const rx = X + p + k * (rowW + 16);
      if (k > 0) page.drawLine({ start: { x: rx - 8, y: PAGE.h - cy }, end: { x: rx - 8, y: PAGE.h - (cy + rowH - 14) }, thickness: 0.75, color: hex("#FFFFFF"), opacity: 0.2 });
      drawText(page, fit(r.label, f.reg, T.small[0], rowW).text, rx, cy, f.reg, T.small, "#FFFFFF", 0.78);
      const rv = fit(r.value, f.bold, T.heroSecondary[0], rowW);
      if (rv.overflow) c.issues.push({ block: "hero.row", kind: "overflow", detail: r.value });
      drawText(page, rv.text, rx, cy + T.small[1] + 2, f.bold, T.heroSecondary, "#FFFFFF");
      if (r.note) para(c, "hero.row.note", r.note, rx, cy + T.small[1] + 2 + T.heroSecondary[1] + 2, rowW, f.reg, T.small, "#FFFFFF", 2, 0.72);
    });
  }
  return h;
}

function cardFrame(c: Ctx, y: number, h: number, fill: string = C.surface, border: string | null = C.border) {
  card(c.page, X, y, W, h, { r: 18, fill, border });
}

/** Mede um bloco desenhando numa página descartável. */
function measure(c: Ctx, fn: (cc: Ctx, y: number) => number): number {
  const scratch = c.doc.addPage([PAGE.w, PAGE.h]);
  const h = fn({ ...c, page: scratch, issues: [] }, 0);
  c.doc.removePage(c.doc.getPageCount() - 1);
  return h;
}

function boxed(c: Ctx, y: number, inner: (cc: Ctx, y: number) => number, fill: string = C.surface, border: string | null = C.border): number {
  const h = measure(c, (cc, yy) => inner(cc, yy + PAD)) + PAD * 2;
  cardFrame(c, y, h, fill, border);
  inner(c, y + PAD);
  return h;
}

function weekBarsCard(c: Ctx, dto: SummaryDTO, y: number): number {
  const wb = dto.week_bars;
  if (!wb) return -GAP;
  return boxed(c, y, (cc, yy) => {
    const { page, f } = cc;
    let cy = yy;
    cy += eyebrow(cc, wb.title, X + PAD, cy) + 2;
    drawText(page, `${wb.current_label} × ${wb.previous_label}`, X + PAD, cy, f.bold, T.cardTitle, C.text); cy += T.cardTitle[1] + 8;
    // Legenda.
    const leg = (x: number, color: string, label: string) => { page.drawSvgPath(svgRounded(10, 10, 3), { x, y: PAGE.h - (cy + 2), color: hex(color), borderWidth: 0 }); drawText(page, label, x + 14, cy, f.reg, T.small, C.muted); return 14 + textWidth(label, f.reg, T.small[0]) + 14; };
    let lx = X + PAD; lx += leg(lx, C.primary, wb.current_label); leg(lx, C.barPrev, wb.previous_label);
    cy += T.small[1] + 10;
    const chartH = 96; const labelsH = 16;
    const n = wb.bars.length; const slot = IN / n; const bw = Math.min(18, slot * 0.28);
    const max = Math.max(1, ...wb.bars.flatMap((b) => [b.current_cents ?? 0, b.previous_cents ?? 0]));
    const base = cy + 14 + chartH;
    wb.bars.forEach((b, k) => {
      const cx = X + PAD + k * slot + slot / 2;
      const ph = b.previous_cents == null ? 0 : Math.max(b.previous_cents > 0 ? 2 : 0, (Math.max(0, b.previous_cents) / max) * chartH);
      if (ph > 0) page.drawSvgPath(svgRounded(bw, ph, Math.min(4, ph / 2)), { x: cx + 1, y: PAGE.h - (base - ph), color: hex(C.barPrev), borderWidth: 0 });
      if (b.current_cents != null) {
        const ch = Math.max(b.current_cents > 0 ? 2 : 0, (Math.max(0, b.current_cents) / max) * chartH);
        if (ch > 0) {
          if (b.partial) page.drawSvgPath(svgRounded(bw, ch, Math.min(4, ch / 2)), { x: cx - bw - 1, y: PAGE.h - (base - ch), color: hex(C.primary), opacity: 0.5, borderWidth: 0 });
          else gradientRect(cc.doc, page, cx - bw - 1, base - ch, bw, ch, Math.min(4, ch / 2), [[0, C.barFrom], [1, C.barTo]], 180);
        }
        const v = brl(b.current_cents, { noCents: true }).replace("R$ ", "");
        const vw = textWidth(v, f.semi, T.footer[0]);
        drawText(page, v, cx - bw / 2 - 1 - vw / 2, base - ch - 14, f.semi, T.footer, C.text);
      }
      const lw = textWidth(b.label, f.reg, T.small[0]);
      drawText(page, b.label, cx - lw / 2, base + 4, f.reg, T.small, b.current_cents == null ? C.muted : C.text, b.current_cents == null ? 0.6 : 1);
    });
    page.drawLine({ start: { x: X + PAD, y: PAGE.h - base }, end: { x: X + W - PAD, y: PAGE.h - base }, thickness: 0.75, color: hex(C.border) });
    cy = base + labelsH + 8;
    const tot = `${wb.current_label}: ${brl(wb.total_current_cents)}${wb.total_previous_cents == null ? "" : ` · ${wb.previous_label}, mesmos dias: ${brl(wb.total_previous_cents)}`}`;
    cy += para(cc, "weekbars.total", tot, X + PAD, cy, IN, f.semi, T.small, C.text, 2) + 2;
    cy += para(cc, "weekbars.note", wb.bars.some((b) => b.partial) ? `${wb.note} Barra clara = semana em andamento.` : wb.note, X + PAD, cy, IN, f.reg, T.small, C.muted, 3);
    return cy - yy;
  });
}

function categoriesCard(c: Ctx, dto: SummaryDTO, y: number): number {
  return boxed(c, y, (cc, yy) => {
    const { page, f, doc } = cc;
    let cy = yy;
    cy += eyebrow(cc, dto.categories_title, X + PAD, cy) + 8;
    if (!dto.categories.length) return cy - yy + para(cc, "categories.empty", dto.categories_empty ?? "Nenhum lançamento registrado.", X + PAD, cy, IN, f.reg, T.body, C.muted, 2);
    dto.categories.forEach((cat, k) => {
      if (k > 0) cy += 10;
      const amount = brl(cat.amount_cents);
      const aw = textWidth(amount, f.bold, T.body[0]);
      drawText(page, fit(cat.name, f.semi, T.body[0], IN - aw - 12).text, X + PAD, cy, f.semi, T.body, C.text);
      drawRight(page, amount, X + W - PAD, cy, f.bold, T.body, C.text);
      cy += T.body[1] + 4;
      const dw = Math.min(130, textWidth(cat.delta_text, f.reg, T.small[0]) + 4);
      const barW = IN - dw - 10;
      page.drawSvgPath(svgRounded(barW, 6, 3), { x: X + PAD, y: PAGE.h - (cy + 4), color: hex(C.neutralBg), borderWidth: 0 });
      if (cat.bar != null && cat.bar > 0) gradientRect(doc, page, X + PAD, cy + 4, Math.max(6, barW * cat.bar), 6, 3, [[0, C.barFrom], [1, C.barTo]], 90);
      const df = fit(cat.delta_text, f.reg, T.small[0], 130);
      drawRight(page, df.text, X + W - PAD, cy, f.reg, T.small, C.muted);
      cy += T.small[1];
    });
    return cy - yy;
  });
}

function factsCard(c: Ctx, title: string, facts: SummaryLine[], y: number): number {
  if (!facts.length) return -GAP;
  return boxed(c, y, (cc, yy) => {
    const { page, f } = cc;
    let cy = yy;
    cy += eyebrow(cc, title, X + PAD, cy) + 10;
    const colW = (IN - 16) / 2;
    for (let r = 0; r < facts.length; r += 2) {
      const pair = facts.slice(r, r + 2);
      if (r > 0) { page.drawLine({ start: { x: X + PAD, y: PAGE.h - (cy - 6) }, end: { x: X + W - PAD, y: PAGE.h - (cy - 6) }, thickness: 0.75, color: hex(C.border) }); cy += 6; }
      const heights = pair.map((l, k) => {
        const fx = X + PAD + k * (colW + 16);
        let hh = para(cc, "facts.label", l.label, fx, cy, colW, f.semi, T.small, C.muted, 2) + 2;
        const vsize: readonly [number, number] = textWidth(l.value, f.bold, T.value[0]) <= colW ? T.value : [14, 22];
        const vf = fit(l.value, f.bold, vsize[0], colW);
        if (vf.overflow) cc.issues.push({ block: "facts.value", kind: "overflow", detail: l.value });
        drawText(page, vf.text, fx, cy + hh, f.bold, vsize, TONE[l.tone ?? "neutral"]); hh += T.value[1] + 2;
        if (l.note) hh += para(cc, "facts.note", l.note, fx, cy + hh, colW, f.reg, T.small, C.muted, 3);
        return hh;
      });
      if (pair.length === 2) page.drawLine({ start: { x: X + PAD + colW + 8, y: PAGE.h - cy }, end: { x: X + PAD + colW + 8, y: PAGE.h - (cy + Math.max(...heights)) }, thickness: 0.75, color: hex(C.border) });
      cy += Math.max(...heights) + 12;
    }
    return cy - yy - 12;
  });
}

function evolutionCard(c: Ctx, dto: SummaryDTO, y: number): number {
  const ev = dto.evolution;
  if (!ev) return -GAP;
  return boxed(c, y, (cc, yy) => {
    const { page, f } = cc;
    let cy = yy;
    cy += eyebrow(cc, "Sua evolução", X + PAD, cy) + 8;
    ev.lines.forEach((l) => {
      const vw = textWidth(l.value, f.bold, T.body[0]);
      drawText(page, fit(l.label, f.reg, T.body[0], IN - vw - 10).text, X + PAD, cy, f.reg, T.body, C.muted);
      drawRight(page, l.value, X + W - PAD, cy, f.bold, T.body, TONE[l.tone ?? "neutral"]);
      cy += T.body[1];
      if (l.note) { drawRight(page, fit(l.note, f.reg, T.small[0], IN).text, X + W - PAD, cy, f.reg, T.small, C.muted); cy += T.small[1]; }
      cy += 6;
    });
    const bars = ev.bars;
    if (bars.length >= 2) {
      cy += 4;
      drawText(page, "Resultado mensal (receitas − consumo)", X + PAD, cy, f.semi, T.small, C.text); cy += T.small[1] + 8;
      const chartH = 64;
      const max = Math.max(1, ...bars.map((b) => Math.abs(b.value_cents)));
      const hasNeg = bars.some((b) => b.value_cents < 0); const hasPos = bars.some((b) => b.value_cents > 0);
      const zeroY = hasNeg && hasPos ? cy + chartH / 2 : hasNeg ? cy : cy + chartH;
      const scale = (hasNeg && hasPos ? chartH / 2 : chartH) / max;
      const slot = IN / bars.length; const bw = Math.min(22, slot * 0.5);
      bars.forEach((b, k) => {
        const bx = X + PAD + k * slot + (slot - bw) / 2;
        const bh = Math.max(1.5, Math.abs(b.value_cents) * scale);
        const by = b.value_cents >= 0 ? zeroY - bh : zeroY;
        const color = b.value_cents < 0 ? C.risk : C.primary;
        page.drawSvgPath(svgRounded(bw, bh, Math.min(3, bh / 2)), { x: bx, y: PAGE.h - by, color: hex(color), opacity: b.partial ? 0.45 : 1, borderWidth: 0 });
        const lw = textWidth(b.label, f.reg, T.small[0]);
        drawText(page, b.label, X + PAD + k * slot + (slot - lw) / 2, cy + chartH + 4, f.reg, T.small, C.muted);
      });
      page.drawLine({ start: { x: X + PAD, y: PAGE.h - zeroY }, end: { x: X + W - PAD, y: PAGE.h - zeroY }, thickness: 0.75, color: hex(C.muted) });
      cy += chartH + 4 + T.small[1];
    }
    return cy - yy;
  });
}

function textCard(c: Ctx, label: string, title: string, body: string, tone: Tone, y: number, soft: boolean, block: string): number {
  const inner = (cc: Ctx, yy: number) => {
    let cy = yy;
    cy += eyebrow(cc, label, X + PAD + 12, cy) + 4;
    cy += para(cc, `${block}.title`, title, X + PAD + 12, cy, IN - 12, cc.f.bold, T.cardTitle, C.text, 2) + 4;
    cy += para(cc, `${block}.body`, body, X + PAD + 12, cy, IN - 12, cc.f.reg, T.body, soft ? C.text : C.muted, 4);
    return cy - yy;
  };
  const h = boxed(c, y, inner, soft ? C.secondary : C.surface, soft ? null : C.border);
  const accent = tone === "neutral" || tone === "good" ? (tone === "good" ? C.good : C.primary) : TONE[tone];
  c.page.drawSvgPath(svgRounded(3, h - PAD * 2, 1.5), { x: X + PAD, y: PAGE.h - (y + PAD), color: hex(accent), borderWidth: 0 });
  return h;
}

function footer(c: Ctx, dto: SummaryDTO, y: number, updatedAt: string): number {
  const { page, f } = c;
  page.drawLine({ start: { x: X, y: PAGE.h - y }, end: { x: X + W, y: PAGE.h - y }, thickness: 0.75, color: hex(C.border) });
  let cy = y + 8;
  cy += para(c, "footer", `Data de corte ${ddmmyyyy(dto.as_of)} · atualizado em ${updatedAt}`, X, cy, W, f.reg, T.footer, C.muted, 2);
  if (dto.caveat) cy += para(c, "footer.caveat", dto.caveat, X, cy, W, f.reg, T.footer, C.muted, 3);
  cy += para(c, "footer.version", `Nino Insights · ${dto.template_version}`, X, cy, W, f.reg, T.footer, C.muted, 1);
  return cy - y;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/** "26/11/2026 08:00" no fuso do usuário. */
export function localStamp(iso: string, tz: string): string {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
  } catch { return iso.slice(0, 16).replace("T", " "); }
}

export interface RenderResult { bytes: Uint8Array; pages: number; issues: RenderIssue[]; sizeBytes: number; heightPt: number }

export async function renderSummaryPdf(dto: SummaryDTO): Promise<RenderResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytesOf = [b64(DM_SANS_REGULAR), b64(DM_SANS_SEMIBOLD), b64(DM_SANS_BOLD)];
  const [reg, semi, bold] = await Promise.all(bytesOf.map((b) => doc.embedFont(b, { subset: true })));
  [reg, semi, bold].forEach((f, k) => FACES.set(f, (fontkit as any).create(bytesOf[k])));
  doc.setTitle(`${dto.title} · Nino`);
  doc.setSubject(dto.type === "weekly" ? "Resumo semanal" : "Resumo mensal");
  doc.setAuthor("Nino");
  doc.setCreator(dto.template_version);
  doc.setProducer("Nino Insights");
  doc.setLanguage("pt-BR");
  doc.setCreationDate(new Date(dto.generated_at));
  doc.setModificationDate(new Date(dto.generated_at));
  const page = doc.addPage([PAGE.w, PAGE.h]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: hex(C.bg) });
  const c: Ctx = { doc, page, f: { reg, semi, bold }, issues: [] };

  let y = 20;
  y += header(c, dto, y) + 16;
  y += hero(c, dto, y) + GAP;
  y += weekBarsCard(c, dto, y) + GAP;
  y += categoriesCard(c, dto, y) + GAP;
  if (dto.type === "monthly") y += evolutionCard(c, dto, y) + GAP;
  y += textCard(c, "O que mais chamou atenção", dto.insight.title, dto.insight.body, dto.insight.tone, y, true, "insight") + GAP;
  y += factsCard(c, dto.future_title, dto.facts, y) + GAP;
  y += textCard(c, "Seu próximo passo", dto.action.title, dto.action.body, "neutral", y, false, "action") + 16;
  y += footer(c, dto, y, localStamp(dto.generated_at, dto.timezone)) + 20;

  // Recorta a página na altura usada (o conteúdo fica no topo da página de trabalho).
  const used = Math.ceil(y);
  page.setMediaBox(0, PAGE.h - used, PAGE.w, used);
  page.setCropBox(0, PAGE.h - used, PAGE.w, used);
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount(), issues: c.issues, sizeBytes: bytes.byteLength, heightPt: used };
}
