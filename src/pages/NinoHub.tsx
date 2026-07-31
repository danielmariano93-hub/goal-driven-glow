import { useSearchParams } from "react-router-dom";
import { BrainCircuit, ClipboardCheck } from "lucide-react";
import AssessorAcompanhamentoV2 from "@/pages/AssessorAcompanhamentoV2";
import NinoContextoV2 from "@/pages/NinoContextoV2";

export default function NinoHub() {
  const [params, setParams] = useSearchParams();
  const view = params.get("visao") === "aprendizado" ? "aprendizado" : "plano";
  const setView = (next: "plano" | "aprendizado") => {
    const updated = new URLSearchParams(params);
    updated.set("visao", next);
    setParams(updated, { replace: true });
  };
  return <div className="space-y-5 pb-10">
    <header>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Seu Nino</p>
      <h1 className="font-display text-2xl font-bold tracking-tight">Decisões e aprendizados</h1>
      <p className="mt-1 text-sm text-muted-foreground">Um só lugar para entender o que mudou, agir e controlar os dados usados pelo Nino.</p>
    </header>
    <nav className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1" aria-label="Visões do Nino">
      <button type="button" onClick={()=>setView("plano")} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${view==="plano"?"bg-card shadow-sm":"text-muted-foreground"}`}><ClipboardCheck size={14}/>Meu plano</button>
      <button type="button" onClick={()=>setView("aprendizado")} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${view==="aprendizado"?"bg-card shadow-sm":"text-muted-foreground"}`}><BrainCircuit size={14}/>O que aprendeu</button>
    </nav>
    {view === "plano" ? <AssessorAcompanhamentoV2 embedded /> : <NinoContextoV2 embedded />}
  </div>;
}
