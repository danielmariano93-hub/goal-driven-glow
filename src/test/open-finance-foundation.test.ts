import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { previewBatch } from "../../supabase/functions/_shared/import/stage";
import { adaptPluggyTransactions } from "../../supabase/functions/_shared/openfinance/pluggyAdapter";

const read = (p: string) => readFileSync(p, "utf8");

describe("Open Finance — fundação", () => {
  const fn = read("supabase/functions/openfinance-sync/index.ts");
  const sql = read("supabase/migrations/20261007100000_open_finance_foundation.sql");

  it("exige JWT real e acesso beta antes de qualquer coisa", () => {
    expect(fn).toContain("auth.getUser(");
    expect(fn).not.toContain("getClaims(");
    expect(fn).toContain('rpc("open_finance_enabled")');
    expect(fn.indexOf("open_finance_enabled")).toBeLessThan(fn.indexOf("pluggyAuth()"));
  });

  it("nunca cria lançamento: só prévia ou estágio de importação para revisão", () => {
    expect(fn).not.toMatch(/from\("transactions"\)/);
    expect(fn).not.toContain("confirmBatch");
    expect(fn).not.toContain("confirm_document_import");
    expect(fn).toContain('source: "open_finance"');
    expect(fn).toContain("raw_text: null"); // nada do banco guardado como texto bruto
  });

  it("não registra dados bancários em log", () => {
    expect(fn).not.toMatch(/console\.(log|error|warn)/);
  });

  it("banco: RLS própria, escrita só por RPC, anon sem acesso", () => {
    for (const t of ["open_finance_access", "bank_connections", "bank_account_links", "bank_sync_runs"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
    expect(sql).toContain("grant select on public.open_finance_access");
    expect(sql).not.toMatch(/grant (insert|update|delete)/i);
    expect(sql).toMatch(/revoke all on function public\.bank_connection_save\(text, text\) from public, anon/);
    expect(sql).toContain("open_finance_not_enabled");
    // vínculo só com conta/cartão do próprio usuário
    expect(sql).toContain("user_id = v_uid");
  });

  it("a prévia não escreve nada (cliente que falha em qualquer gravação)", async () => {
    const writes: string[] = [];
    const chain: any = new Proxy({}, {
      get: (_t, prop: string) => {
        if (["insert", "update", "upsert", "delete", "rpc"].includes(prop)) {
          return () => { writes.push(prop); return chain; };
        }
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        return () => chain;
      },
    });
    const sb = { from: () => chain, rpc: () => chain };
    const { items } = adaptPluggyTransactions([
      { id: "1", description: "Mercado", amount: -10, date: "2026-10-05T03:00:00Z", type: "DEBIT", status: "POSTED" },
    ], { accountType: "BANK" });
    const r = await previewBatch(sb as never, { user_id: "u", items });
    expect(r.counters.total).toBe(1);
    expect(writes).toEqual([]);
  });
});

describe("Open Finance — conexão pelo widget", () => {
  const fn = read("supabase/functions/openfinance-sync/index.ts");
  const client = read("supabase/functions/_shared/openfinance/pluggyClient.ts");
  const card = read("src/components/openfinance/OpenFinanceCard.tsx");

  it("o token do widget é gerado no servidor, depois do acesso beta, e amarrado ao usuário", () => {
    expect(client).toContain('"/connect_token"');
    expect(client).toContain("clientUserId");
    expect(fn).toContain('action === "connect_token"');
    expect(fn.indexOf('rpc("open_finance_enabled")')).toBeLessThan(fn.indexOf('action === "connect_token"'));
    expect(fn).toContain("clientUserId: userId");
  });

  it("o segredo do Pluggy nunca vai para o navegador; só o token curto", () => {
    expect(card).not.toMatch(/PLUGGY_CLIENT_SECRET|clientSecret/);
    expect(read("src/lib/openfinance/useOpenFinance.ts")).not.toMatch(/PLUGGY_CLIENT_SECRET|clientSecret/);
  });

  it("o widget é carregado sob demanda e o itemId vem do retorno dele", () => {
    expect(card).toContain('import("react-pluggy-connect")');
    expect(card).toContain("onSuccess");
    expect(card).toContain("item.id");
    expect(card).toContain("includeSandbox={false}");
  });
});

describe("autenticação das Edge Functions de usuário", () => {
  it("nenhuma função usa auth.getClaims (não existe no supabase-js 2.45.4 e derruba com 500)", () => {
    for (const f of ["openfinance-sync", "user-data-export"]) {
      expect(read(`supabase/functions/${f}/index.ts`), f).not.toContain("getClaims(");
    }
  });
});

describe("openfinance-sync — todo símbolo usado do cliente Pluggy está importado", () => {
  it("evita ReferenceError em produção (a função não é verificada por tipo no CI)", () => {
    const fn = read("supabase/functions/openfinance-sync/index.ts");
    const client = read("supabase/functions/_shared/openfinance/pluggyClient.ts");
    const exported = [...client.matchAll(/export (?:async )?(?:function|class) (\w+)/g)].map((m) => m[1]);
    const importBlock = /import \{([^}]*)\} from "\.\.\/_shared\/openfinance\/pluggyClient\.ts"/.exec(fn)?.[1] ?? "";
    const imported = new Set(importBlock.split(",").map((s) => s.trim()).filter(Boolean));
    const body = fn.replace(/import \{[^}]*\} from "[^"]+";/g, "");
    for (const name of exported) {
      if (new RegExp(`\\b${name}\\(`).test(body) || new RegExp(`instanceof ${name}\\b`).test(body)) {
        expect(imported.has(name), name).toBe(true);
      }
    }
  });
});

