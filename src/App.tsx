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
const AssessorAcompanhamento = lazy(() => import("./pages/AssessorAcompanhamentoV2"));
const NinoContexto = lazy(() => import("./pages/NinoContextoV2"));
const ProactiveAlertDetail = lazy(() => import("./pages/ProactiveAlertDetail"));
const MetasConjuntas = lazy(() => import("./pages/MetasConjuntas"));
const MetaConjuntaDetalhe = lazy(() => import("./pages/MetaConjuntaDetalhe"));

// Platform admin (lazy)
const AdminCockpit = lazy(() => import("./pages/admin/Cockpit"));
const AdminCrescimentoHub = lazy(() => import("./pages/admin/CrescimentoHub"));
const AdminClientes = lazy(() => import("./pages/admin/Clientes"));
const AdminGovernancaSeguranca = lazy(() => import("./pages/admin/GovernancaSeguranca"));
const AdminAuditoriaHub = lazy(() => import("./pages/admin/AuditoriaHub"));
const AdminOpSaude = lazy(() => import("./pages/admin/operacao/Saude"));
const AdminOpWhatsApp = lazy(() => import("./pages/admin/operacao/WhatsApp"));
const AdminAssessorHub = lazy(() => import("./pages/admin/operacao/AssessorHub"));
const AdminComunicacaoProativa = lazy(() => import("./pages/admin/ComunicacaoProativa"));


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
                <Route path="metas-conjuntas" element={<MetasConjuntas />} />
                <Route path="metas-conjuntas/:id" element={<MetaConjuntaDetalhe />} />
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
                <Route path="assessor/acompanhamento" element={<AssessorAcompanhamento />} />
                <Route path="nino-contexto" element={<NinoContexto />} />
                <Route path="alertas/:dedupKey" element={<ProactiveAlertDetail />} />
              </Route>

              {/* Platform admin — separate application */}
              <Route
                path="/admin"
                element={<PlatformAdminRoute><AdminLayout /></PlatformAdminRoute>}
              >
                {/* Control Center v3 — 9 destinos */}
                <Route index element={<AdminCockpit />} />
                <Route path="cockpit" element={<AdminCockpit />} />
                <Route path="clientes" element={<AdminClientes />} />
                <Route path="crescimento" element={<AdminCrescimentoHub />} />
                <Route path="operacao" element={<AdminOpSaude />} />
                <Route path="operacao/saude" element={<AdminOpSaude />} />
                <Route path="operacao/whatsapp" element={<AdminOpWhatsApp />} />
                <Route path="operacao/assistente" element={<AdminAssessorHub />} />
                <Route path="operacao/comunicacao-proativa" element={<AdminComunicacaoProativa />} />
                <Route path="governanca/seguranca" element={<AdminGovernancaSeguranca />} />
                <Route path="governanca/auditoria" element={<AdminAuditoriaHub />} />

                {/* Rotas antigas → destinos atuais */}
                <Route path="inteligencia-produto" element={<Navigate to="/admin/crescimento?aba=produto" replace />} />
                <Route path="receita" element={<Navigate to="/admin/crescimento?aba=receita" replace />} />
                <Route path="produto" element={<Navigate to="/admin/crescimento?aba=produto" replace />} />
                <Route path="ia" element={<Navigate to="/admin/crescimento?aba=produto" replace />} />
                <Route path="operacao/mensageria" element={<Navigate to="/admin/operacao/whatsapp" replace />} />
                <Route path="mensagens" element={<Navigate to="/admin/operacao/whatsapp" replace />} />
                <Route path="whatsapp" element={<Navigate to="/admin/operacao/whatsapp" replace />} />
                <Route path="operacao/ia-ocr" element={<Navigate to="/admin/operacao/assistente?aba=documentos" replace />} />
                <Route path="operacao/assistente/simulador" element={<Navigate to="/admin/operacao/assistente?aba=simulador" replace />} />
                <Route path="agente" element={<Navigate to="/admin/operacao/assistente" replace />} />
                <Route path="agente/simulador" element={<Navigate to="/admin/operacao/assistente?aba=simulador" replace />} />
                <Route path="governanca/configuracoes" element={<Navigate to="/admin/governanca/auditoria?aba=configuracoes" replace />} />
                <Route path="configuracoes" element={<Navigate to="/admin/governanca/auditoria?aba=configuracoes" replace />} />
                <Route path="seguranca" element={<Navigate to="/admin/governanca/seguranca" replace />} />
                <Route path="usuarios" element={<Navigate to="/admin/clientes" replace />} />
                <Route path="engajamento" element={<Navigate to="/admin/crescimento" replace />} />
                <Route path="financeiro" element={<Navigate to="/admin/crescimento?aba=receita" replace />} />
                <Route path="legado/visao-geral" element={<Navigate to="/admin/cockpit" replace />} />

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
