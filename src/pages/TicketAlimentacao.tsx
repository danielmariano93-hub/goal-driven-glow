import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/engine/facts";
import { benefitAddDays } from "@/lib/engine/benefitWallet";
import { useBenefitEnabled, useBenefitEntries, type BenefitEntryRow, useBenefitOwnFoodRows, useBenefitWallet, useDeleteBenefitEntry } from "@/lib/db/benefitWallet";
import { EntrySheet, type Mode as EntryMode } from "@/components/ticket/EntrySheet";
import { StatementImportSheet } from "@/components/ticket/StatementImportSheet";
import { SetupWallet } from "@/components/ticket/SetupWallet";
import { TicketView } from "@/components/ticket/TicketView";

/** Ticket Alimentação: carrega os dados e abre as três abas (Resumo, Análises, Extrato). Registrar, importar,
 *  editar e excluir usam os mesmos fluxos de antes. */
export default function TicketAlimentacao() {
  const enabled = useBenefitEnabled();
  const walletQ = useBenefitWallet(enabled.data === true);
  const entriesQ = useBenefitEntries(walletQ.data?.id);
  const remove = useDeleteBenefitEntry(walletQ.data?.id);
  const today = todayISO();
  const firstEntry = useMemo(() => (entriesQ.data ?? []).reduce<string | null>((m, e) => (m === null || e.occurred_on < m ? e.occurred_on : m), null) ?? undefined, [entriesQ.data]);
  const ownFood = useBenefitOwnFoodRows(firstEntry ? benefitAddDays(firstEntry, -35) : undefined, today, !!walletQ.data);
  const [sheet, setSheet] = useState(false);
  const [sheetMode, setSheetMode] = useState<EntryMode>("spend");
  const openSheet = (m: EntryMode) => { setSheetMode(m); setSheet(true); };
  const [editing, setEditing] = useState<BenefitEntryRow | null>(null);
  const [importing, setImporting] = useState(false);

  if (enabled.isLoading || (enabled.data && walletQ.isLoading)) return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!enabled.data) return <Navigate to="/app" replace />;
  const wallet = walletQ.data;

  const header = (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link to="/app" aria-label="Voltar" className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-xl font-bold">Ticket Alimentação</h1>
      </div>
      {wallet && (
        <div className="flex items-center gap-2">
          <button onClick={() => setImporting(true)} className="min-h-11 rounded-full border border-border px-3 text-sm font-semibold">Importar extrato</button>
          <button onClick={() => openSheet("spend")} aria-label="Registrar gasto" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground"><Plus size={20} /></button>
        </div>
      )}
    </header>
  );

  if (!wallet) return <div className="mx-auto flex max-w-2xl flex-col gap-4">{header}<SetupWallet today={today} /></div>;
  const entries = entriesQ.data ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-8 lg:max-w-[1120px]">
      {header}
      <TicketView
        wallet={wallet}
        entries={entries}
        own={ownFood.data ?? []}
        ownReady={ownFood.isSuccess}
        today={today}
        onAdd={openSheet}
        onEdit={setEditing}
        removing={remove.isPending}
        onRemove={(id) => remove.mutate(id, { onSuccess: () => toast.success("Lançamento excluído"), onError: () => toast.error("Não consegui excluir agora.") })}
      />
      <EntrySheet open={sheet} onOpenChange={setSheet} walletId={wallet.id} today={today} initialMode={sheetMode} />
      <EntrySheet open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} walletId={wallet.id} today={today} entry={editing} />
      <StatementImportSheet open={importing} onOpenChange={setImporting} walletId={wallet.id} entries={entries} />
    </div>
  );
}
