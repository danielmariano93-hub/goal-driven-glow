import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const migration = read("supabase/migrations/20261002160000_split_participant_reminder_pause.sql");
const dispatcher = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
const detail = read("src/pages/DivisaoDoRoleDetalhe.tsx");

describe("Divisão do Rolê — pausa individual de cobrança", () => {
  it("persiste pausa por participante sem transformar em opt-out ou pagamento", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS reminders_paused_at");
    expect(migration).toContain("reminders_paused_by uuid");
    expect(migration).toContain("split_set_participant_reminders_paused");
    expect(migration).toContain("participant_reminders_paused");
    expect(migration).not.toContain("SET opt_out_at");
    expect(migration).not.toContain("status = 'paid'");
  });

  it("bloqueia cobranças automáticas, manuais e jobs antigos", () => {
    expect(migration).toContain("p.reminders_paused_at IS NULL");
    expect(migration).toContain("AND reminders_paused_at IS NULL");
    expect(migration).toContain("split_reminders_paused");
    expect(migration).toContain("status = 'dead'::public.msg_status");
    expect(dispatcher).toContain("reminders_paused_at");
    expect(dispatcher).toContain('suppression = "participant_reminders_paused"');
  });

  it("expõe a ação no detalhe do rolê para cada participante externo", () => {
    expect(detail).toContain("toggleParticipantReminders");
    expect(detail).toContain("Pausar cobranças");
    expect(detail).toContain("Retomar cobranças");
    expect(detail).toContain("Cobranças pausadas");
  });
});
