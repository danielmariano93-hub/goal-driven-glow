import type { CapacitorConfig } from "@capacitor/cli";

// Identidade definitiva do produto. Mantida em sincronia com
// src/lib/native/appIdentity.ts (mesma fonte de verdade).
const APP_ID = "br.com.meunino.app";
const APP_NAME = "Meu Nino";

// Live reload é OPT-IN e só existe fora de produção.
// Ex.: CAP_ENV=development CAP_DEV_SERVER_URL=http://192.168.0.10:8080 npx cap sync ios
const env = process.env.CAP_ENV ?? "production";
const devServerUrl = env !== "production" ? process.env.CAP_DEV_SERVER_URL : undefined;

const config: CapacitorConfig = {
  appId: APP_ID,
  appName: APP_NAME,
  webDir: "dist",
  ios: {
    contentInset: "never",
  },
  plugins: {
    StatusBar: { overlaysWebView: true },
    Keyboard: { resize: "native" },
  },
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: true } } : {}),
};

export default config;
