// Pure TypeScript PNG renderer for Supabase Edge Functions.
// Avoids native canvas packages, which are unavailable in the Edge runtime.
// The WhatsApp caption carries labels/values; the image provides the visual trend.
// deno-lint-ignore-file no-explicit-any

type ArtifactPayload = {
  kind?: string;
  data?: { series?: Array<{ name: string; value: number }>; [k: string]: any };
};

const W = 900, H = 520;
const RGBA = 4;

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
  const size = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size); let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  return concat([u32(data.length), t, data, u32(crc32(concat([t, data])))]);
}
function pixel(buf: Uint8Array, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * RGBA;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function fillRect(buf: Uint8Array, x: number, y: number, w: number, h: number, color: number[]) {
  for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) pixel(buf, xx, yy, color[0], color[1], color[2], color[3] ?? 255);
}
function line(buf: Uint8Array, x0: number, y0: number, x1: number, y1: number, color: number[], thickness = 3) {
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
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const compression = new CompressionStream("deflate");
  const writer = compression.writable.getWriter();
  await writer.write(data as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await new Response(compression.readable).arrayBuffer());
}

export async function renderArtifactPng(payload: ArtifactPayload): Promise<Uint8Array> {
  const buf = new Uint8Array(W * H * RGBA);
  fillRect(buf, 0, 0, W, H, [248, 247, 252, 255]);
  fillRect(buf, 36, 32, W - 72, H - 64, [255, 255, 255, 255]);
  const series = (payload.data?.series ?? []).filter(s => Number.isFinite(Number(s.value))).slice(0, 31);
  const chart = { x: 70, y: 105, w: W - 140, h: H - 175 };
  line(buf, chart.x, chart.y + chart.h, chart.x + chart.w, chart.y + chart.h, [210, 206, 220, 255], 2);
  line(buf, chart.x, chart.y, chart.x, chart.y + chart.h, [210, 206, 220, 255], 2);

  if (series.length) {
    const values = series.map(s => Number(s.value));
    const min = Math.min(0, ...values), max = Math.max(1, ...values);
    const span = Math.max(1, max - min);
    const point = (v: number, i: number) => ({
      x: Math.round(chart.x + (series.length === 1 ? chart.w / 2 : i * chart.w / (series.length - 1))),
      y: Math.round(chart.y + chart.h - ((v - min) / span) * (chart.h - 20)),
    });
    const isLine = /time|trend|forecast|average|line/i.test(String(payload.kind ?? "")) || series.length > 12;
    if (isLine) {
      for (let i = 1; i < series.length; i++) {
        const a = point(values[i - 1], i - 1), b = point(values[i], i);
        line(buf, a.x, a.y, b.x, b.y, [109, 59, 255, 255], 5);
      }
      for (let i = 0; i < series.length; i++) {
        const p = point(values[i], i); fillRect(buf, p.x - 5, p.y - 5, 10, 10, [109, 59, 255, 255]);
      }
    } else {
      const gap = 10;
      const bw = Math.max(12, Math.floor((chart.w - gap * (series.length + 1)) / series.length));
      series.forEach((s, i) => {
        const value = Number(s.value);
        const h = Math.max(2, Math.round(Math.abs(value) / Math.max(Math.abs(min), Math.abs(max), 1) * (chart.h - 25)));
        const x = chart.x + gap + i * (bw + gap);
        fillRect(buf, x, chart.y + chart.h - h, bw, h, value < 0 ? [255, 107, 74, 255] : [109, 59, 255, 255]);
      });
    }
  }

  const raw = new Uint8Array(H * (1 + W * RGBA));
  for (let y = 0; y < H; y++) {
    const dst = y * (1 + W * RGBA); raw[dst] = 0;
    raw.set(buf.subarray(y * W * RGBA, (y + 1) * W * RGBA), dst + 1);
  }
  const ihdr = concat([u32(W), u32(H), new Uint8Array([8, 6, 0, 0, 0])]);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([signature, chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())]);
}
