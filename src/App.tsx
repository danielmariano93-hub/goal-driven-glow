import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import Onboarding from "./pages/Onboarding";
import Index from "./pages/Index";
import Lancamentos from "./pages/Lancamentos";
import Contas from "./pages/Contas";
import Categorias from "./pages/Categorias";
import Metas from "./pages/Metas";
import Dividas from "./pages/Dividas";
import Planejamento from "./pages/Planejamento";
import Relatorios from "./pages/Relatorios";
import Emocoes from "./pages/Emocoes";
import Perfil from "./pages/Perfil";
import Investimentos from "./pages/Investimentos";
import MaisMenu from "./pages/MaisMenu";
import AdminDashboard from "./pages/AdminDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              }
            />

            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
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
              <Route path="mais" element={<MaisMenu />} />
            </Route>

            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
