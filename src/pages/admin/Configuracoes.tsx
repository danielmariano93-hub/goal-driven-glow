import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/admin/permissions";

export default function Configuracoes() {
  const { user, platformRole } = useAuth();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Preferências da plataforma e do seu acesso administrativo.</p>
      </header>

      <div className="surface-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Sua conta administrativa</h2>
        <Row label="E-mail" value={user?.email ?? "—"} />
        <Row label="Papel" value={roleLabel(platformRole)} />
        <Row label="ID" value={user?.id ?? "—"} mono />
      </div>

      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold">Secrets</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Secrets do projeto (WAHA, IA, CRON) são gerenciados no painel de secrets do Lovable Cloud. Não são visíveis nem editáveis por aqui.
        </p>
      </div>

      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold">Domínio & branding</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configuração de domínio custom e branding público é feita fora deste painel.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
