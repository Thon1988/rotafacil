import { storage } from "@/src/utils/storage";

const USER_ID_KEY = "rota_user_id";

function genId(): string {
  // RFC4122-ish lite
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateUserId(): Promise<string> {
  const existing = await storage.getItem<string>(USER_ID_KEY, "");
  if (existing) return existing;
  const id = genId();
  await storage.setItem(USER_ID_KEY, id);
  return id;
}
