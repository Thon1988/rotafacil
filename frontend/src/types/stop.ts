export type StopStatus = "pendente" | "entregue" | "falhou";

export interface Stop {
  id: number;
  codigo: string;
  endereco: string;
  status: StopStatus;
  timestamp: string | null;
  lat: number | null;
  lon: number | null;
  cliente?: string | null;
  codigo_at?: string | null;
  cep?: string | null;
  duration_seconds?: number | null; // time taken from previous to this delivery
}
