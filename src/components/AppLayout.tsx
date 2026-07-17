import { Outlet } from 'react-router-dom';
import { Eye, EyeOff, LogOut } from 'lucide-react';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { AssessorFab } from '@/components/assessor/AssessorFab';
import { useAuth } from '@/context/AuthContext';
import { usePrivacyMode } from '@/context/PrivacyModeContext';

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const { valuesHidden, toggleValues } = usePrivacyMode();
  return (
    <div className="min-h-screen bg-background flex">
      <DesktopSidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-lg md:max-w-5xl px-4 md:px-8 pb-28 md:pb-10 md:pt-4">
          <div className="mb-4 flex items-center justify-between md:mb-6">
            <p className="min-w-0 truncate font-display text-lg font-semibold text-foreground md:text-xl">
              {profile?.display_name ? `Olá, ${profile.display_name}` : ""}
            </p>
            <div className="flex items-center gap-2">
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
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <LogOut size={12} /> Sair
              </button>
            </div>
          </div>
          <Outlet />
        </div>
      </main>
      <BottomTabBar />
      <AssessorFab />
    </div>
  );
}
