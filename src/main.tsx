import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";
import { registerServiceWorker } from "@/lib/push/pushClient";

// App instalado na Tela de Início (iOS/Android): a barra de status sobrepõe o conteúdo; o CSS usa esta classe
// para respeitar a área segura (mesmas regras do app nativo).
try {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) document.documentElement.classList.add("pwa-standalone");
} catch { /* sem matchMedia: segue como navegador */ }

createRoot(document.getElementById("root")!).render(<App />);

// Service worker só para notificações push (sem cache): na web/PWA, nunca no app nativo.
if (import.meta.env.PROD && !Capacitor.isNativePlatform()) void registerServiceWorker();
