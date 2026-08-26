// Contrato de navegação (`app_navigation.v1`): nenhuma rota de `/app` pode
// ficar órfã por esquecimento, e todo item de menu precisa apontar para rota
// declarada em `App.tsx`. Este teste é a rede que faltava quando as Metas por
// Categoria perderam o nome sem ninguém perceber.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_NAVIGATION,
  MOBILE_TABS,
  activeMobileTabId,
  desktopGroups,
  entryById,
  moreGroups,
  resolveActiveEntry,
} from "@/lib/navigation/appNavigationRegistry";

/** Rotas reais declaradas dentro do bloco `/app` de App.tsx. */
function appRoutes(): string[] {
  const src = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = src.indexOf('path="/app"');
  const adminAt = src.indexOf('path="/admin"');
  const block = src.slice(start, adminAt > start ? adminAt : undefined);
  const paths = new Set<string>(["/app"]);
  for (const match of block.matchAll(/<Route path="([^"]+)"/g)) {
    const raw = match[1];
    if (raw.startsWith("/")) continue; // rotas de outro escopo
    paths.add(`/app/${raw}`);
  }
  return [...paths];
}

const registryPaths = new Set(APP_NAVIGATION.map((entry) => entry.path));

describe("contrato de navegação do produto", () => {
  it("toda rota de /app existe no registry", () => {
    const missing = appRoutes().filter((path) => !registryPaths.has(path));
    expect(missing).toEqual([]);
  });

  it("todo item do registry aponta para uma rota declarada", () => {
    const declared = new Set(appRoutes());
    const orphans = APP_NAVIGATION.map((e) => e.path).filter((path) => !declared.has(path));
    expect(orphans).toEqual([]);
  });

  it("não existe id nem path duplicado", () => {
    expect(new Set(APP_NAVIGATION.map((e) => e.id)).size).toBe(APP_NAVIGATION.length);
    expect(new Set(APP_NAVIGATION.map((e) => e.path)).size).toBe(APP_NAVIGATION.length);
  });

  it("toda rota primary/secondary tem ponto de entrada em mobile ou desktop", () => {
    const withoutEntry = APP_NAVIGATION.filter(
      (e) => (e.navigationType === "primary" || e.navigationType === "secondary")
        && e.mobilePlacement === "none" && e.desktopPlacement === "none",
    );
    expect(withoutEntry.map((e) => e.id)).toEqual([]);
  });

  it("toda rota de detalhe, deep link ou interna tem pai válido", () => {
    for (const entry of APP_NAVIGATION) {
      if (["detail", "deep_link", "internal", "legacy_redirect"].includes(entry.navigationType)) {
        expect(entry.parentId, entry.id).toBeTruthy();
        expect(entryById(entry.parentId!), entry.id).toBeTruthy();
      }
    }
  });

  it("todo activePath aponta para rota ou prefixo válido", () => {
    const declared = appRoutes();
    for (const entry of APP_NAVIGATION) {
      for (const prefix of entry.activePaths ?? []) {
        expect(declared.some((path) => path === prefix || path.startsWith(prefix + "/")), prefix).toBe(true);
      }
    }
  });

  it("item de menu do Mais e do sidebar sempre tem rótulo e ícone", () => {
    for (const group of [...moreGroups(), ...desktopGroups()]) {
      for (const item of group.items) {
        expect(item.label.length, item.id).toBeGreaterThan(1);
        expect(item.icon, item.id).toBeTruthy();
      }
    }
  });

  it("toda funcionalidade do Mais tem acesso coerente no desktop", () => {
    const sidebarIds = new Set(desktopGroups().flatMap((g) => g.items.map((i) => i.id)));
    const onlyMobile = moreGroups()
      .flatMap((g) => g.items)
      .filter((item) => !sidebarIds.has(item.id));
    expect(onlyMobile.map((i) => i.id)).toEqual([]);
  });

  it("active state do Mais cobre TODAS as rotas secundárias (sem lista manual)", () => {
    for (const entry of APP_NAVIGATION.filter((e) => e.mobilePlacement === "more")) {
      expect(activeMobileTabId(entry.path), entry.path).toBe("mais");
    }
    expect(activeMobileTabId("/app")).toBe("home");
    expect(activeMobileTabId("/app/lancamentos/abc")).toBe("lancamentos");
    expect(activeMobileTabId("/app/metas/categoria/xyz")).toBe("metas");
    expect(activeMobileTabId("/app/relatorios-inteligentes")).toBe("mais");
  });

  it("as abas do mobile são exatamente as quatro esperadas", () => {
    expect(MOBILE_TABS.map((t) => t.id)).toEqual(["home", "lancamentos", "metas", "mais"]);
  });

  it("deep link e rota interna continuam funcionando fora do menu", () => {
    const deep = resolveActiveEntry("/app/alertas/algum-dedup");
    expect(deep?.id).toBe("nino");
    expect(resolveActiveEntry("/app/nino-contexto")?.id).toBe("nino");
    expect(resolveActiveEntry("/app/whatsapp")?.id).toBe("perfil");
  });
});
