import { afterEach, describe, expect, it, vi } from "vitest";
import { callStructuredFunction } from "../../supabase/functions/_shared/ai-structured.ts";
import type { AiProviderConfig } from "../../supabase/functions/_shared/ai-runtime.ts";

const groq: AiProviderConfig = {
  provider: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "test-key",
  headers: { Authorization: "Bearer test-key" },
  modelOverride: "openai/gpt-oss-120b",
};

const strictTool = {
  name: "emit_test",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("structured AI provider resilience", () => {
  it("uses native Groq json_schema for strict output and retries a short 429", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStructuredFunction({
      provider: groq,
      model: "openai/gpt-oss-120b",
      system: "Return structured output.",
      user: "ok",
      tool: strictTool,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(JSON.parse(result.arguments)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "emit_test", strict: true },
    });
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
  });

  it("fails closed without hammering the provider when retry-after is too long", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { type: "rate_limit_error", message: "token window exhausted" },
    }), {
      status: 429,
      headers: { "retry-after": "30" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStructuredFunction({
      provider: groq,
      model: "openai/gpt-oss-120b",
      system: "Return structured output.",
      user: "ok",
      tool: strictTool,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error_code).toBe("structured_call_gateway_429");
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses native Groq json_schema for best-effort V2-style contracts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStructuredFunction({
      provider: groq,
      model: "openai/gpt-oss-20b",
      system: "Return the semantic contract.",
      user: "ok",
      tool: { ...strictTool, strict: false },
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.arguments)).toEqual({ ok: true });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "emit_test", strict: false },
    });
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
  });

  it("fails closed on HTTP 200 when structured output is actually absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 8, completion_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStructuredFunction({
      provider: groq,
      model: "openai/gpt-oss-20b",
      system: "Return the semantic contract.",
      user: "ok",
      tool: { ...strictTool, strict: false },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
    expect(result.error_code).toBe("structured_call_missing_structured_output");
  });
});
