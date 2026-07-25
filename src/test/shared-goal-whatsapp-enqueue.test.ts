import { describe, it, expect } from "vitest";
import { enqueueGoalInvite } from "../../supabase/functions/_shared/messaging/sharedGoalInviteEnqueue.ts";

// Small in-memory Supabase-like mock focused on outbound_messages + whatsapp_links.
function makeSb(opts: { registeredPhones?: string[]; failInsertKind?: string; duplicateOnce?: boolean } = {}) {
  const outbound: any[] = [];
  const inserted: any[] = [];
  let dupTriggered = false;

  const from = (table: string) => {
    if (table === "whatsapp_links") {
      let phone = "", status = "";
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "phone_e164") phone = val;
          if (col === "status") status = val;
          return chain;
        },
        maybeSingle: async () => {
          const hit = (opts.registeredPhones ?? []).includes(phone) && status === "active";
          return { data: hit ? { user_id: "u-registered" } : null, error: null };
        },
      };
      return chain;
    }
    if (table === "outbound_messages") {
      // Insert builder
      const state: any = { insertRow: null, selectAfterInsert: false };
      const chain: any = {
        insert: (row: any) => { state.insertRow = row; return chain; },
        select: () => { state.selectAfterInsert = true; return chain; },
        single: async () => {
          const row = state.insertRow;
          // duplicate simulation
          const isDup = outbound.some((r) => r.idempotency_key === row.idempotency_key);
          if (isDup || (opts.duplicateOnce && !dupTriggered && row.kind === opts.failInsertKind)) {
            dupTriggered = true;
            return { data: null, error: { message: "duplicate key value", code: "23505" } };
          }
          const id = `om-${outbound.length + 1}`;
          const stored = { id, ...row };
          outbound.push(stored);
          inserted.push(stored);
          return { data: { id }, error: null };
        },
        // fallback for existing lookup on duplicate
        eq: (_c: string, v: string) => {
          state._lookupKey = v;
          return chain;
        },
        maybeSingle: async () => {
          const existing = outbound.find((r) => r.idempotency_key === state._lookupKey);
          return { data: existing ? { id: existing.id } : null, error: null };
        },
      };
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  };

  return { sb: { from }, outbound, inserted };
}

const ENV = { APP_PUBLIC_URL: "https://app.meunino.com.br" };
const PERSONA = {} as any;
const NOW = new Date("2026-08-01T12:00:00Z");

const INPUT = {
  goal_id: "g-42",
  owner_user_id: "owner-1",
  owner_name: "Ana",
  title: "Viagem",
  target_amount: 3000,
  phone_e164: "+5511988887777",
  participant_name: "Bruno",
};

describe("enqueueGoalInvite", () => {
  it("enfileira convite imediato + followup 72h, com idempotency keys estáveis", async () => {
    const { sb, outbound } = makeSb();
    const r = await enqueueGoalInvite({ sb, env: ENV, persona: PERSONA, now: NOW }, INPUT);

    expect(r.immediate_id).toBeTruthy();
    expect(r.followup_id).toBeTruthy();
    expect(outbound).toHaveLength(2);

    const immediate = outbound.find((o) => o.kind === "goal_invite");
    const followup = outbound.find((o) => o.kind === "goal_invite_followup");
    expect(immediate.idempotency_key).toBe("goal_invite:g-42:+5511988887777");
    expect(followup.idempotency_key).toBe("goal_invite_followup:g-42:+5511988887777");
    expect(immediate.status).toBe("queued");
    expect(followup.status).toBe("queued");
    expect(immediate.channel).toBe("whatsapp");
    expect(immediate.context_type).toBe("shared_goal");
    expect(immediate.context_id).toBe("g-42");

    // Followup ~72h depois
    const diffH = (new Date(followup.next_attempt_at).getTime() - NOW.getTime()) / 3600_000;
    expect(diffH).toBeCloseTo(72, 3);

    // Imediato = agora
    expect(new Date(immediate.next_attempt_at).getTime()).toBe(NOW.getTime());
  });

  it("cadastrado recebe deep link direto da meta (/app/metas-conjuntas/:id)", async () => {
    const { sb, outbound } = makeSb({ registeredPhones: ["+5511988887777"] });
    const r = await enqueueGoalInvite({ sb, env: ENV, persona: PERSONA, now: NOW }, INPUT);
    expect(r.registered).toBe(true);
    const immediate = outbound.find((o) => o.kind === "goal_invite");
    expect(immediate.body).toContain("https://app.meunino.com.br/app/metas-conjuntas/g-42");
    expect(immediate.body).not.toContain("/signup");
  });

  it("convidado (não cadastrado) recebe signup com next para a meta", async () => {
    const { sb, outbound } = makeSb({ registeredPhones: [] });
    const r = await enqueueGoalInvite({ sb, env: ENV, persona: PERSONA, now: NOW }, INPUT);
    expect(r.registered).toBe(false);
    const immediate = outbound.find((o) => o.kind === "goal_invite");
    expect(immediate.body).toContain("/signup?");
    expect(immediate.body).toContain("next=%2Fapp%2Fmetas-conjuntas%2Fg-42");
    expect(immediate.body).toContain("ref=wa_goal");
  });

  it("idempotency: repetir enqueue não duplica linhas", async () => {
    const { sb, outbound } = makeSb();
    await enqueueGoalInvite({ sb, env: ENV, persona: PERSONA, now: NOW }, INPUT);
    const r2 = await enqueueGoalInvite({ sb, env: ENV, persona: PERSONA, now: NOW }, INPUT);
    expect(outbound).toHaveLength(2); // ainda 2 apenas
    expect(r2.immediate_id).toBeTruthy();
    expect(r2.followup_id).toBeTruthy();
  });

  it("phone ausente: skip sem erro", async () => {
    const { sb, outbound } = makeSb();
    const r = await enqueueGoalInvite(
      { sb, env: ENV, persona: PERSONA, now: NOW },
      { ...INPUT, phone_e164: "" },
    );
    expect(r.skipped).toBe("no_phone");
    expect(outbound).toHaveLength(0);
  });
});
