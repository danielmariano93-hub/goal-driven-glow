import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense } from "react";
import { lazyRoute, clearChunkReloadFlag } from "@/lib/lazyRoute";
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
import OAuthConsent from "./pages/auth/OAuthConsent";
import NotFound from "./pages/NotFound";
import { NativeRuntime } from "@/components/native/NativeRuntime";
import { NativeLockGate } from "@/components/native/NativeLockGate";
import { PrivacyScreen } from "@/components/native/PrivacyScreen";
import { OfflineNotice } from "@/components/OfflineNotice";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { FinancialRealtimeSync } from "@/components/finance/FinancialRealtimeSync";

const Privacidade = lazyRoute(() => import("./pages/legal/Privacidade"));
const Termos = lazyRoute(() => import("./pages/legal/Termos"));
const Plano = lazyRoute(() => import("./pages/Plano"));
const ShortLink = lazyRoute(() => import("./pages/ShortLink"));


// Financial user (lazy)
const Onboarding = lazyRoute(() => import("./pages/Onboarding"));
const Index = lazyRoute(() => import("./pages/Index"));
const Lancamentos = lazyRoute(() => import("./pages/Lancamentos"));
const LancamentoDetalhe = lazyRoute(() => import("./pages/LancamentoDetalhe"));
const Contas = lazyRoute(() => import("./pages/Contas"));
const Categorias = lazyRoute(() => import("./pages/Categorias"));
const Metas = lazyRoute(() => import("./pages/Metas"));
const MetaCategoriaDetalhe = lazyRoute(() => import("./pages/MetaCategoriaDetalhe"));
const MetaDetalhe = lazyRoute(() => import("./pages/MetaDetalhe"));
const Dividas = lazyRoute(() => import("./pages/Dividas"));
const Planejamento = lazyRoute(() => import("./pages/Planejamento"));
const Relatorios = lazyRoute(() => import("./pages/RelatoriosInteligentes"));
const RelatorioInteligenteDetalhe = lazyRoute(() => import("./pages/RelatorioInteligenteDetalhe"));
const Nino = lazyRoute(() => import("./pages/Nino"));
const Emocoes = lazyRoute(() => import("./pages/Emocoes"));
const Perfil = lazyRoute(() => import("./pages/Perfil"));
const Investimentos = lazyRoute(() => import("./pages/Investimentos"));
const MaisMenu = lazyRoute(() => import("./pages/MaisMenu"));
const WhatsApp = lazyRoute(() => import("./pages/WhatsApp"));
const Importar = lazyRoute(() => import("./pages/Importar"));
const DivisaoDoRole = lazyRoute(() => import("./pages/DivisaoDoRole"));
const DivisaoDoRoleNova = lazyRoute(() => import("./pages/DivisaoDoRoleNova"));
const DivisaoDoRoleDetalhe = lazyRoute(() => import("./pages/DivisaoDoRoleDetalhe"));
const Recorrencias = lazyRoute(() => import("./pages/Recorrencias"));
const Compromissos = lazyRoute(() => import("./pages/Compromissos"));
const Desafios = lazyRoute(() => import("./pages/Desafios"));
const Notificacoes = lazyRoute(() => import("./pages/Notificacoes"));
const CobrancasRecebidas = lazyRoute(() => import("./pages/CobrancasRecebidas"));
const Cartoes = lazyRoute(() => import("./pages/Cartoes"));
const Assessor = lazyRoute(() => import("./pages/Assessor"));
const NinoHub = lazyRoute(() => import("./pages/NinoHub"));
const NinoContextoV2 = lazyRoute(() => import("./pages/NinoContextoV2"));

const ProactiveAlertDetail = lazyRoute(() => import("./pages/ProactiveAlertDetail"));
const Antecipacoes = lazyRoute(() => import("./pages/Antecipacoes"));

const MetasConjuntas = lazyRoute(() => import("./pages/MetasConjuntas"));
const MetaConjuntaDetalhe = lazyRoute(() => import("./pages/MetaConjuntaDetalhe"));

