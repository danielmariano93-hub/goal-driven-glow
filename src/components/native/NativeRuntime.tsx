import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativePlatform } from "@/lib/native/platform";

const ALLOWED = ["/login", "/signup", "/forgot-password", "/reset-password", "/app", "/onboarding"];

function safePath(raw: string): string | null {
  try {
    const url = new URL(raw);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return ALLOWED.some((allowed) => url.pathname === allowed || url.pathname.startsWith(`${allowed}/`)) ? path : null;
  } catch { return null; }
}

export function NativeRuntime() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativePlatform()) return;
    document.documentElement.classList.add("native-app");
    void StatusBar.setOverlaysWebView({ overlay: true });
    void StatusBar.setStyle({ style: Style.Light });
    void Keyboard.setResizeMode({ mode: "native" });
    let active = true;
    let removeUrl: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      const path = safePath(url);
      if (path) navigate(path, { replace: true });
    }).then((listener) => { if (active) removeUrl = listener.remove; else void listener.remove(); });
    return () => {
      active = false;
      document.documentElement.classList.remove("native-app");
      if (removeUrl) void removeUrl();
    };
  }, [navigate]);
  return null;
}