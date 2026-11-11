import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { HabitsShell } from "@/components/hb/HabitsShell";
import { useHabitsEnabled } from "@/lib/habits/api";
import Hoje from "@/pages/habits/Hoje";
import Habitos from "@/pages/habits/Habitos";
import Detalhe from "@/pages/habits/Detalhe";
import Novo from "@/pages/habits/Novo";
import Progresso from "@/pages/habits/Progresso";
import Mais from "@/pages/habits/Mais";

/** Entrada do lado Hábitos (`/h/*`). Sem liberação, volta para o Nino Dinheiro como se esta rota não existisse. */
export default function HabitsApp() {
  const enabled = useHabitsEnabled();
  if (enabled.isLoading) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  }
  if (enabled.data !== true) return <Navigate to="/app" replace />;
  return (
    <HabitsShell>
      <Routes>
        <Route index element={<Navigate to="hoje" replace />} />
        <Route path="hoje" element={<Hoje />} />
        <Route path="habitos" element={<Habitos />} />
        <Route path="habito/:id" element={<Detalhe />} />
        <Route path="novo" element={<Novo />} />
        <Route path="progresso" element={<Progresso />} />
        <Route path="mais" element={<Mais />} />
        <Route path="*" element={<Navigate to="hoje" replace />} />
      </Routes>
    </HabitsShell>
  );
}
