import { useEffect, useMemo, useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertTriangle, FileText, FileDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseLegacyPayload } from "@/lib/import/legacy";
import { parseCsv, type ColumnMap } from "@/lib/import/csv";
import { parseOfx } from "@/lib/import/ofx";
import { formatBRL } from "@/lib/split/math";

const LEGACY_KEY = "financial_ecosystem_v2";
const IMPORTED_FLAG = "financial_ecosystem_v2_imported_at";

type Tab = "legacy" | "csv" | "ofx";

export default function Importar() {
  const [tab, setTab] = useState<Tab>("legacy");
  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Importar dados</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Legado do navegador, extrato CSV ou OFX. Sempre com prévia.</p>
      </div>
      <div className="flex gap-2">
        {(["legacy", "csv", "ofx"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`text-xs px-3 py-1.5 rounded-full border ${tab===t?"bg-primary text-primary-foreground border-primary":"bg-card border-border text-muted-foreground"}`}>
            {t === "legacy" ? "Legado (navegador)" : t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === "legacy" && <LegacyImport />}
      {tab === "csv" && <CsvImport />}
      {tab === "ofx" && <OfxImport />}
    </div>
  );
}

function LegacyImport() {
  const raw = useMemo(() => {
    try { const s = localStorage.getItem(LEGACY_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  }, []);
  const preview = useMemo(() => raw ? parseLegacyPayload(raw) : null, [raw]);
  const [imported, setImported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  useEffect(() => { setImported(localStorage.getItem(IMPORTED_FLAG)); }, []);

  const doImport = async () => {
    if (!raw) return;
    setBusy(true);
    const payload: any = {
      lancamentos: raw.lancamentos, metas: raw.metas, aportes: raw.aportes,
      dividas: raw.dividas, investimentos: raw.investimentos, emocoes: raw.emocoes,
      contasFixas: raw.contasFixas, categoriasCustom: raw.categoriasCustom, config: raw.config,
    };
    const { data, error } = await supabase.rpc("import_legacy_batch", { p_payload: payload });
    setBusy(false);
    if (error) return toast.error("Falha: " + error.message);
    setResult(data);
    localStorage.setItem(IMPORTED_FLAG, new Date().toISOString());
    setImported(new Date().toISOString());
    toast.success("Importação concluída. Seus dados originais no navegador continuam intactos.");
  };

  if (!raw) return (
    <div className="surface-card p-8 text-center">
      <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm">Nenhum dado antigo encontrado neste navegador.</p>
    </div>
  );

  return (
    <div className="surface-card p-4 space-y-3">
      {imported && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={14} /> Última importação: {new Date(imported).toLocaleString("pt-BR")}. Reimportar é seguro (idempotente).
        </div>
      )}
      <p className="text-sm font-medium">Prévia</p>
      <ul className="grid grid-cols-2 gap-1 text-xs">
        <li>Lançamentos: <strong>{preview!.lancamentos}</strong></li>
        <li>Metas: <strong>{preview!.metas}</strong></li>
        <li>Aportes: <strong>{preview!.aportes}</strong></li>
        <li>Dívidas: <strong>{preview!.dividas}</strong></li>
        <li>Investimentos: <strong>{preview!.investimentos}</strong></li>
        <li>Emoções: <strong>{preview!.emocoes}</strong></li>
        <li>Contas fixas: <strong>{preview!.contasFixas}</strong></li>
        <li>Categorias: <strong>{preview!.categoriasCustom}</strong></li>
      </ul>
      {preview!.issues.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
          <AlertTriangle size={14} className="mt-0.5" />
          <div>{preview!.issues.length} linha(s) com problema (data ou valor). Serão puladas na importação.</div>
        </div>
      )}
      <button disabled={busy} onClick={doImport} className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {imported ? "Reimportar" : "Importar agora"}
      </button>
      {result && (
        <div className="text-xs">
          <p className="font-medium">Última execução:</p>
          <pre className="text-[10px] mt-1 bg-secondary/40 p-2 rounded overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function AccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  useEffect(() => { supabase.from("accounts").select("id,name").then(({ data }) => setAccounts(data ?? [])); }, []);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
      <option value="">Selecione a conta destino</option>
      {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function CsvImport() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>("");
  const [colMap, setColMap] = useState<ColumnMap>({ date: "data", amount: "valor", description: "descricao" });
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const parsed = useMemo(() => text ? parseCsv(text, colMap) : null, [text, colMap]);

  const readFile = (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast.error("Arquivo maior que 5MB");
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
    setFile(f);
    setResult(null);
  };

  const submit = async () => {
    if (!accountId || !parsed) return toast.error("Selecione conta e arquivo");
    const rows = parsed.rows
      .map((r, i) => ({ ...r, i }))
      .filter(r => r.errors.length === 0 && !excluded.has(r.i))
      .map(r => ({ occurred_at: r.occurred_at, amount: r.amount, description: r.description, external_id: r.external_id }));
    setBusy(true);
    const { data, error } = await supabase.rpc("import_transactions_batch" as any, { p_account_id: accountId, p_rows: rows });
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data);
    toast.success("Importação concluída");
  };

  return (
    <div className="surface-card p-4 space-y-3">
      <input type="file" accept=".csv,text/csv" onChange={e => e.target.files && readFile(e.target.files[0])} className="text-xs" />
      {parsed && (
        <>
          <p className="text-xs text-muted-foreground">Separador detectado: <code>{parsed.separator}</code></p>
          <div className="grid grid-cols-3 gap-2">
            {(["date", "amount", "description"] as const).map(k => (
              <div key={k}>
                <label className="text-[10px] text-muted-foreground uppercase">{k}</label>
                <select value={colMap[k]} onChange={e => setColMap({ ...colMap, [k]: e.target.value })} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                  {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <AccountPicker value={accountId} onChange={setAccountId} />
          <div className="max-h-64 overflow-y-auto text-xs border border-border rounded">
            <table className="w-full">
              <thead className="bg-secondary/40"><tr><th></th><th className="p-2 text-left">Data</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Descrição</th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className={r.errors.length ? "bg-destructive/10" : ""}>
                    <td className="p-1"><input type="checkbox" checked={!excluded.has(i)} onChange={e => {
                      const n = new Set(excluded); e.target.checked ? n.delete(i) : n.add(i); setExcluded(n);
                    }} /></td>
                    <td className="p-1">{r.occurred_at ?? "—"}</td>
                    <td className="p-1 text-right">{r.amount != null ? formatBRL(r.amount) : "—"}</td>
                    <td className="p-1">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={busy || !accountId} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Importar {parsed.rows.filter((r, i) => !r.errors.length && !excluded.has(i)).length} linha(s)
          </button>
          {result && <p className="text-xs">Inseridos: {result.inserted} · Ignorados por dedup: {result.skipped}</p>}
        </>
      )}
    </div>
  );
}

function OfxImport() {
  const [text, setText] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const parsed = useMemo(() => text ? parseOfx(text) : [], [text]);

  const readFile = (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast.error("Arquivo maior que 5MB");
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
    setResult(null);
  };

  const submit = async () => {
    if (!accountId) return toast.error("Selecione a conta");
    const rows = parsed
      .map((r, i) => ({ ...r, i }))
      .filter(r => r.errors.length === 0 && !excluded.has(r.i))
      .map(r => ({ occurred_at: r.occurred_at, amount: r.amount, description: r.description, external_id: r.external_id }));
    setBusy(true);
    const { data, error } = await supabase.rpc("import_transactions_batch" as any, { p_account_id: accountId, p_rows: rows });
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data);
    toast.success("OFX importado");
  };

  return (
    <div className="surface-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText size={14} /> Aceita extratos bancários no formato OFX (comum em bancos brasileiros).
      </div>
      <input type="file" accept=".ofx,text/plain" onChange={e => e.target.files && readFile(e.target.files[0])} className="text-xs" />
      {parsed.length > 0 && (
        <>
          <AccountPicker value={accountId} onChange={setAccountId} />
          <div className="max-h-64 overflow-y-auto text-xs border border-border rounded">
            <table className="w-full">
              <thead className="bg-secondary/40"><tr><th></th><th className="p-2 text-left">Data</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Descrição</th><th className="p-2">FITID</th></tr></thead>
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={i} className={r.errors.length ? "bg-destructive/10" : ""}>
                    <td className="p-1"><input type="checkbox" checked={!excluded.has(i)} onChange={e => {
                      const n = new Set(excluded); e.target.checked ? n.delete(i) : n.add(i); setExcluded(n);
                    }} /></td>
                    <td className="p-1">{r.occurred_at ?? "—"}</td>
                    <td className="p-1 text-right">{r.amount != null ? formatBRL(r.amount) : "—"}</td>
                    <td className="p-1">{r.description}</td>
                    <td className="p-1 text-[10px] text-muted-foreground">{r.fitid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={busy || !accountId} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Importar
          </button>
          {result && <p className="text-xs">Inseridos: {result.inserted} · Ignorados por FITID/dedup: {result.skipped}</p>}
        </>
      )}
    </div>
  );
}
