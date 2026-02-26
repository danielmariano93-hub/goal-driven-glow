import { Outlet } from 'react-router-dom';
import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopSidebar } from '@/components/DesktopSidebar';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      <DesktopSidebar />
      <main className="flex-1 min-w-0">
        <div className="max-w-lg md:max-w-4xl mx-auto px-4 md:px-8 pb-24 md:pb-8 md:pt-4">
          <Outlet />
        </div>
      </main>
      <BottomTabBar />
    </div>
  );
}
