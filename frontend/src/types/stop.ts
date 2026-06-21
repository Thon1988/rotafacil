export type StopStatus = "pendente" | "entregue" | "falhou";

export interface Stop {
  id: number;
  codigo: string;
  endereco: string;
  status: StopStatus;
  timestamp: string | null;
  lat: number | null;
  lon: number | null;
}
