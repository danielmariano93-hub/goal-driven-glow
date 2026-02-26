import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import Lancamentos from "./pages/Lancamentos";
import Metas from "./pages/Metas";
import Dividas from "./pages/Dividas";
import ContasFixas from "./pages/ContasFixas";
import Investimentos from "./pages/Investimentos";
import Emocoes from "./pages/Emocoes";
import Simulador from "./pages/Simulador";
import Configuracoes from "./pages/Configuracoes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/lancamentos" element={<Lancamentos />} />
            <Route path="/metas" element={<Metas />} />
            <Route path="/dividas" element={<Dividas />} />
            <Route path="/contas-fixas" element={<ContasFixas />} />
            <Route path="/investimentos" element={<Investimentos />} />
            <Route path="/emocoes" element={<Emocoes />} />
            <Route path="/simulador" element={<Simulador />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
