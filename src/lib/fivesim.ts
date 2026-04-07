const FIVE_SIM_BASE = "https://5sim.net/v1/user";
const API_KEY = import.meta.env.VITE_FIVESIM_API_KEY as string | undefined;

type FiveSimOrderResponse = {
  id: number;
  phone: string;
  status: string;
  operator: string;
  country: string;
  product: string;
  expires: string;
};

type FiveSimCheckResponse = {
  id: number;
  status: string;
  sms: Array<{ code?: string; text?: string; created_at?: string }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_KEY) {
    throw new Error("VITE_FIVESIM_API_KEY is missing.");
  }

  const res = await fetch(`${FIVE_SIM_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `5SIM request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

export async function buyNumber(country: string, operator: string, product: string) {
  return request<FiveSimOrderResponse>(`/buy/activation/${country}/${operator}/${product}`);
}

export async function checkSMS(orderId: number) {
  return request<FiveSimCheckResponse>(`/check/${orderId}`);
}
