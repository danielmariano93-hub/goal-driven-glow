import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccounts } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import {
  useOpenFinanceActions, useOpenFinanceEnabled, useOpenFinanceStatus, type BankConnection, type BankLink, type SyncResult,
} from "@/lib/openfinance/useOpenFinance";

// O widget só é baixado quando a pessoa toca em "Conectar banco".
const PluggyConnect = lazy(() => import("react-pluggy-connect").then((m) => ({ default: m.PluggyConnect })));

/** Uso pessoal gratuito: só o conector MeuPluggy (id 200). Contas de teste não conectam bancos diretos. */
const MEU_PLUGGY_CONNECTOR_ID = 200;

const VERDICT_LABEL: Record<string, string> = {
  new: "novo", repeated_legitimate: "repetido legítimo", exact_duplicate: "duplicado exato", probable_duplicate: "possível duplicado",
};

/** Beta fechado: não renderiza nada para quem não foi liberado. */
export function OpenFinanceCard() {
  const enabled = useOpenFinanceEnabled();
  if (!enabled.data) return null;
  return <OpenFinanceBody />;
}

function OpenFinanceBody() {
  const status = useOpenFinanceStatus(true);
  const act = useOpenFinanceActions();
  const accounts = useAccounts();
  const cards = useCreditCards();
  const [itemId, setItemId] = useState("");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);

  const startConnect = () => {
    setTrail([]);
    setConnectError(null);
    act.connectToken.mutate(undefined, { onSuccess: setConnectToken, onError: (e) => fail(e) });
  };
  const onConnected = (id: string) => {
    setConnectToken(null);
    act.save.mutate({ itemId: id, label: "" }, {
      onSuccess: () => toast.success("Banco conectado. Agora toque em “Ler contas do banco”."),
      onError: (e) => fail(e),
    });
  };

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo deu errado.");
  const connections = (status.data?.connections ?? []).filter((c) => c.status !== "paused");

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4" aria-label="Open Finance">
      <div className="flex items-center gap-2">
        <Landmark className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold">Open Finance (beta)</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Lê seus bancos pelo Pluggy, só leitura. Nada vira lançamento sozinho: tudo passa por uma revisão antes.
      </p>

      {status.isLoading ? <Loader2 className="mt-3 h-4 w-4 animate-spin" /> : null}
      {status.data && !status.data.configured ? (
        <p className="mt-3 rounded-xl bg-muted p-3 text-xs">
          Aguardando as credenciais do Pluggy neste ambiente.
          {status.data.missing_secrets?.length ? ` Faltam em Edge Functions → Secrets: ${status.data.missing_secrets.join(", ")}.` : ""}
        </p>
      ) : null}

      {connections.map((c) => (
        <ConnectionBlock
          key={c.id} connection={c}
          links={(status.data?.links ?? []).filter((l) => l.connection_id === c.id)}
          accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
          cards={(cards.data ?? []).map((k) => ({ id: k.id, name: k.name }))}
          configured={!!status.data?.configured}
          act={act} onResult={setResult} fail={fail}
        />
      ))}

      <ol className="mt-3 list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
        <li>Conecte seus bancos em <span className="font-medium">meu.pluggy.ai</span> (gratuito).</li>
        <li>No painel do Pluggy, ative o conector <span className="font-medium">MeuPluggy</span>.</li>
        <li>Toque em “Conectar banco” e entre com o seu cadastro do Meu Pluggy.</li>
      </ol>
      <div className="mt-3">
        <button
          disabled={!status.data?.configured || act.connectToken.isPending}
          onClick={startConnect}
          className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {act.connectToken.isPending ? "Abrindo…" : "Conectar banco"}
        </button>
        {!status.data?.configured ? <p className="mt-1 text-[11px] text-muted-foreground">Disponível assim que as credenciais do Pluggy forem configuradas.</p> : null}
      </div>
      {connectToken ? (
        <Suspense fallback={null}>
          <PluggyConnect
            connectToken={connectToken}
            includeSandbox={false}
            connectorIds={[MEU_PLUGGY_CONNECTOR_ID]}
            selectedConnectorId={MEU_PLUGGY_CONNECTOR_ID}
            onSuccess={({ item }: { item: { id: string } }) => onConnected(item.id)}
            onEvent={(e) => setTrail((t) => [...t.slice(-9), describeEvent(e as unknown as Record<string, unknown>)])}
            onError={(err) => {
              // Não fecha o widget: o Pluggy mostra a própria mensagem e permite tentar de novo.
              setConnectError(describeError(err as unknown as Record<string, unknown>));
              toast.error("O Pluggy não conseguiu conectar. Veja os detalhes abaixo.");
            }}
            onClose={() => setConnectToken(null)}
          />
        </Suspense>
      ) : null}

      {connectError ? (
        <div className="mt-3 rounded-xl bg-destructive/5 p-3 text-[11px]" role="alert">
          <p className="font-semibold text-destructive">Falha ao conectar (detalhes técnicos)</p>
          <p className="mt-1 break-words">{connectError}</p>
          {trail.length > 0 ? <p className="mt-1 break-words text-muted-foreground">Etapas: {trail.join(" → ")}</p> : null}
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">Já tenho o ID da conexão</summary>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.save.mutate({ itemId, label }, { onSuccess: () => { setItemId(""); setLabel(""); toast.success("Conexão cadastrada."); }, onError: fail });
        }}
      >
                <input className="w-full rounded-lg border bg-background px-3 py-2 text-xs" placeholder="ID da conexão (itemId do Pluggy)" value={itemId} onChange={(e) => setItemId(e.target.value)} />
        <input className="w-full rounded-lg border bg-background px-3 py-2 text-xs" placeholder="Apelido (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        <button disabled={!itemId.trim() || act.save.isPending} className="rounded-full border px-4 py-2 text-xs font-medium disabled:opacity-50">Salvar conexão</button>
      </form>
      </details>

      {result ? <ResultView result={result} /> : null}
    </section>
  );
}

