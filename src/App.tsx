import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/context/AuthContext";
import { PrivacyModeProvider } from "@/context/PrivacyModeContext";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PlatformAdminRoute } from "@/components/auth/PlatformAdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
import Landing from "./pages/landing/LandingPage";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import NotFound from "./pages/NotFound";

// Financial user (lazy)
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Index = lazy(() => import("./pages/Index"));
const Lancamentos = lazy(() => import("./pages/Lancamentos"));
const LancamentoDetalhe = lazy(() => import("./pages/LancamentoDetalhe"));
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
const DivisaoDoRole = lazy(() => import("./pages/DivisaoDoRole"));
const DivisaoDoRoleNova = lazy(() => import("./pages/DivisaoDoRoleNova"));
const DivisaoDoRoleDetalhe = lazy(() => import("./pages/DivisaoDoRoleDetalhe"));
const Recorrencias = lazy(() => import("./pages/Recorrencias"));
const Desafios = lazy(() => import("./pages/Desafios"));
const Notificacoes = lazy(() => import("./pages/Notificacoes"));
const CobrancasRecebidas = lazy(() => import("./pages/CobrancasRecebidas"));
const Cartoes = lazy(() => import("./pages/Cartoes"));
const Assessor = lazy(() => import("./pages/Assessor"));

// Platform admin (lazy)
const AdminVisaoGeral = lazy(() => import("./pages/admin/VisaoGeral"));
const AdminUsuarios = lazy(() => import("./pages/admin/Usuarios"));
const AdminEngajamento = lazy(() => import("./pages/admin/Engajamento"));
const AdminFinanceiro = lazy(() => import("./pages/admin/Financeiro"));
const AdminAgenteSimulador = lazy(() => import("./pages/admin/AgenteSimulador"));
const AdminConfiguracoes = lazy(() => import("./pages/admin/Configuracoes"));
// Control Center v2
const AdminCockpit = lazy(() => import("./pages/admin/Cockpit"));
const AdminCrescimento = lazy(() => import("./pages/admin/Crescimento"));
const AdminInteligenciaProduto = lazy(() => import("./pages/admin/InteligenciaProduto"));
const AdminClientes = lazy(() => import("./pages/admin/Clientes"));
const AdminReceita = lazy(() => import("./pages/admin/Receita"));
const AdminGovernancaSeguranca = lazy(() => import("./pages/admin/GovernancaSeguranca"));
const AdminGovernancaAuditoria = lazy(() => import("./pages/admin/GovernancaAuditoria"));
const AdminOpSaude = lazy(() => import("./pages/admin/operacao/Saude"));
const AdminOpMensageria = lazy(() => import("./pages/admin/operacao/Mensageria"));
const AdminOpIaOcr = lazy(() => import("./pages/admin/operacao/IaOcr"));
const AdminOpWhatsApp = lazy(() => import("./pages/admin/operacao/WhatsApp"));
const AdminOpAssistente = lazy(() => import("./pages/admin/operacao/Assistente"));

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
          <PrivacyModeProvider>
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

              {/* Financial user app */}
              <Route
                path="/app"
                element={<ProtectedRoute><AppLayout /></ProtectedRoute>}
              >
                <Route index element={<Index />} />
                <Route path="lancamentos" element={<Lancamentos />} />
                <Route path="lancamentos/:id" element={<LancamentoDetalhe />} />
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
                <Route path="divisao-do-role" element={<DivisaoDoRole />} />
                <Route path="divisao-do-role/nova" element={<DivisaoDoRoleNova />} />
                <Route path="divisao-do-role/:id" element={<DivisaoDoRoleDetalhe />} />
                <Route path="divisao-do-role/:id/editar" element={<DivisaoDoRoleNova />} />
                <Route path="recorrencias" element={<Recorrencias />} />
                <Route path="desafios" element={<Desafios />} />
                <Route path="notificacoes" element={<Notificacoes />} />
                <Route path="cobrancas" element={<CobrancasRecebidas />} />
                <Route path="cartoes" element={<Cartoes />} />
                <Route path="assessor" element={<Assessor />} />
              </Route>

              {/* Platform admin — separate application */}
              <Route
                path="/admin"
                element={<PlatformAdminRoute><AdminLayout /></PlatformAdminRoute>}
              >
                {/* Control Center v2 */}
                <Route index element={<AdminCockpit />} />
                <Route path="cockpit" element={<AdminCockpit />} />
                <Route path="crescimento" element={<AdminCrescimento />} />
                <Route path="inteligencia-produto" element={<AdminInteligenciaProduto />} />
                <Route path="clientes" element={<AdminClientes />} />
                <Route path="receita" element={<AdminReceita />} />
                <Route path="operacao" element={<AdminOpSaude />} />
                <Route path="operacao/saude" element={<AdminOpSaude />} />
                <Route path="operacao/mensageria" element={<AdminOpMensageria />} />
                <Route path="operacao/ia-ocr" element={<AdminOpIaOcr />} />
                <Route path="operacao/whatsapp" element={<AdminOpWhatsApp />} />
                <Route path="operacao/assistente" element={<AdminOpAssistente />} />
                <Route path="operacao/assistente/simulador" element={<AdminAgenteSimulador />} />
                <Route path="governanca/seguranca" element={<AdminGovernancaSeguranca />} />
                <Route path="governanca/auditoria" element={<AdminGovernancaAuditoria />} />
                <Route path="governanca/configuracoes" element={<AdminConfiguracoes />} />

                {/* Legado — mantido acessível por 1 release (rollback), removido do menu */}
                <Route path="legado/visao-geral" element={<AdminVisaoGeral />} />
                <Route path="usuarios" element={<AdminUsuarios />} />
                <Route path="engajamento" element={<AdminEngajamento />} />
                <Route path="financeiro" element={<AdminFinanceiro />} />
                <Route path="agente" element={<AdminOpAssistente />} />
                <Route path="agente/simulador" element={<AdminAgenteSimulador />} />
                <Route path="mensagens" element={<AdminOpMensageria />} />
                <Route path="ia" element={<AdminInteligenciaProduto />} />
                <Route path="whatsapp" element={<AdminOpWhatsApp />} />
                <Route path="produto" element={<AdminInteligenciaProduto />} />
                <Route path="seguranca" element={<AdminGovernancaSeguranca />} />
                <Route path="configuracoes" element={<AdminConfiguracoes />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </PrivacyModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
