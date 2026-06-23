import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Cross-platform secure token storage.
 * - Mobile: expo-secure-store (Keychain / EncryptedSharedPreferences)
 * - Web: localStorage (acceptable trade-off; web is just for preview)
 */
export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      } catch {
        return null;
      }
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (e) {
      console.log("secureStore.set err", e);
    }
  },
  async delete(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        if (typeof window !== "undefined") window.localStorage.removeItem(key);
      } catch {
        /* noop */
      }
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* noop */
    }
  },
};
