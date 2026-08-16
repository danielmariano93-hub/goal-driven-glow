import { useEffect, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { isNativePlatform } from "@/lib/native/platform";

/**
 * Proteção visual do App Switcher do iOS: ao sair do primeiro plano cobrimos a
 * tela para que valores financeiros não apareçam no preview do multitarefa.
 */
export function PrivacyScreen() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let alive = true;
    const removers: Array<() => Promise<void>> = [];
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => setHidden(!isActive)).then((l) => {
      if (alive) removers.push(l.remove);
      else void l.remove();
    });
    void CapacitorApp.addListener("pause", () => setHidden(true)).then((l) => {
      if (alive) removers.push(l.remove);
      else void l.remove();
    });
    void CapacitorApp.addListener("resume", () => setHidden(false)).then((l) => {
      if (alive) removers.push(l.remove);
      else void l.remove();
    });
    return () => {
      alive = false;
      removers.forEach((remove) => void remove());
    };
  }, []);

  if (!hidden) return null;
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[300] grid place-items-center bg-background backdrop-blur-2xl"
      style={{ WebkitBackdropFilter: "blur(24px)" }}
    >
      <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl opacity-90" />
    </div>
  );
}
