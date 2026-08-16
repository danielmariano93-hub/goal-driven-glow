import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativePlatform } from "@/lib/native/platform";
import { APP_SCHEME, DEEP_LINK_ALLOWED_HOSTS, DEEP_LINK_ALLOWED_PATHS } from "@/lib/native/appIdentity";
import { nativeInteractionInFlight } from "@/lib/native/interaction";
import { nativeLog } from "@/lib/native/logSanitizer";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve um deep link para uma rota interna conhecida.
 * Rejeita host desconhecido e qualquer caminho fora da allowlist (anti open redirect).
 */
export function resolveDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme === "http") return null;
  if (scheme === "https") {
    if (!DEEP_LINK_ALLOWED_HOSTS.includes(url.hostname.toLowerCase() as never)) return null;
  } else if (scheme !== APP_SCHEME) {
    return null;
  }

  // meunino://app/nino  → pathname pode vir vazio com host = "app"
  let pathname = url.pathname || "";
  if (scheme === APP_SCHEME) {
    const host = url.hostname ? `/${url.hostname}` : "";
    pathname = `${host}${pathname}`.replace(/\/{2,}/g, "/");
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");

  const allowed = DEEP_LINK_ALLOWED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
  if (!allowed) return null;
  return `${pathname}${url.search}${url.hash}`;
}

export function NativeRuntime() {
  const navigate = useNavigate();
  const lastResumeRef = useRef(0);

  useEffect(() => {
    if (!isNativePlatform()) return;
    document.documentElement.classList.add("native-app");
    void StatusBar.setOverlaysWebView({ overlay: true });
    void StatusBar.setStyle({ style: Style.Light });
    void Keyboard.setResizeMode({ mode: KeyboardResize.Native });

    let active = true;
    const removers: Array<() => Promise<void>> = [];
    const track = (promise: Promise<{ remove: () => Promise<void> }>) => {
      void promise.then((listener) => {
        if (active) removers.push(listener.remove);
        else void listener.remove();
      });
    };

    track(
      CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        const path = resolveDeepLink(url);
        if (path) navigate(path, { replace: true });
        else nativeLog("deeplink", "rejected");
      })
    );

    track(
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        // Retorno de câmera/picker/gravador não conta como retomada do app.
        if (nativeInteractionInFlight()) return;
        const now = Date.now();
        if (now - lastResumeRef.current < 1500) return;
        lastResumeRef.current = now;
        void supabase.auth.getSession().then(({ data }) => {
          if (data.session) void supabase.auth.refreshSession();
        });
      })
    );

    return () => {
      active = false;
      document.documentElement.classList.remove("native-app");
      removers.forEach((remove) => void remove());
    };
  }, [navigate]);

  return null;
}
