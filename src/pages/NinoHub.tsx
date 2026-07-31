import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import AssessorAcompanhamentoV2 from "@/pages/AssessorAcompanhamentoV2";

export default function NinoHub() {
  return <div className="space-y-5 pb-10">
    <header>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Seu Nino</p>
      <h1 className="font-display text-2xl font-bold tracking-tight">O que está acontecendo e o que fazer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cada número mostra de onde veio e leva direto para a ação. Nada de diagnóstico genérico.
      </p>
    </header>

    <AssessorAcompanhamentoV2 embedded />

    <Link to="/app/nino-contexto" className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
      <ShieldCheck size={14} className="text-primary" />
      <span>Conferir e corrigir os dados que o Nino usa sobre você</span>
    </Link>
  </div>;
}
