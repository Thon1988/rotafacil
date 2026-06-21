import { storage } from "@/src/utils/storage";

export interface RouteSettings {
  startMode: "first_stop" | "gps" | "manual";
  startAddress: string;
  startLat: number | null;
  startLon: number | null;
  returnToStart: boolean;
  minutesPerStop: number;
  avgSpeedKmh: number;
}

const KEY = "rota_route_settings";

export const DEFAULT_SETTINGS: RouteSettings = {
  startMode: "first_stop",
  startAddress: "",
  startLat: null,
  startLon: null,
  returnToStart: false,
  minutesPerStop: 3,
  avgSpeedKmh: 30,
};

export async function loadSettings(): Promise<RouteSettings> {
  const raw = await storage.getItem<string>(KEY, "");
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: RouteSettings): Promise<void> {
  await storage.setItem(KEY, JSON.stringify(s));
}
