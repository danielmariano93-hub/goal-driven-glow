import { useMemo, useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const LEGACY_KEY = "financial_ecosystem_v2";
const IMPORTED_FLAG = "financial_ecosystem_v2_imported_at";

type Preview = { accounts: unknown[]; categories: unknown[]; other: string[] };

function readLegacy(): unknown | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function summarize(data: unknown): Preview {
  const obj = (data as Record<string, unknown>) ?? {};
  const supported = new Set(["accounts", "categories"]);
  const other: string[] = [];
  for (const k of Object.keys(obj)) if (!supported.has(k) && Array.isArray(obj[k])) other.push(k);
  return {
    accounts: Array.isArray(obj.accounts) ? (obj.accounts as unknown[]) : [],
    categories: Array.isArray(obj.categories) ? (obj.categories as unknown[]) : [],
    other,
  };
}

export default function Importar() {
  const data = useMemo(() => readLegacy(), []);
  const imported = typeof window !== "undefined" ? localStorage.getItem(IMPORTED_FLAG) : null;
  const preview = data ? summarize(data) : null;
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const doImport = async () => {
    if (!data) return;
    setImporting(true);
    const { data: res, error } = await supabase.rpc("import_legacy_batch", {
      p_payload: {
        accounts: preview?.accounts ?? [],
        categories: preview?.categories ?? [],
      } as never,
    });
    setImporting(false);
    if (error) { toast.error("Falha na importação: " + error.message); return; }
    const r = res as { imported: number; skipped: number };
    setResult(r);
    localStorage.setItem(IMPORTED_FLAG, new Date().toISOString());
    toast.success(`Importado: ${r.imported}, ignorado: ${r.skipped}. Seus dados no navegador continuam intactos.`);
  };

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Importar dados antigos</h1>
        <p className="text-sm text-muted-foreground">
          Se você usou uma versão anterior do NoControle.ia no seu navegador, podemos migrar contas e categorias para a versão nova. Nada é apagado do seu navegador.
        </p>
      </header>

      {!data ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm">Nenhum dado antigo encontrado neste navegador.</p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-6 space-y-4">
          {imported && (
            <div className="rounded-md bg-green-50 p-3 text-xs text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Importação já foi executada em {new Date(imported).toLocaleString("pt-BR")}. Você pode rodar novamente — itens já importados serão ignorados.
            </div>
          )}
          <div>
            <p className="font-semibold text-sm">Prévia</p>
            <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5">
              <li>{preview?.accounts.length ?? 0} contas</li>
              <li>{preview?.categories.length ?? 0} categorias pessoais</li>
            </ul>
          </div>

          {preview && preview.other.length > 0 && (
            <div className="rounded-md bg-yellow-50 p-3 text-xs text-yellow-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div>
                <p>Outros dados encontrados que não serão importados nesta rodada: {preview.other.join(", ")}.</p>
                <p className="mt-1">Eles continuam no seu navegador. Vamos adicionar suporte progressivamente.</p>
              </div>
            </div>
          )}

          <button
            onClick={doImport}
            disabled={importing}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {imported ? "Reimportar (idempotente)" : "Importar agora"}
          </button>

          {result && (
            <p className="text-xs text-muted-foreground">
              Última execução: {result.imported} novos, {result.skipped} já existiam.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
