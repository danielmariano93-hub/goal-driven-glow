import { Outlet } from 'react-router-dom';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { AssessorFab } from '@/components/assessor/AssessorFab';
import { AssessorPanel } from '@/components/assessor/AssessorPanel';
import { AssessorProvider, useAssessor } from '@/context/AssessorContext';
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
  const { valuesHidden } = usePrivacyMode();
  return (
    <AssessorProvider>
      <div className="min-h-screen flex overflow-x-hidden" style={{ background: "var(--home-bg)" }}>
        <DesktopSidebar />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="mx-auto w-full max-w-lg md:max-w-2xl px-4 md:px-8 pt-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pt-4 md:pb-10">
            {/* Cada rota é responsável pelo próprio cabeçalho.
                Reatividade do olho: remonta a rota quando a preferência muda,
                garantindo formatBRL/formatPrivateBRL atualizados. */}
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
