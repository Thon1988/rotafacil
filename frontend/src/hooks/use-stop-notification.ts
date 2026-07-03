import { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { Stop } from "@/src/types/stop";

/**
 * usePersistentStopNotification
 * ------------------------------
 * Shows a Circuit-style persistent notification with the CURRENT PENDING
 * STOP (address, house number, code) only when the app goes to the
 * background — i.e. when the driver switches to Waze / Google Maps for
 * navigation. When the app comes back to foreground the notification is
 * dismissed automatically.
 *
 * The notification is `sticky` on Android and stays in the tray until
 * either (a) app returns to foreground, (b) route is complete, or (c)
 * user manually dismisses it.
 *
 * ⚠️ Only works on a NATIVE BUILD (APK/IPA). Expo Go on Android SDK 53+
 * blocked remote push, but LOCAL notifications still work when the app
 * is not in the foreground. iOS may show it as a banner when
 * backgrounded (system limitation).
 */

const CHANNEL_ID = "rota-facil-active-stop";
const NOTIF_ID = "active-stop";

// Global handler so notifications DON'T show while app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Parada atual",
      importance: Notifications.AndroidImportance.LOW, // no sound / vibration
      sound: null,
      vibrationPattern: [0],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
      enableVibrate: false,
    });
  } catch {
    /* ignore */
  }
}

async function ensurePermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync({
      android: {},
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    return req.status === "granted";
  } catch {
    return false;
  }
}

function truncate(text: string, max = 80): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

async function showNotificationForStop(index: number, s: Stop, total: number) {
  const stopNumber = String(index + 1).padStart(2, "0");
  const title = `Parada ${stopNumber} de ${String(total).padStart(2, "0")}`;
  // Body format (per user spec):
  //   Line 1: Street name + number (first 2 segments of endereco)
  //   Line 2: Customer name (if available)
  //   Line 3: AT code (or fallback to codigo)
  const parts = s.endereco.split(",").map((p) => p.trim()).filter(Boolean);
  const streetAndNumber = parts.slice(0, 2).join(", ");
  const cliente = (s as any).cliente || "";
  const codeLabel = ((s as any).codigo_at as string) || s.codigo || "";
  const bodyLines = [
    streetAndNumber,
    cliente,
    codeLabel,
  ].filter(Boolean);
  const body = bodyLines.join("\n");
  try {
    await Notifications.dismissNotificationAsync(NOTIF_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title,
        body: truncate(body, 240),
        data: { stopId: s.id, codigo: s.codigo },
        sound: null,
        priority: Notifications.AndroidNotificationPriority.LOW,
        ...(Platform.OS === "android"
          ? { sticky: true, autoDismiss: false, channelId: CHANNEL_ID }
          : {}),
      },
      trigger: null, // fire immediately
    });
  } catch {
    /* ignore */
  }
}

async function dismissNotification() {
  try {
    await Notifications.dismissNotificationAsync(NOTIF_ID);
  } catch {
    /* ignore */
  }
}

export function usePersistentStopNotification(stops: Stop[]) {
  const currentStopRef = useRef<{ idx: number; stop: Stop; total: number } | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep track of the current stop info (the one that would be shown if we're
  // in background). Do NOT show while foregrounded — Circuit behaves this way
  // and the driver explicitly asked for it.
  useEffect(() => {
    const pendingIdx = stops.findIndex((s) => s.status === "pendente");
    if (pendingIdx < 0) {
      currentStopRef.current = null;
      dismissNotification();
      return;
    }
    currentStopRef.current = {
      idx: pendingIdx,
      stop: stops[pendingIdx],
      total: stops.length,
    };
    // If we're already backgrounded (unlikely on mount), refresh notification
    if (appStateRef.current !== "active") {
      showNotificationForStop(pendingIdx, stops[pendingIdx], stops.length);
    }
  }, [stops]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await ensureAndroidChannel();
      await ensurePermission();
    })();

    const sub = AppState.addEventListener("change", async (next) => {
      if (!mounted) return;
      const prev = appStateRef.current;
      appStateRef.current = next;
      // Went to background → show notification
      if (prev === "active" && next !== "active") {
        const cur = currentStopRef.current;
        if (cur) {
          await showNotificationForStop(cur.idx, cur.stop, cur.total);
        }
      }
      // Back to foreground → hide notification
      if (prev !== "active" && next === "active") {
        await dismissNotification();
      }
    });

    return () => {
      mounted = false;
      sub.remove();
      dismissNotification();
    };
  }, []);
}
