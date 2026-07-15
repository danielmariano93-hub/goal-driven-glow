import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuth } from '@/context/AuthContext';

export function AppLayout() {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-background flex">
      <DesktopSidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-lg md:max-w-5xl px-4 md:px-8 pb-28 md:pb-10 md:pt-4">
          <div className="mb-4 flex items-center justify-between md:mb-6">
            <p className="text-xs text-muted-foreground">
              {profile?.display_name ? `Olá, ${profile.display_name}` : ""}
            </p>
            <div className="flex items-center gap-2">
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
    </div>
  );
}

