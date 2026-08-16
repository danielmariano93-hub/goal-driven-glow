import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.p73db6dbefc9046e48278b978492e7f92",
  appName: "goal-driven-glow",
  webDir: "dist",
  server: {
    url: "https://73db6dbe-fc90-46e4-8278-b978492e7f92.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    StatusBar: { overlaysWebView: true },
    Keyboard: { resize: "native" },
  },
};

export default config;