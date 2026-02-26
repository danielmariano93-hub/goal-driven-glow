import { Outlet } from 'react-router-dom';
import { BottomTabBar } from '@/components/BottomTabBar';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-lg mx-auto px-4 pt-2 pb-24">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}
