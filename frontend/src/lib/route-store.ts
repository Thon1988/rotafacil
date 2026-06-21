import { storage } from "@/src/utils/storage";
import { Stop } from "@/src/types/stop";

const ROUTE_KEY = "rota_facil_db";

export async function loadRoute(): Promise<Stop[]> {
  // storage util doesn't natively support arrays so we use raw string
  const raw = await storage.getItem<string>(ROUTE_KEY, "");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Stop[];
  } catch {
    return [];
  }
}

export async function saveRoute(stops: Stop[]): Promise<void> {
  await storage.setItem(ROUTE_KEY, JSON.stringify(stops));
}

export async function clearRoute(): Promise<void> {
  await storage.removeItem(ROUTE_KEY);
}
