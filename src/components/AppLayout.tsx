import { Outlet } from 'react-router-dom';
import { Eye, EyeOff, LogOut } from 'lucide-react';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { AssessorFab } from '@/components/assessor/AssessorFab';
import { AssessorPanel } from '@/components/assessor/AssessorPanel';
import { AssessorProvider, useAssessor } from '@/context/AssessorContext';
import { useAuth } from '@/context/AuthContext';
import { usePrivacyMode } from '@/context/PrivacyModeContext';

/**
 * Painel único e global do Assessor. Fica montado condicionalmente aqui
 * dentro do `AssessorProvider` para que FAB, rota `/app/assessor` e
 * notificações compartilhem a mesma instância — nunca dois painéis
 * abertos ao mesmo tempo.
 */
function GlobalAssessorPanel() {
  const { isOpen, closeAssessor } = useAssessor();
  if (!isOpen) return null;
  return <AssessorPanel onClose={closeAssessor} />;
}

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const { valuesHidden, toggleValues } = usePrivacyMode();
  return (
    <AssessorProvider>
      <div className="min-h-screen bg-background flex">
        <DesktopSidebar />
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-lg md:max-w-5xl px-4 md:px-8 pb-28 md:pb-10 md:pt-4">
            <div className="mb-4 flex min-w-0 items-center justify-between gap-2 md:mb-6">
              <p className="min-w-0 flex-1 truncate font-display text-base font-semibold text-foreground sm:text-lg md:text-xl">
                {profile?.display_name ? `Olá, ${profile.display_name}` : ""}
              </p>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => void toggleValues()}
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
                  aria-label={valuesHidden ? "Mostrar valores financeiros" : "Ocultar valores financeiros"}
                  title={valuesHidden ? "Mostrar valores" : "Ocultar valores"}
                >
                  {valuesHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <NotificationBell />
                <button
                  type="button"
                  onClick={signOut}
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground sm:inline-flex sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs sm:font-medium"
                  aria-label="Sair"
                >
                  <LogOut size={14} /> <span className="hidden sm:inline">Sair</span>
                </button>
              </div>
            </div>
            {/* Reatividade do olho: remonta a rota atual sempre que a preferência
                muda, garantindo que qualquer valor formatado pelo módulo puro
                formatBRL/formatPrivateBRL seja refletido imediatamente. */}
            <div key={valuesHidden ? "priv-on" : "priv-off"}>
              <Outlet />
            </div>
          </div>
        </main>
        <BottomTabBar />
        <AssessorFab />
        <GlobalAssessorPanel />
      </div>
    </AssessorProvider>
  );
}
