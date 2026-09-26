// Pure TypeScript PNG renderer for Supabase Edge Functions.
// Avoids native canvas packages, which are unavailable in the Edge runtime.
// The WhatsApp caption carries labels/values; the image provides the visual trend.
// deno-lint-ignore-file no-explicit-any
import { toRenderableSeries, type RenderableSeriesItem } from "./normalize.ts";

type ArtifactPayload = {
  kind?: string;
  data?: { series?: Array<{ name: string; value: number }>; [k: string]: any };
  chart?: any;
  [k: string]: any;
};

const W = 1200, H = 680;
const RGBA = 4;
const PURPLE = [109, 59, 255, 255];
const ORANGE = [255, 159, 28, 255];
const LABEL = [72, 65, 91, 255];
const MUTED_LABEL = [115, 106, 136, 255];

type VectorPoint = [number, number];
type VectorGlyph = VectorPoint[][];

// Dígitos monolineares desenhados como vetores, com antialiasing por cobertura.
// Evita tanto a fonte bitmap "de máquina" quanto dependências nativas de Canvas.
const VECTOR_GLYPHS: Record<string, VectorGlyph> = {
  "0": [[[0.25, 0], [0.72, 0], [0.92, 0.2], [0.92, 0.78], [0.72, 1], [0.25, 1], [0.08, 0.78], [0.08, 0.2], [0.25, 0]]],
  "1": [[[0.2, 0.2], [0.48, 0], [0.48, 1]], [[0.16, 1], [0.8, 1]]],
  "2": [[[0.08, 0.2], [0.25, 0.03], [0.7, 0], [0.9, 0.18], [0.85, 0.36], [0.1, 1], [0.92, 1]]],
  "3": [[[0.08, 0.08], [0.68, 0], [0.9, 0.18], [0.65, 0.48], [0.9, 0.66], [0.84, 0.9], [0.65, 1], [0.08, 0.92]]],
  "4": [[[0.76, 1], [0.76, 0]], [[0.76, 0.62], [0.06, 0.62], [0.55, 0]]],
  "5": [[[0.9, 0], [0.16, 0], [0.1, 0.46], [0.68, 0.46], [0.9, 0.62], [0.86, 0.88], [0.68, 1], [0.08, 0.92]]],
  "6": [[[0.82, 0.05], [0.58, 0], [0.22, 0.18], [0.08, 0.56], [0.13, 0.86], [0.35, 1], [0.72, 0.97], [0.9, 0.74], [0.78, 0.5], [0.18, 0.5]]],
  "7": [[[0.06, 0], [0.94, 0], [0.36, 1]]],
  "8": [
    [[0.28, 0], [0.7, 0], [0.88, 0.2], [0.72, 0.48], [0.28, 0.48], [0.1, 0.2], [0.28, 0]],
    [[0.28, 0.48], [0.72, 0.48], [0.92, 0.76], [0.72, 1], [0.28, 1], [0.08, 0.76], [0.28, 0.48]],
  ],
  "9": [[[0.82, 0.5], [0.22, 0.5], [0.08, 0.26], [0.25, 0.03], [0.68, 0], [0.88, 0.18], [0.86, 0.7], [0.62, 1], [0.28, 1]]],
  "-": [[[0.12, 0.52], [0.88, 0.52]]],
  ",": [[[0.55, 0.86], [0.48, 1.08], [0.3, 1.22]]],
  ".": [[[0.5, 0.96], [0.51, 0.97]]],
  "k": [[[0.16, 0], [0.16, 1]], [[0.85, 0.18], [0.18, 0.6], [0.86, 1]]],
};

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const encodedType = new TextEncoder().encode(type);
  return concat([u32(data.length), encodedType, data, u32(crc32(concat([encodedType, data])))]);
}
function pixel(buf: Uint8Array, x: number, y: number, color: number[]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * RGBA;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = color[3] ?? 255;
}
function fillRect(buf: Uint8Array, x: number, y: number, w: number, h: number, color: number[]) {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(H, Math.ceil(y + h)); yy++) {
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(W, Math.ceil(x + w)); xx++) {
      pixel(buf, xx, yy, color);
    }
  }
}
function blendPixel(buf: Uint8Array, x: number, y: number, color: number[], alpha: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * RGBA;
  const a = Math.min(1, alpha);
  buf[i] = Math.round(buf[i] * (1 - a) + color[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + color[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + color[2] * a);
  buf[i + 3] = 255;
}
function smoothSegment(
  buf: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number[],
  thickness: number,
) {
  const radius = thickness / 2;
  const minX = Math.floor(Math.min(x0, x1) - radius - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + radius + 1);
  const minY = Math.floor(Math.min(y0, y1) - radius - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + radius + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const projection = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
      const nearestX = x0 + projection * dx;
      const nearestY = y0 + projection * dy;
      const distance = Math.hypot(px - nearestX, py - nearestY);
      blendPixel(buf, x, y, color, Math.max(0, Math.min(1, radius + 0.75 - distance)));
    }
  }
}
function vectorTextWidth(value: string, size: number): number {
  if (!value) return 0;
  return value.length * size * 0.58 + (value.length - 1) * size * 0.12;
}
function drawVectorText(
  buf: Uint8Array,
  value: string,
  x: number,
  y: number,
  color: number[],
  size: number,
) {
  let cursor = x;
  for (const character of value) {
    const glyph = VECTOR_GLYPHS[character];
    if (glyph) {
      for (const path of glyph) {
        for (let point = 0; point < path.length - 1; point++) {
          const [fromX, fromY] = path[point];
          const [toX, toY] = path[point + 1];
          smoothSegment(
            buf,
            cursor + fromX * size * 0.58,
            y + fromY * size,
            cursor + toX * size * 0.58,
            y + toY * size,
            color,
            Math.max(1.1, size * 0.105),
          );
        }
      }
    }
    cursor += size * 0.7;
  }
}
function drawVectorTextCentered(
  buf: Uint8Array,
  value: string,
  centerX: number,
  y: number,
  color: number[],
  size: number,
) {
  drawVectorText(buf, value, centerX - vectorTextWidth(value, size) / 2, y, color, size);
}
export function barAmountLabel(value: number, includeCents = true): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return `${sign}${(absolute / 1000).toFixed(1).replace(".", ",")}k`;
  }
  return includeCents
    ? `${sign}${absolute.toFixed(2).replace(".", ",")}`
    : `${sign}${Math.round(absolute)}`;
}
const MONTH_AXIS_LABELS: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};
export function chartDayLabel(label: string): string {
  const raw = String(label ?? "").trim().toLowerCase();
  const monthly = raw.match(/^([a-z]{3})\/(\d{2})$/);
  if (monthly && MONTH_AXIS_LABELS[monthly[1]]) {
    return `${MONTH_AXIS_LABELS[monthly[1]]}-${monthly[2]}`;
  }
  return raw.split("/")[0].padStart(2, "0").slice(0, 2);
}
function line(buf: Uint8Array, x0: number, y0: number, x1: number, y1: number, color: number[], thickness = 3) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    fillRect(buf, x0 - Math.floor(thickness / 2), y0 - Math.floor(thickness / 2), thickness, thickness, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function parseColor(value: string | undefined, fallback: number[]): number[] {
  const match = String(value ?? "").match(/^#([0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    255,
  ];
}
function smoothLine(
  buf: Uint8Array,
  points: Array<{ x: number; y: number }>,
  color: number[],
  thickness = 4,
) {
  if (points.length < 2) return;
  let previous = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    // Catmull–Rom: curva suave preservando cada ponto observado.
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      line(buf, previous.x, previous.y, x, y, color, thickness);
      previous = { x, y };
    }
  }
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const compression = new CompressionStream("deflate");
  // Start consuming before writing. Edge runtimes apply backpressure to the
  // CompressionStream; waiting for write() before attaching a reader can
  // deadlock large PNG buffers until the caller's timeout fires.
  const output = new Response(compression.readable).arrayBuffer();
  const writer = compression.writable.getWriter();
  await writer.write(data as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await output);
}