// Platform admin (lazy)
const AdminCockpit = lazyRoute(() => import("./pages/admin/Cockpit"));
const AdminCrescimentoHub = lazyRoute(() => import("./pages/admin/CrescimentoHub"));
const AdminClientes = lazyRoute(() => import("./pages/admin/Clientes"));
const AdminClienteFicha = lazyRoute(() => import("./pages/admin/ClienteFicha"));
const AdminOperacoesHub = lazyRoute(() => import("./pages/admin/OperacoesHub"));
const AdminAdministracaoHub = lazyRoute(() => import("./pages/admin/AdministracaoHub"));
const AdminComunicacaoProativa = lazyRoute(() => import("./pages/admin/ComunicacaoProativa"));
const AdminNinoIA = lazyRoute(() => import("./pages/admin/NinoIA"));




/**
 * Cache por natureza do dado (`cache_by_nature.v1`): catálogos quase estáticos
 * (categorias, contas, cartões, ajustes) ficam frescos por 30 min; o resto
 * segue os 30s dinâmicos. Invalidação explícita continua sendo a porta única
 * para verdade nova (`invalidateFinancialQueries`).
 */
const STATIC_KEYS = new Set([
  "categories", "accounts", "credit_cards", "user_financial_settings",
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: (query) =>
        STATIC_KEYS.has(String((query.queryKey as unknown[])?.[0])) ? 30 * 60_000 : 60_000,
      gcTime: 30 * 60_000,
      refetchOnReconnect: true,
    },
  },
});


