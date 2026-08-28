import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { audioFailureReply } from "../../supabase/functions/_shared/messaging/wahaMedia.ts";
import {
  base64ToBytes,
  bytesToBase64,
  drainPendingAudio,
  shouldDrainPendingAudio,
  type PendingAudioRow,
} from "../../supabase/functions/_shared/messaging/pendingAudio.ts";

/**
 * Cliente mínimo com o formato encadeado usado pelos módulos edge.
 * Registra as escritas para verificarmos o comportamento observável.
 */
function makeClient(opts: { rows: PendingAudioRow[] }) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const table = (name: string) => {
    const api: any = {
      _filters: {} as Record<string, unknown>,
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.head) return Promise.resolve({ count: opts.rows.length, data: null });
        return api;
      },
      eq: (col: string, val: unknown) => { api._filters[col] = val; return api; },
      order: () => api,
      limit: () => Promise.resolve({ data: opts.rows }),
      maybeSingle: () => Promise.resolve({ data: { id: api._filters.id ?? "row" } }),
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table: name, ...payload });
        return Promise.resolve({ error: null });
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table: name, ...payload });
        const chain: any = {
          eq: () => chain,
          select: () => chain,
          maybeSingle: () => Promise.resolve({ data: { id: "row" } }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    };
    return api;
  };
  return { from: table, updates, inserts } as any;
}

const row = (over: Partial<PendingAudioRow> = {}): PendingAudioRow => ({
  id: "aud-1",
  user_id: "user-1",
  conversation_id: "conv-1",
  inbound_message_id: "in-1",
  to_phone: "5511999999999",
  provider_message_id: "wamid-1",
  mime_type: "audio/ogg",
  audio_base64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
  attempts: 0,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  ...over,
});

describe("pending_audio.v1 — áudio nunca é perdido por bloqueio de IA", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = (globalThis as any).Deno;

  beforeEach(() => {
    (globalThis as any).Deno = { env: { get: () => "test-key" } };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).Deno = originalEnv;
    vi.restoreAllMocks();
  });

  it("base64 preserva os bytes do áudio", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("mensagem de bloqueio diz que o áudio foi recebido e nada foi registrado", () => {
    const reply = audioFailureReply("ai_blocked", "Ana");
    expect(reply).toMatch(/recebi seu áudio/i);
    expect(reply).toMatch(/nada foi registrado/i);
    expect(reply).not.toMatch(/não consegui entender/i);
    // Nunca expõe motivo técnico ao usuário.
    expect(reply).not.toMatch(/403|402|gateway|crédit/i);
  });

  it("não drena quando não há áudio pendente", async () => {
    const sb = makeClient({ rows: [] });
    expect(await shouldDrainPendingAudio(sb)).toBe(false);
  });

  it("drena quando existe pendência", async () => {
    const sb = makeClient({ rows: [row()] });
    expect(await shouldDrainPendingAudio(sb)).toBe(true);
  });

  it("IA ainda bloqueada: devolve para a fila, sem mensagem falsa e sem entrega", async () => {
    globalThis.fetch = vi.fn(async () => new Response("blocked", { status: 403 })) as any;
    const sb = makeClient({ rows: [row()] });
    const deliver = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const out = await drainPendingAudio(sb, { deliver, notify });
    expect(out.blocked).toBe(true);
    expect(out.delivered).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sb.updates.some((u: any) => u.status === "pending" && u.last_error === "ai_blocked")).toBe(true);
  });

  it("IA liberada: transcreve e entrega o texto ao pipeline textual", async () => {
    const sse = [
      'data: {"type":"transcript.text.delta","delta":"gastei "}',
      'data: {"type":"transcript.text.done","text":"gastei 32 no mercado"}',
      "",
    ].join("\n");
    globalThis.fetch = vi.fn(async () => new Response(sse, { status: 200 })) as any;
    const sb = makeClient({ rows: [row()] });
    const deliver = vi.fn(async () => {});
    const out = await drainPendingAudio(sb, { deliver, notify: async () => {} });
    expect(out.delivered).toBe(1);
    expect(out.blocked).toBe(false);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: "aud-1" }), "gastei 32 no mercado");
    // Bytes são descartados depois do sucesso.
    expect(sb.updates.some((u: any) => u.status === "done" && u.audio_base64 === "")).toBe(true);
  });

  it("áudio vencido: avisa com honestidade e não cria lançamento", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("nunca deveria chamar a IA");
    }) as any;
    const sb = makeClient({ rows: [row({ expires_at: new Date(Date.now() - 1000).toISOString() })] });
    const deliver = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const out = await drainPendingAudio(sb, { deliver, notify });
    expect(out.expired).toBe(1);
    expect(deliver).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String((notify.mock.calls[0] as any)[1])).toMatch(/grava de novo|texto/i);
  });

  it("falha real de transcrição não vira silêncio nem entrega", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const sb = makeClient({ rows: [row()] });
    const deliver = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const out = await drainPendingAudio(sb, { deliver, notify });
    expect(out.delivered).toBe(0);
    expect(out.blocked).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("tentativas esgotadas encerram a linha sem loop", async () => {
    const sb = makeClient({ rows: [row({ attempts: 6 })] });
    const notify = vi.fn(async () => {});
    const out = await drainPendingAudio(sb, { deliver: async () => {}, notify });
    expect(out.delivered).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sb.updates.some((u: any) => u.last_error === "max_attempts")).toBe(true);
  });
});
