import { Outlet } from 'react-router-dom';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      <DesktopSidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-lg md:max-w-5xl px-4 md:px-8 pb-28 md:pb-10 md:pt-6">
          <Outlet />
        </div>
      </main>
      <BottomTabBar />
    </div>
  );
}
