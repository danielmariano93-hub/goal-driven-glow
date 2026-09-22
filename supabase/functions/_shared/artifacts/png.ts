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

const W = 900, H = 520;
const RGBA = 4;
const PURPLE = [109, 59, 255, 255];
const ORANGE = [255, 159, 28, 255];

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

  const chart = { x: 74, y: 72, w: W - 126, h: H - 132 };
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
      chart.y + chart.h - ((value - min) / span) * (chart.h - 18);

    const barSeries = series.filter((item) => item.renderAs === "bar");
    const groupWidth = Math.max(4, Math.min(26, slot * 0.68));
    const singleBarWidth = Math.max(3, groupWidth / Math.max(1, barSeries.length));

    barSeries.forEach((item, seriesIndex) => {
      const color = parseColor(item.color, PURPLE);
      item.values.forEach((value, index) => {
        const zeroY = yAt(0);
        const valueY = yAt(value);
        const height = Math.max(2, Math.abs(zeroY - valueY));
        const x = xAt(index) - groupWidth / 2 + seriesIndex * singleBarWidth;
        fillRect(buf, x, Math.min(zeroY, valueY), singleBarWidth - 1, height, color);
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
