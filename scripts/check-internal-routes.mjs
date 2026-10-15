// Confere que todo caminho interno citado no código (/app/..., /admin/...) existe em src/App.tsx.
// Uso: node scripts/check-internal-routes.mjs  (sai com código 1 se houver rota inexistente)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().replace(/\/?$/, "/");

export function registeredRoutes(appSource) {
  const routes = new Set();
  const stack = [];
  // Rotas aninhadas: path relativo dentro de /app ou /admin.
  const prefixFor = (line) => (line.includes('path="/app"') ? "/app" : line.includes('path="/admin"') ? "/admin" : null);
  let current = "";
  for (const line of appSource.split("\n")) {
    const pref = prefixFor(line);
    if (pref) { current = pref; routes.add(pref); continue; }
    const m = line.match(/<Route\s+path="([^"]+)"/);
    if (!m) continue;
    const p = m[1];
    if (p === "*") continue;
    if (p.startsWith("/")) { routes.add(p); current = ""; } else routes.add(`${current}/${p}`);
  }
  return [...routes];
}

const toRegex = (route) => new RegExp("^" + route.replace(/:[A-Za-z]+/g, "[^/]+").replace(/\./g, "\\.") + "/?$");

export function isKnownRoute(path, routes) {
  return routes.some((r) => toRegex(r).test(path));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) yield p;
  }
}

export function findBrokenRoutes() {
  const routes = registeredRoutes(readFileSync(join(root, "src/App.tsx"), "utf8"));
  const broken = [];
  // Aspas simples/duplas: sem aspas no meio; crase: pode ter ${...}.
  const res = [
    /"(\/(?:app|admin)(?:\/[^"\s]*)?)"/g,
    /'(\/(?:app|admin)(?:\/[^'\s]*)?)'/g,
    /`(\/(?:app|admin)(?:\/[^`]*)?)`/g,
  ];
  for (const base of ["src", "supabase/functions"]) {
    for (const file of walk(join(root, base))) {
      // App.tsx define as rotas; resolveRoute.ts guarda de propósito os apelidos de caminhos antigos.
      if (file.endsWith("src/App.tsx") || file.endsWith("src/lib/navigation/resolveRoute.ts")) continue;
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        for (const re of res) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line))) {
          let path = m[1].split(/[?#]/)[0];
          path = path.replace(/\$\{[^}]*\}/g, ":param").replace(/[+'"].*$/, "");
          if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
          if (path === "/app" || path === "/admin") continue;
          if (!isKnownRoute(path, routes)) broken.push({ file: file.replace(root, ""), line: i + 1, path: m[1] });
        }
        }
      });
    }
  }
  return { routes, broken };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { broken } = findBrokenRoutes();
  for (const b of broken) console.log(`${b.file}:${b.line}  ${b.path}`);
  console.log(broken.length ? `\n${broken.length} caminho(s) sem rota` : "ok: todos os caminhos internos existem");
  process.exit(broken.length ? 1 : 0);
}
