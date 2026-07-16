// SSRF guard for outbound admin-configurable URLs.
// Reject non-https, private/loopback/link-local IPs and localhost hostnames.

const PRIVATE_V4 = [
  [10, 8],    // 10.0.0.0/8
  [127, 8],   // loopback
  [169, 16, 254],   // link-local 169.254/16
  [192, 16, 168],   // 192.168/16
  [0, 8],
];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lc = ip.toLowerCase();
  if (lc === "::1" || lc === "::") return true;
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // fc00::/7 unique local
  if (lc.startsWith("fe8") || lc.startsWith("fe9") || lc.startsWith("fea") || lc.startsWith("feb")) return true; // link-local
  return false;
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "broadcasthost"]);

export type SsrfCode = "invalid_scheme" | "invalid_url" | "blocked_host" | "ok";

export function assertPublicHttpsUrl(raw: string): { ok: boolean; code: SsrfCode } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, code: "invalid_url" }; }
  if (u.protocol !== "https:") return { ok: false, code: "invalid_scheme" };
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, code: "invalid_url" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, code: "blocked_host" };
  if (host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, code: "blocked_host" };
  if (IPV4_RE.test(host)) {
    if (isPrivateV4(host)) return { ok: false, code: "blocked_host" };
  } else if (host.startsWith("[") && host.endsWith("]") && IPV6_RE.test(host.slice(1, -1))) {
    if (isPrivateV6(host.slice(1, -1))) return { ok: false, code: "blocked_host" };
  } else if (host.includes(":") && IPV6_RE.test(host)) {
    if (isPrivateV6(host)) return { ok: false, code: "blocked_host" };
  }
  return { ok: true, code: "ok" };
}
