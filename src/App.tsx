import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/context/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import NotFound from "./pages/NotFound";

// Lazy-load the authenticated app + admin surface to keep the initial bundle small.
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Index = lazy(() => import("./pages/Index"));
const Lancamentos = lazy(() => import("./pages/Lancamentos"));
const Contas = lazy(() => import("./pages/Contas"));
const Categorias = lazy(() => import("./pages/Categorias"));
const Metas = lazy(() => import("./pages/Metas"));
const Dividas = lazy(() => import("./pages/Dividas"));
const Planejamento = lazy(() => import("./pages/Planejamento"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Emocoes = lazy(() => import("./pages/Emocoes"));
const Perfil = lazy(() => import("./pages/Perfil"));
const Investimentos = lazy(() => import("./pages/Investimentos"));
const MaisMenu = lazy(() => import("./pages/MaisMenu"));
const WhatsApp = lazy(() => import("./pages/WhatsApp"));
const Importar = lazy(() => import("./pages/Importar"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AgenteAdmin = lazy(() => import("./pages/admin/Agente"));
const AgenteSimulador = lazy(() => import("./pages/admin/AgenteSimulador"));
const DivisaoDoRole = lazy(() => import("./pages/DivisaoDoRole"));
const DivisaoDoRoleNova = lazy(() => import("./pages/DivisaoDoRoleNova"));
const DivisaoDoRoleDetalhe = lazy(() => import("./pages/DivisaoDoRoleDetalhe"));
const Recorrencias = lazy(() => import("./pages/Recorrencias"));
const Desafios = lazy(() => import("./pages/Desafios"));
const Notificacoes = lazy(() => import("./pages/Notificacoes"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const Fallback = () => (
  <div className="min-h-[40vh] grid place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              <Route
                path="/onboarding"
                element={<ProtectedRoute><Onboarding /></ProtectedRoute>}
              />

              <Route
                path="/app"
                element={<ProtectedRoute><AppLayout /></ProtectedRoute>}
              >
                <Route index element={<Index />} />
                <Route path="lancamentos" element={<Lancamentos />} />
                <Route path="contas" element={<Contas />} />
                <Route path="categorias" element={<Categorias />} />
                <Route path="metas" element={<Metas />} />
                <Route path="dividas" element={<Dividas />} />
                <Route path="planejamento" element={<Planejamento />} />
                <Route path="relatorios" element={<Relatorios />} />
                <Route path="emocoes" element={<Emocoes />} />
                <Route path="investimentos" element={<Investimentos />} />
                <Route path="perfil" element={<Perfil />} />
                <Route path="whatsapp" element={<WhatsApp />} />
                <Route path="importar" element={<Importar />} />
                <Route path="mais" element={<MaisMenu />} />
              </Route>

              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="/admin/agente" element={<AdminRoute><AgenteAdmin /></AdminRoute>} />
              <Route path="/admin/agente/simulador" element={<AdminRoute><AgenteSimulador /></AdminRoute>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
