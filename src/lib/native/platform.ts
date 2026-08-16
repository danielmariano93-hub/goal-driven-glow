import { Capacitor } from "@capacitor/core";

export const isNativePlatform = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();