describe("Open Finance — uso pessoal gratuito (MeuPluggy)", () => {
  it("o widget fica restrito ao conector MeuPluggy (id 200)", () => {
    const card = read("src/components/openfinance/OpenFinanceCard.tsx");
    expect(card).toContain("MEU_PLUGGY_CONNECTOR_ID = 200");
    expect(card).toContain("connectorIds={[MEU_PLUGGY_CONNECTOR_ID]}");
    expect(card).toContain("selectedConnectorId={MEU_PLUGGY_CONNECTOR_ID}");
  });
  it("a ficha do item é opcional no discover (não existe para Meu Pluggy)", () => {
    expect(read("supabase/functions/openfinance-sync/index.ts")).toMatch(/getItem\(apiKey[\s\S]*?\)\.catch\(/);
  });
});

describe("Open Finance — diagnóstico de erro do Pluggy", () => {
  it("o status e a mensagem técnica do Pluggy viram parte do erro e do registro da execução", () => {
    const client = read("supabase/functions/_shared/openfinance/pluggyClient.ts");
    const fn = read("supabase/functions/openfinance-sync/index.ts");
    expect(client).toContain("upstreamDetail");
    expect(client).toMatch(/\.slice\(0, 160\)/);
    expect(fn).toContain("technical");
    expect(fn).toMatch(/error: technical \? `\$\{code\} \(\$\{technical\}\)` : code/);
  });
});

import { aggregateBankRows, aggregateNinoRows } from "../../supabase/functions/_shared/openfinance/previewAnalysis";
describe("Open Finance — resumo agregado da prévia", () => {
  it("agrega por mês/resultado/natureza e nunca carrega descrição", () => {
    const bank = aggregateBankRows([
      { verdict: "new", movement_kind: "transaction", type: "expense", amount: 10, date: "2026-09-02" },
      { verdict: "new", movement_kind: "transaction", type: "expense", amount: 5.5, date: "2026-09-20" },
      { verdict: "probable_duplicate", movement_kind: "transaction", type: "expense", amount: 7, date: "2026-10-01" },
    ]);
    expect(bank).toEqual([
      { month: "2026-09", verdict: "new", kind: "transaction", type: "expense", n: 2, total: 15.5 },
      { month: "2026-10", verdict: "probable_duplicate", kind: "transaction", type: "expense", n: 1, total: 7 },
    ]);
    expect(JSON.stringify(bank)).not.toMatch(/description/);
    const nino = aggregateNinoRows([{ occurred_at: "2026-09-03", origin: "agent", movement_kind: null, type: "expense", amount: 12 }]);
    expect(nino[0]).toMatchObject({ month: "2026-09", origin: "agent", kind: "transaction", n: 1, total: 12 });
  });
});
