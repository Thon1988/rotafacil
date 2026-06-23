import * as Device from "expo-device";
import * as Application from "expo-application";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

const FALLBACK_KEY = "rota_device_fallback_id";

/**
 * Build a relatively-stable device fingerprint that survives app reinstalls
 * on iOS (via `getIosIdForVendorAsync`) and resists casual abuse on Android
 * (via `getAndroidId`). On web (Expo web preview) we fall back to a stored
 * UUID so the same browser session stays consistent.
 */
export async function getDeviceFingerprint(): Promise<string> {
  try {
    if (Platform.OS === "ios") {
      const vendor = await Application.getIosIdForVendorAsync();
      if (vendor) return `ios:${vendor}`;
    }
    if (Platform.OS === "android") {
      const aid = Application.getAndroidId();
      if (aid) return `android:${aid}`;
    }
  } catch (e) {
    console.log("device fp err", e);
  }

  // Fallback: persistent UUID stored locally
  const existing = await storage.getItem<string>(FALLBACK_KEY, "");
  if (existing) return `fb:${existing}`;
  const uuid = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  await storage.setItem(FALLBACK_KEY, uuid);
  return `fb:${uuid}`;
}

export function getDeviceInfo() {
  return {
    brand: Device.brand || "",
    manufacturer: Device.manufacturer || "",
    model: Device.modelName || "",
    os: Platform.OS,
    os_version: Device.osVersion || "",
    device_year: Device.deviceYearClass || null,
  };
}
