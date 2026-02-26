import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { FinancialProvider } from "@/context/FinancialContext";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import Lancamentos from "./pages/Lancamentos";
import Metas from "./pages/Metas";
import Dividas from "./pages/Dividas";
import Planejamento from "./pages/Planejamento";
import Relatorios from "./pages/Relatorios";
import Emocoes from "./pages/Emocoes";
import Perfil from "./pages/Perfil";
import MaisMenu from "./pages/MaisMenu";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <FinancialProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/lancamentos" element={<Lancamentos />} />
              <Route path="/metas" element={<Metas />} />
              <Route path="/dividas" element={<Dividas />} />
              <Route path="/planejamento" element={<Planejamento />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/emocoes" element={<Emocoes />} />
              <Route path="/perfil" element={<Perfil />} />
              <Route path="/mais" element={<MaisMenu />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </FinancialProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
