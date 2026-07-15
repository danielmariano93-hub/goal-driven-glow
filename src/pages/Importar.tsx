import { useEffect, useMemo, useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const LEGACY_KEY = "financial_ecosystem_v2";
const IMPORTED_FLAG = "financial_ecosystem_v2_imported_at";
const KNOWN = ["accounts", "categoriasCustom", "categories", "lancamentos", "metas", "aportes", "dividas", "investimentos", "emocoes", "contasFixas", "config"];

type Preview = Record<string, number> & { other: string[] };

function readLegacy(): any | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function summarize(data: any): Preview {
  const obj = (data as Record<string, unknown>) ?? {};
  const result: Preview = { other: [] } as any;
  for (const k of KNOWN) {
    if (Array.isArray(obj[k])) result[k] = (obj[k] as unknown[]).length;
  }
  for (const k of Object.keys(obj)) {
    if (!KNOWN.includes(k) && Array.isArray(obj[k])) result.other.push(k);
  }
  return result;
}

export default function Importar() {
  const data = useMemo(() => readLegacy(), []);
  const [imported, setImported] = useState<string | null>(null);
  useEffect(() => { setImported(localStorage.getItem(IMPORTED_FLAG)); }, []);
  const preview = data ? summarize(data) : null;
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: Record<string, number> } | null>(null);

  const doImport = async () => {
    if (!data) return;
    setImporting(true);
    const payload: Record<string, unknown> = {};
    for (const k of KNOWN) if (Array.isArray(data[k])) payload[k] = data[k];
    const { data: res, error } = await supabase.rpc("import_legacy_batch", { p_payload: payload as never });
    setImporting(false);
    if (error) { toast.error("Falha na importação: " + error.message); return; }
    const r = res as { imported: Record<string, number> };
    setResult(r);
    localStorage.setItem(IMPORTED_FLAG, new Date().toISOString());
    setImported(new Date().toISOString());
    toast.success("Importação concluída. Seus dados locais continuam intactos.");
  };

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Importar dados antigos</h1>
        <p className="text-sm text-muted-foreground">
          Se você usou uma versão anterior do NoControle.ia neste navegador, podemos migrar seus dados para a versão nova. Nada é apagado do seu navegador.
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
              Última importação: {new Date(imported).toLocaleString("pt-BR")}. Você pode reimportar — itens já importados são ignorados.
            </div>
          )}
          <div>
            <p className="font-semibold text-sm">Prévia por entidade</p>
            <ul className="mt-2 text-sm text-muted-foreground grid grid-cols-2 gap-1">
              {KNOWN.filter(k => (preview as any)?.[k] > 0).map(k => (
                <li key={k}>{k}: <strong className="text-foreground">{(preview as any)[k]}</strong></li>
              ))}
            </ul>
          </div>

          {preview && preview.other.length > 0 && (
            <div className="rounded-md bg-yellow-50 p-3 text-xs text-yellow-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div>
                <p>Outros dados encontrados que não serão importados: {preview.other.join(", ")}.</p>
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
            <div className="text-xs text-muted-foreground">
              <p>Última execução:</p>
              <ul className="ml-3 list-disc">
                {Object.entries(result.imported).map(([k, v]) => <li key={k}>{k}: {v as number} novos</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