const Fallback = () => (
  <div className="min-h-[40vh] grid place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// Carregou o app: libera o recurso de reload único para um próximo deploy.
clearChunkReloadFlag();

const App = () => (
  <AppErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <NativeRuntime />
        <AuthProvider>
          <FinancialRealtimeSync />
          <PrivacyModeProvider>
          <Toaster />
          <Sonner />
          <OfflineNotice />
          <NativeLockGate />
          <PrivacyScreen />
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
              <Route path="/privacidade" element={<Privacidade />} />
              <Route path="/termos" element={<Termos />} />
              <Route path="/s/:token" element={<ShortLink />} />



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
                <Route path="metas/categoria/:id" element={<MetaCategoriaDetalhe />} />
                <Route path="metas/:id" element={<MetaDetalhe />} />
                <Route path="dividas" element={<Dividas />} />
                <Route path="planejamento" element={<Planejamento />} />
                <Route path="metas-conjuntas" element={<MetasConjuntas />} />
                <Route path="metas-conjuntas/:id" element={<MetaConjuntaDetalhe />} />
                <Route path="relatorios" element={<Relatorios />} />
                <Route path="relatorios/:id" element={<RelatorioInteligenteDetalhe />} />
                <Route path="relatorios-inteligentes" element={<Navigate to="/app/relatorios" replace />} />
                <Route path="relatorios-inteligentes/:id" element={<RelatorioInteligenteDetalhe />} />
                <Route path="emocoes" element={<Emocoes />} />
                <Route path="investimentos" element={<Investimentos />} />
                <Route path="perfil" element={<Perfil />} />
                <Route path="plano" element={<Plano />} />
                <Route path="whatsapp" element={<WhatsApp />} />
                <Route path="importar" element={<Importar />} />
                <Route path="mais" element={<MaisMenu />} />
                <Route path="divisao-do-role" element={<DivisaoDoRole />} />
                <Route path="divisao-do-role/nova" element={<DivisaoDoRoleNova />} />
                <Route path="divisao-do-role/:id" element={<DivisaoDoRoleDetalhe />} />
                <Route path="divisao-do-role/:id/editar" element={<DivisaoDoRoleNova />} />
                <Route path="recorrencias" element={<Recorrencias />} />
                <Route path="compromissos" element={<Compromissos />} />
                <Route path="desafios" element={<Desafios />} />
                <Route path="notificacoes" element={<Notificacoes />} />
                <Route path="cobrancas" element={<CobrancasRecebidas />} />
                <Route path="cartoes" element={<Cartoes />} />
                <Route path="assessor" element={<Assessor />} />
                <Route path="nino" element={<Nino />} />
                <Route path="assessor/acompanhamento" element={<Navigate to="/app/nino" replace />} />
                <Route path="nino-hub" element={<NinoHub />} />
                <Route path="nino-contexto" element={<NinoContextoV2 />} />
                <Route path="alertas/:dedupKey" element={<ProactiveAlertDetail />} />
                <Route path="antecipacoes" element={<Navigate to="/app/nino?section=prepare-se" replace />} />
                <Route path="antecipacoes/detalhe" element={<Antecipacoes />} />

              </Route>

              {/* Platform admin — separate application */}
              <Route
                path="/admin"
                element={<PlatformAdminRoute><AdminLayout /></PlatformAdminRoute>}
              >
                {/* Centro de decisão — 6 destinos */}
                <Route index element={<AdminCockpit />} />
                <Route path="visao-geral" element={<AdminCockpit />} />
                <Route path="clientes" element={<AdminClientes />} />
                <Route path="clientes/:pseudoId" element={<AdminClienteFicha />} />
                <Route path="produto" element={<AdminCrescimentoHub />} />
                <Route path="operacoes" element={<AdminOperacoesHub />} />
                <Route path="comunicacoes" element={<AdminComunicacaoProativa />} />
                <Route path="nino-ia" element={<AdminNinoIA />} />
                <Route path="administracao" element={<AdminAdministracaoHub />} />

                {/* Rotas antigas → destinos atuais */}
                <Route path="cockpit" element={<Navigate to="/admin/visao-geral" replace />} />
                <Route path="legado/visao-geral" element={<Navigate to="/admin/visao-geral" replace />} />
                <Route path="crescimento" element={<Navigate to="/admin/produto" replace />} />
                <Route path="engajamento" element={<Navigate to="/admin/produto" replace />} />
                <Route path="inteligencia-produto" element={<Navigate to="/admin/produto?aba=produto" replace />} />
                <Route path="ia" element={<Navigate to="/admin/nino-ia" replace />} />
                <Route path="receita" element={<Navigate to="/admin/produto?aba=receita" replace />} />
                <Route path="financeiro" element={<Navigate to="/admin/produto?aba=receita" replace />} />
                <Route path="usuarios" element={<Navigate to="/admin/clientes" replace />} />

                <Route path="operacao" element={<Navigate to="/admin/operacoes" replace />} />
                <Route path="operacao/saude" element={<Navigate to="/admin/operacoes" replace />} />
                <Route path="operacao/whatsapp" element={<Navigate to="/admin/comunicacoes?aba=canais" replace />} />
                <Route path="whatsapp" element={<Navigate to="/admin/comunicacoes?aba=canais" replace />} />
                <Route path="mensagens" element={<Navigate to="/admin/comunicacoes?aba=mensagens" replace />} />
                <Route path="operacao/mensageria" element={<Navigate to="/admin/comunicacoes?aba=mensagens" replace />} />
                <Route path="operacao/assistente" element={<Navigate to="/admin/nino-ia?aba=qualidade" replace />} />
                <Route path="agente" element={<Navigate to="/admin/nino-ia?aba=modelos" replace />} />
                <Route path="operacao/ia-ocr" element={<Navigate to="/admin/nino-ia?aba=documentos" replace />} />
                <Route path="operacao/assistente/simulador" element={<Navigate to="/admin/nino-ia?aba=simulador" replace />} />
                <Route path="agente/simulador" element={<Navigate to="/admin/nino-ia?aba=simulador" replace />} />
                <Route path="operacao/comunicacao-proativa" element={<Navigate to="/admin/comunicacoes" replace />} />

                <Route path="governanca/seguranca" element={<Navigate to="/admin/administracao?secao=acessos" replace />} />
                <Route path="seguranca" element={<Navigate to="/admin/administracao?secao=acessos" replace />} />
                <Route path="governanca/auditoria" element={<Navigate to="/admin/administracao?secao=auditoria" replace />} />
                <Route path="governanca/configuracoes" element={<Navigate to="/admin/administracao?secao=configuracoes" replace />} />
                <Route path="configuracoes" element={<Navigate to="/admin/administracao?secao=configuracoes" replace />} />


              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </PrivacyModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
