import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_NAVIGATION } from "../lib/navigation/appNavigationRegistry";
import {
  FEATURE_GUIDES, SETUP_ITEMS, featureStateKey, pendingAnnouncements, setupProgress, shouldShowSetupCard,
  type SetupStatus,
} from "../lib/guide/catalog";

const none: SetupStatus = { account: false, transaction: false, whatsapp: false, goal: false, category_goal: false, card: false, recurring: false, split: false };
const DAY = 86_400_000;

describe("guia do Nino — catálogo", () => {
  it("toda funcionalidade navegável tem tutorial (nova funcionalidade exige guia)", () => {
    // Exceções: o próprio guia e telas que já são o tutorial de outra.
    const exempt = new Set(["guia", "planejamento-antigo"]);
    const withGuide = new Set(FEATURE_GUIDES.map((g) => g.path));
    const missing = APP_NAVIGATION
      .filter((e) => e.navigationType === "secondary" && e.mobilePlacement === "more" && !exempt.has(e.id))
      .filter((e) => !withGuide.has(e.path))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it("todo tutorial aponta para uma rota existente e tem passos", () => {
    const paths = new Set(APP_NAVIGATION.map((e) => e.path));
    for (const g of FEATURE_GUIDES) {
      expect(paths.has(g.path), g.id).toBe(true);
      expect(g.steps.length, g.id).toBeGreaterThan(0);
    }
    for (const s of SETUP_ITEMS) expect(paths.has(s.to), s.key).toBe(true);
    expect(new Set(FEATURE_GUIDES.map((g) => g.id)).size).toBe(FEATURE_GUIDES.length);
  });

  it("progresso vem dos dados e aponta o próximo passo essencial", () => {
    expect(setupProgress(none).next?.key).toBe("account");
    const p = setupProgress({ ...none, account: true, transaction: true });
    expect(p.essentialDone).toBe(2);
    expect(p.next?.key).toBe("whatsapp");
    expect(setupProgress({ ...none, goal: false, category_goal: true }).items.find((i) => i.key === "goal")?.completed).toBe(true);
  });

  it("card de primeiros passos: some ao concluir o essencial ou dispensar", () => {
    expect(shouldShowSetupCard(none, {})).toBe(true);
    expect(shouldShowSetupCard(none, { setup: "dismissed" })).toBe(false);
    expect(shouldShowSetupCard({ ...none, account: true, transaction: true, whatsapp: true, goal: true }, {})).toBe(false);
    expect(shouldShowSetupCard(null, {})).toBe(false);
  });

  it("novidade: só para quem já tinha conta no lançamento, uma vez, dentro da janela", () => {
    const g = FEATURE_GUIDES.find((x) => x.announce)!;
    const released = Date.parse(g.announce!.releasedAt);
    const inside = released + 2 * DAY;
    expect(pendingAnnouncements({}, new Date(released - 10 * DAY).toISOString(), inside).map((x) => x.id)).toContain(g.id);
    // usuário novo (criado depois do lançamento) não recebe como novidade
    expect(pendingAnnouncements({}, new Date(released + DAY).toISOString(), inside)).toEqual([]);
    // já visto/dispensado
    expect(pendingAnnouncements({ [featureStateKey(g.id)]: "dismissed" }, new Date(released - DAY).toISOString(), inside).map((x) => x.id)).not.toContain(g.id);
    // fora da janela
    expect(pendingAnnouncements({}, new Date(released - DAY).toISOString(), released + (g.announce!.days + 1) * DAY)).toEqual([]);
    expect(pendingAnnouncements({}, null, inside)).toEqual([]);
  });

  it("migração: RLS própria, sem acesso anônimo à função", () => {
    const sql = readFileSync("supabase/migrations/20261004150000_user_guide.sql", "utf8");
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/revoke all on function public\.guide_setup_status\(\) from public, anon/);
    expect(sql).toContain("v_uid is null");
  });
});