function ConnectionBlock(props: {
  connection: BankConnection; links: BankLink[];
  accounts: Array<{ id: string; name: string }>; cards: Array<{ id: string; name: string }>;
  configured: boolean; act: ReturnType<typeof useOpenFinanceActions>;
  onResult: (r: SyncResult) => void; fail: (e: unknown) => void;
}) {
  const { connection: c, links, accounts, cards, configured, act, onResult, fail } = props;
  const mapped = links.some((l) => l.account_id || l.credit_card_id);
  const run = (mode: "preview" | "stage") =>
    act.run.mutate({ connectionId: c.id, mode, days: 90 }, {
      onSuccess: (r) => { onResult(r); if (mode === "stage") toast.success("Enviado para revisão no Assessor."); },
      onError: fail,
    });
  const busy = act.run.isPending || act.discover.isPending;

  return (
    <div className="mt-4 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{c.label || "Conexão Pluggy"}</p>
          <p className="text-[11px] text-muted-foreground">
            {c.last_synced_at ? `Última leitura: ${new Date(c.last_synced_at).toLocaleString("pt-BR")}` : "Ainda não sincronizada"}
            {c.last_error ? ` · erro: ${c.last_error}` : ""}
          </p>
        </div>
        <button className="text-[11px] text-muted-foreground underline" onClick={() => { if (confirm("Desconectar esta conexão?")) act.remove.mutate(c.id, { onError: fail }); }}>Desconectar</button>
      </div>

      <div className="mt-3 space-y-2">
        {links.map((l) => (
          <label key={l.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">{l.external_name ?? l.external_account_id} <span className="text-muted-foreground">({l.external_type === "CREDIT" ? "cartão" : "conta"})</span></span>
            <select
              className="max-w-[45%] rounded-lg border bg-background px-2 py-1"
              value={l.account_id ? `a:${l.account_id}` : l.credit_card_id ? `c:${l.credit_card_id}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                act.link.mutate({
                  connectionId: c.id, externalAccountId: l.external_account_id,
                  accountId: v.startsWith("a:") ? v.slice(2) : null, cardId: v.startsWith("c:") ? v.slice(2) : null,
                }, { onError: fail });
              }}
            >
              <option value="">Não importar</option>
              {l.external_type !== "CREDIT" ? accounts.map((a) => <option key={a.id} value={`a:${a.id}`}>Conta: {a.name}</option>) : null}
              {l.external_type === "CREDIT" ? cards.map((k) => <option key={k.id} value={`c:${k.id}`}>Cartão: {k.name}</option>) : null}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!configured || busy} onClick={() => act.discover.mutate(c.id, { onSuccess: (r) => toast.success(`${r.accounts.length} conta(s) encontrada(s).`), onError: fail })} className="rounded-full border px-3 py-1.5 text-xs disabled:opacity-50">Ler contas do banco</button>
        <button disabled={!configured || !mapped || busy} onClick={() => run("preview")} className="rounded-full border px-3 py-1.5 text-xs disabled:opacity-50">Prévia (90 dias)</button>
        <button disabled={!configured || !mapped || busy} onClick={() => run("stage")} className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Enviar para revisão</button>
        {busy ? <Loader2 className="h-4 w-4 animate-spin self-center" /> : null}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: SyncResult }) {
  const t = result.totals;
  return (
    <div className="mt-4 rounded-xl bg-muted/60 p-3 text-xs" aria-live="polite">
      <p className="font-semibold">{result.mode === "preview" ? "Prévia" : "Enviado para revisão"} · {result.from} a {result.to}</p>
      <ul className="mt-1 space-y-0.5">
        <li>{t.total} movimentos lidos · {t.new} novos · {t.needs_review} para conferir</li>
        <li>{t.exact_duplicate} duplicados exatos · {t.probable_duplicate} possíveis duplicados</li>
        <li>{result.skipped_pending} pendentes ignorados · {result.skipped_invalid} inválidos</li>
      </ul>
      {result.sample.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {result.sample.map((s) => (
            <li key={s.ordinal} className="truncate">{s.date} · {s.description} · R$ {s.amount.toFixed(2)} · {VERDICT_LABEL[s.verdict] ?? s.verdict} · {s.movement_kind}</li>
          ))}
        </ul>
      ) : null}
      {result.mode === "stage" ? <Link to="/app/assessor" className="mt-2 inline-block font-semibold text-primary">Abrir o Assessor para revisar</Link> : null}
    </div>
  );
}

type Loose = Record<string, unknown>;
const pick = (o: unknown, key: string): string => {
  const v = o && typeof o === "object" ? (o as Loose)[key] : undefined;
  return typeof v === "string" ? v : "";
};

/** Resume um evento do widget só com o que ajuda a diagnosticar (sem dados pessoais). */
function describeEvent(e: Loose): string {
  const item = e.item as Loose | undefined;
  const connector = (e.connector ?? item?.connector) as Loose | undefined;
  const bits = [String(e.event ?? "evento"), pick(connector, "name"), pick(item, "status"), pick(item, "executionStatus")].filter(Boolean);
  return bits.join(":");
}

function describeError(err: Loose): string {
  const item = (err.data as Loose | undefined)?.item as Loose | undefined;
  const itemError = item?.error as Loose | undefined;
  return [
    pick(err, "message") || "erro sem mensagem",
    pick(item, "status") && `status ${pick(item, "status")}`,
    pick(item, "executionStatus") && `execução ${pick(item, "executionStatus")}`,
    pick(itemError, "code") && `código ${pick(itemError, "code")}`,
    pick(itemError, "message"),
  ].filter(Boolean).join(" · ");
}
