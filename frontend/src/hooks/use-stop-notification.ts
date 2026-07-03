import { useEffect, useRef } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
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
 * ⚠️ Only works on a NATIVE BUILD (APK/IPA). Expo Go on Android SDK 53+
 * removed notification support entirely, so this hook is a NO-OP there.
 */

// Guard against Expo Go on Android SDK 53+ — expo-notifications import
// throws at load time. We conditionally require the module and skip
// everything if it's not usable.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const NOTIFICATIONS_UNSUPPORTED = IS_EXPO_GO && Platform.OS === "android";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
if (!NOTIFICATIONS_UNSUPPORTED) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    Notifications = require("expo-notifications");
  } catch {
    Notifications = null;
  }
}

const CHANNEL_ID = "rota-facil-active-stop";
const NOTIF_ID = "active-stop";

// Global handler so notifications DON'T show while app is foregrounded.
if (Notifications?.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Parada atual",
      importance: Notifications.AndroidImportance.LOW,
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
  if (!Notifications) return false;
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
  if (!Notifications) return;
  const stopNumber = String(index + 1).padStart(2, "0");
  const totalStr = String(total).padStart(2, "0");
  const parts = s.endereco.split(",").map((p) => p.trim()).filter(Boolean);
  const streetAndNumber = parts.slice(0, 2).join(", ");
  const complement = parts.slice(2, 4).join(", "); // e.g. "Ap 1106 T1, São Paulo"
  const cliente = (s as any).cliente || "";
  const codeLabel = ((s as any).codigo_at as string) || s.codigo || "";

  // COLLAPSED view (small pill in notification tray):
  //   title: Av Prf Edgar Santos, 514
  //   body:  Ap 1106 T1, São Paulo
  // EXPANDED view (user taps chevron to expand):
  //   Same title + full body with cliente + code
  const collapsedTitle = truncate(streetAndNumber || s.endereco, 60);
  const collapsedBody = complement || s.codigo;
  const expandedBody = [streetAndNumber, complement, cliente, codeLabel]
    .filter(Boolean)
    .join("\n");

  try {
    await Notifications.dismissNotificationAsync(NOTIF_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: `${stopNumber} · ${collapsedTitle}`,
        subtitle: `Parada ${stopNumber} de ${totalStr}`,
        body: truncate(collapsedBody, 120),
        // Android will show `body` in collapsed view; `expandedBody` when user
        // taps the chevron. iOS shows all of it in the expanded card by default.
        data: {
          stopId: s.id,
          codigo: s.codigo,
          cliente,
          codeLabel,
          expandedBody,
        },
        sound: null,
        priority: Notifications.AndroidNotificationPriority.LOW,
        categoryIdentifier: "STOP_ACTIONS",
        ...(Platform.OS === "android"
          ? {
              sticky: true,
              autoDismiss: false,
              channelId: CHANNEL_ID,
              // BigTextStyle: shows `expandedBody` when the notification is expanded
              // (user taps the down-chevron in Android's tray).
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              style: { type: "bigText", text: expandedBody } as any,
            }
          : {}),
      },
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}

async function dismissNotification() {
  if (!Notifications) return;
  try {
    await Notifications.dismissNotificationAsync(NOTIF_ID);
  } catch {
    /* ignore */
  }
}

async function ensureCategory() {
  // Action buttons attached to the notification. On Android these render
  // as buttons within the expanded notification.
  if (!Notifications?.setNotificationCategoryAsync) return;
  try {
    await Notifications.setNotificationCategoryAsync("STOP_ACTIONS", [
      {
        identifier: "OPEN_MAPS",
        buttonTitle: "Abrir app",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "MARK_FAILED",
        buttonTitle: "Não entregue",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "MARK_DELIVERED",
        buttonTitle: "Entregue",
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    /* ignore */
  }
}

export function usePersistentStopNotification(stops: Stop[]) {
  const currentStopRef = useRef<{ idx: number; stop: Stop; total: number } | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

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
    if (appStateRef.current !== "active") {
      showNotificationForStop(pendingIdx, stops[pendingIdx], stops.length);
    }
  }, [stops]);

  useEffect(() => {
    if (!Notifications) return; // Expo Go on Android SDK 53+ — skip entirely
    let mounted = true;
    (async () => {
      await ensureAndroidChannel();
      await ensureCategory();
      await ensurePermission();
    })();

    const sub = AppState.addEventListener("change", async (next) => {
      if (!mounted) return;
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === "active" && next !== "active") {
        const cur = currentStopRef.current;
        if (cur) {
          await showNotificationForStop(cur.idx, cur.stop, cur.total);
        }
      }
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
