import { WhatsAppSessionPanel } from "./WhatsAppSessionPanel";

export default function WhatsAppAdmin() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canal oficial de mensageria do NoControle.ia. Ações críticas exigem confirmação e ficam auditadas.
        </p>
      </header>
      <WhatsAppSessionPanel />
    </div>
  );
}
