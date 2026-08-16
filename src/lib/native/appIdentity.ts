// Fonte única da identidade nativa do Meu Nino.
// Usada por Capacitor, deep links e (futuramente) StoreKit/push.
export const APP_ID = "br.com.meunino.app";
export const APP_NAME = "Meu Nino";
export const APP_SCHEME = "meunino";
export const APP_WEB_ORIGIN = "https://meunino.com.br";
export const APP_MARKETING_VERSION = "1.0.0";
export const APP_BUILD_NUMBER = "1";

// Rotas internas autorizadas a receber deep link (proteção contra open redirect).
export const DEEP_LINK_ALLOWED_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/app",
] as const;

// Hosts aceitos em Universal Links.
export const DEEP_LINK_ALLOWED_HOSTS = ["meunino.com.br", "www.meunino.com.br"] as const;
