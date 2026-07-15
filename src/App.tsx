import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { FinancialProvider } from "@/context/FinancialContext";
import { AppLayout } from "@/components/AppLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Index from "./pages/Index";
import Lancamentos from "./pages/Lancamentos";
import Metas from "./pages/Metas";
import Dividas from "./pages/Dividas";
import Planejamento from "./pages/Planejamento";
import Relatorios from "./pages/Relatorios";
import Emocoes from "./pages/Emocoes";
import Perfil from "./pages/Perfil";
import Investimentos from "./pages/Investimentos";
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
            {/* Rotas públicas */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* Área autenticada (F1 vai adicionar guard de auth). Todas as rotas de app vivem sob /app */}
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Index />} />
              <Route path="lancamentos" element={<Lancamentos />} />
              <Route path="metas" element={<Metas />} />
              <Route path="dividas" element={<Dividas />} />
              <Route path="planejamento" element={<Planejamento />} />
              <Route path="relatorios" element={<Relatorios />} />
              <Route path="emocoes" element={<Emocoes />} />
              <Route path="investimentos" element={<Investimentos />} />
              <Route path="perfil" element={<Perfil />} />
              <Route path="mais" element={<MaisMenu />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </FinancialProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
