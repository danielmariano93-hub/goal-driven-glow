/**
 * Detecção de versão nova do app.
 *
 * O Nino é uma SPA: quem deixa o app aberto (ou instalado na tela inicial) continua com o pacote
 * antigo na memória depois de um deploy. O HTML publicado referencia o pacote de entrada com hash
 * (`/assets/index-<hash>.js`); se o hash do HTML atual difere do que está carregado, há versão nova.
 */
const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export function extractEntryScript(html: string): string | null {
  const match = ENTRY_RE.exec(html);
  return match ? match[0] : null;
}

/** Pacote de entrada carregado agora (null em dev, onde não há hash). */
export function loadedEntryScript(doc: Document = document): string | null {
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const src = script.getAttribute("src") ?? "";
    const match = ENTRY_RE.exec(src);
    if (match) return match[0];
  }
  return null;
}

export function isNewVersion(loaded: string | null, publishedHtml: string): boolean {
  if (!loaded) return false;
  const published = extractEntryScript(publishedHtml);
  return published != null && published !== loaded;
}

export async function checkForNewVersion(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const loaded = loadedEntryScript();
  if (!loaded) return false;
  try {
    const res = await fetchImpl("/", { cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) return false;
    return isNewVersion(loaded, await res.text());
  } catch {
    return false;
  }
}