export async function renderArtifactPng(payload: ArtifactPayload): Promise<Uint8Array> {
  const buf = new Uint8Array(W * H * RGBA);
  fillRect(buf, 0, 0, W, H, [246, 244, 252, 255]);
  fillRect(buf, 34, 30, W - 68, H - 60, [255, 255, 255, 255]);
  fillRect(buf, 34, 30, 10, H - 60, PURPLE);

  const norm = toRenderableSeries(payload);
  const series: RenderableSeriesItem[] = norm.series
    .map((item) => ({ ...item, values: item.values.slice(0, 31) }))
    .filter((item) => item.values.length > 0);
  const count = Math.max(0, ...series.map((item) => item.values.length));
  const allValues = series.flatMap((item) => item.values).filter(Number.isFinite);

  const chart = { x: 82, y: 76, w: W - 144, h: H - 190 };
  for (let grid = 0; grid <= 4; grid++) {
    const y = chart.y + (chart.h * grid) / 4;
    line(buf, chart.x, y, chart.x + chart.w, y, [232, 228, 242, 255], grid === 4 ? 2 : 1);
  }

  if (count > 0 && allValues.length > 0) {
    const min = Math.min(0, ...allValues);
    const max = Math.max(1, ...allValues);
    const span = Math.max(1, max - min);
    const slot = chart.w / count;
    const xAt = (index: number) => chart.x + slot * (index + 0.5);
    const yAt = (value: number) =>
      chart.y + chart.h - ((value - min) / span) * (chart.h - 34);

    const barSeries = series.filter((item) => item.renderAs === "bar");
    const groupWidth = Math.max(4, Math.min(34, slot * 0.68));
    const singleBarWidth = Math.max(3, groupWidth / Math.max(1, barSeries.length));
    const barAnnotations: Array<{ value: number; x: number; y: number }> = [];

    barSeries.forEach((item, seriesIndex) => {
      const color = parseColor(item.color, PURPLE);
      item.values.forEach((value, index) => {
        const zeroY = yAt(0);
        const valueY = yAt(value);
        const height = Math.max(2, Math.abs(zeroY - valueY));
        const x = xAt(index) - groupWidth / 2 + seriesIndex * singleBarWidth;
        fillRect(
          buf,
          x,
          Math.min(zeroY, valueY),
          singleBarWidth - 1,
          height,
          color,
        );
        barAnnotations.push({ value, x: xAt(index), y: valueY });
      });
    });

    series.filter((item) => item.renderAs === "line").forEach((item, index) => {
      const color = parseColor(item.color, index === 0 ? ORANGE : PURPLE);
      const points = item.values.map((value, pointIndex) => ({
        x: xAt(pointIndex),
        y: Math.max(chart.y, Math.min(chart.y + chart.h, yAt(value))),
      }));
      smoothLine(buf, points, color, 5);
      if (points.length <= 16) {
        for (const point of points) {
          fillRect(buf, point.x - 3, point.y - 3, 7, 7, color);
        }
      }
    });

    // Valores são desenhados por último para que a linha móvel não os cubra.
    for (const annotation of barAnnotations) {
      // Até 24 dias cabem centavos. Em meses completos, arredonda apenas o
      // rótulo visual para impedir sobreposição; o dado do artefato não muda.
      const label = barAmountLabel(annotation.value, count <= 24);
      const y = annotation.value < 0
        ? Math.min(chart.y + chart.h - 13, annotation.y + 6)
        : Math.max(chart.y + 2, annotation.y - 16);
      drawVectorTextCentered(buf, label, annotation.x, y, LABEL, 10.5);
    }

    // O eixo usa apenas o dia do mês, evitando a repetição visual de "/09".
    norm.labels.slice(0, count).forEach((label, index) => {
      const day = chartDayLabel(label);
      drawVectorTextCentered(buf, day, xAt(index), chart.y + chart.h + 16, MUTED_LABEL, 11.5);
    });
  }

  const raw = new Uint8Array(H * (1 + W * RGBA));
  for (let y = 0; y < H; y++) {
    const dst = y * (1 + W * RGBA);
    raw[dst] = 0;
    raw.set(buf.subarray(y * W * RGBA, (y + 1) * W * RGBA), dst + 1);
  }
  const ihdr = concat([u32(W), u32(H), new Uint8Array([8, 6, 0, 0, 0])]);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
