import { API } from "@/src/constants/theme";
import { Stop } from "@/src/types/stop";

export interface ParsedResult {
  stops: Stop[];
  total: number;
}

export async function parseFile(file: { uri: string; name: string; type: string }): Promise<ParsedResult> {
  const formData = new FormData();
  // React Native FormData accepts {uri, name, type}
  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as any);

  const res = await fetch(`${API}/parse-file`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Parse falhou: ${res.status}`);
  return res.json();
}

export async function parseText(text: string): Promise<ParsedResult> {
  const res = await fetch(`${API}/parse-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Parse texto falhou: ${res.status}`);
  return res.json();
}

export async function geocodeBatch(addresses: string[]): Promise<{ results: any[] }> {
  const res = await fetch(`${API}/geocode-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
  });
  if (!res.ok) throw new Error(`Geocode falhou: ${res.status}`);
  return res.json();
}

export async function optimizeRoute(stops: Stop[]): Promise<{ stops: Stop[] }> {
  const res = await fetch(`${API}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stops }),
  });
  if (!res.ok) throw new Error(`Otimizar falhou: ${res.status}`);
  return res.json();
}

export interface PixData {
  pix_string: string;
  txid: string;
  amount: number;
  pix_key: string;
  merchant_name: string;
}

export async function generatePix(userId: string): Promise<PixData> {
  const res = await fetch(`${API}/pix/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error(`PIX falhou: ${res.status}`);
  return res.json();
}

export async function confirmPayment(userId: string, txid: string) {
  const res = await fetch(`${API}/pix/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, txid }),
  });
  if (!res.ok) throw new Error(`Confirmar falhou: ${res.status}`);
  return res.json();
}

export async function getSubscription(userId: string) {
  const res = await fetch(`${API}/subscription/${userId}`);
  if (!res.ok) throw new Error(`Sub falhou: ${res.status}`);
  return res.json() as Promise<{ active: boolean; expires_at: string | null; days_remaining: number }>;
}
