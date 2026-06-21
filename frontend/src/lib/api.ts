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
  whatsapp_number: string;
  whatsapp_message: string;
}

export async function generatePix(userId: string, customerName?: string, customerContact?: string): Promise<PixData> {
  const res = await fetch(`${API}/pix/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, customer_name: customerName, customer_contact: customerContact }),
  });
  if (!res.ok) throw new Error(`PIX falhou: ${res.status}`);
  return res.json();
}

export async function submitPayment(userId: string, txid: string, customerName?: string, customerContact?: string) {
  const res = await fetch(`${API}/pix/submit-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, txid, customer_name: customerName, customer_contact: customerContact }),
  });
  if (!res.ok) throw new Error(`Submit falhou: ${res.status}`);
  return res.json();
}

export async function getSubscription(userId: string) {
  const res = await fetch(`${API}/subscription/${userId}`);
  if (!res.ok) throw new Error(`Sub falhou: ${res.status}`);
  return res.json() as Promise<{ active: boolean; pending: boolean; expires_at: string | null; days_remaining: number }>;
}

// History & Stats
export interface SavedRoute {
  user_id: string;
  route_id: string;
  started_at: string;
  ended_at?: string | null;
  total_stops: number;
  delivered: number;
  failed: number;
  stops?: any[];
}

export async function saveHistory(entry: SavedRoute) {
  const res = await fetch(`${API}/history/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  return res.json();
}

export async function getHistory(userId: string): Promise<{ routes: SavedRoute[] }> {
  const res = await fetch(`${API}/history/${userId}`);
  return res.json();
}

export interface StatsResponse {
  week: { routes: number; total_stops: number; delivered: number; failed: number; success_rate: number };
  month: { routes: number; total_stops: number; delivered: number; failed: number; success_rate: number };
  all_time: { routes: number; total_stops: number; delivered: number; failed: number; success_rate: number };
  best_day: { date: string; delivered: number } | null;
  badge: string;
}

export async function getStats(userId: string): Promise<StatsResponse> {
  const res = await fetch(`${API}/stats/${userId}`);
  return res.json();
}

// Admin
export async function adminLogin(username: string, password: string): Promise<{ access_token: string }> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);
  const res = await fetch(`${API}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(res.status === 429 ? "rate_limited" : "invalid_credentials");
  return res.json();
}

export async function adminPending(token: string): Promise<{ items: any[] }> {
  const res = await fetch(`${API}/admin/pending-payments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`status:${res.status}`);
  return res.json();
}

export async function adminApprove(token: string, txid: string) {
  const res = await fetch(`${API}/admin/approve-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ txid }),
  });
  if (!res.ok) throw new Error(`status:${res.status}`);
  return res.json();
}

export async function adminReject(token: string, txid: string) {
  const res = await fetch(`${API}/admin/reject-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ txid }),
  });
  if (!res.ok) throw new Error(`status:${res.status}`);
  return res.json();
}

export async function adminStats(token: string) {
  const res = await fetch(`${API}/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`status:${res.status}`);
  return res.json();
}
