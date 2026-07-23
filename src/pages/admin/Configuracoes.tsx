import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/admin/permissions";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { adminToast } from "@/components/admin/adminToast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Copy, Shield, Sliders, Key, Info } from "lucide-react";

const DENSE_KEY = "admin.density.dense";
const COLLAPSED_KEY = "admin.sidebar.collapsed";

export default function Configuracoes() {
  const { user, platformRole } = useAuth();
  const [dense, setDense] = useState(false);
  const [collapsedByDefault, setCollapsedByDefault] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDense(window.localStorage.getItem(DENSE_KEY) === "1");
    setCollapsedByDefault(window.localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.classList.toggle("admin-dense", dense);
    window.localStorage.setItem(DENSE_KEY, dense ? "1" : "0");
  }, [dense]);

  const persistCollapsed = (v: boolean) => {
    setCollapsedByDefault(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    }
  };

  const copyId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      adminToast.success("ID copiado");
    } catch {
      adminToast.warn("Não foi possível copiar automaticamente");
    }
  };

  const buildInfo = `${import.meta.env.MODE ?? "production"} · ${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Preferências da plataforma e do seu acesso administrativo."
      />

      <Section title="Sua conta administrativa" icon={Shield}>
        <div className="surface-card p-5 space-y-3 text-sm">
          <Row label="E-mail" value={user?.email ?? "—"} />
          <Row label="Papel" value={roleLabel(platformRole)} />
          <Row
            label="ID"
            value={user?.id ?? "—"}
            mono
            action={user?.id ? (
              <Button size="sm" variant="ghost" onClick={copyId} aria-label="Copiar ID">
                <Copy size={12} />
              </Button>
            ) : null}
          />
        </div>
      </Section>

      <Section title="Preferências do painel" icon={Sliders} description="Salvas apenas neste navegador.">
        <div className="surface-card p-5 divide-y divide-border">
          <SwitchRow
            id="collapsed-default"
            label="Iniciar com menu recolhido"
            description="Deixa mais espaço para o conteúdo em telas menores de desktop."
            checked={collapsedByDefault}
            onChange={persistCollapsed}
          />
          <SwitchRow
            id="dense-mode"
            label="Modo denso"
            description="Reduz espaçamentos e aumenta a densidade de informação nas telas."
            checked={dense}
            onChange={setDense}
          />
        </div>
      </Section>

      <Section title="Integrações & segredos" icon={Key}>
        <div className="surface-card p-5 text-xs text-muted-foreground space-y-2">
          <p>
            Segredos do projeto (WAHA, IA, CRON) são gerenciados no painel de segredos do Lovable Cloud.
            Não são visíveis nem editáveis por aqui — nem por administradores da plataforma.
          </p>
          <p>
            Configuração de domínio custom e branding público é feita fora deste painel.
          </p>
        </div>
      </Section>

      <Section title="Sobre" icon={Info}>
        <div className="surface-card p-5 space-y-3 text-sm">
          <Row label="Build" value={buildInfo} mono />
          <Row label="Painel" value="MeuNino Admin · Beta" />
        </div>
      </Section>
    </div>
  );
}

function Row({ label, value, mono, action }: { label: string; value: string; mono?: boolean; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`truncate ${mono ? "font-mono text-xs" : "text-sm"}`} title={value}>{value}</span>
        {action}
      </div>
    </div>
  );
}

function SwitchRow({ id, label, description, checked, onChange }: {
  id: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
