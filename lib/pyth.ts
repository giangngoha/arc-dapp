// ─── Pyth Hermes price feed integration ──────────────────────────────────────
// Off-chain only — fetch from Hermes REST API, no contract needed
// Note: Pyth requires API key from July 31, 2026 (register at pyth.dourolabs.app)

const HERMES = "https://hermes.pyth.network";

export const PYTH_IDS = {
  BTC_USD: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  EUR_USD: "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
};

export interface PythPrice {
  price: number;      // e.g. 95420.50
  change24h: number;  // percentage, e.g. 1.23 or -0.45 — null if unavailable
  publishTime: number; // unix timestamp
}

export interface PythPrices {
  BTC_USD: PythPrice | null;
  EUR_USD: PythPrice | null;
}

function parseEntry(entry: any): PythPrice | null {
  try {
    const p = entry?.price?.price;
    const exp = entry?.price?.expo;
    const ts  = entry?.price?.publish_time;
    if (!p || exp === undefined) return null;
    const price = Number(p) * Math.pow(10, exp);
    return { price, change24h: 0, publishTime: ts };
  } catch { return null; }
}

export async function fetchPythPrices(): Promise<PythPrices> {
  try {
    const ids = Object.values(PYTH_IDS).map(id => `ids[]=${id}`).join("&");
    const res = await fetch(`${HERMES}/v2/updates/price/latest?${ids}&parsed=true`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { BTC_USD: null, EUR_USD: null };
    const j = await res.json();
    const parsed: any[] = j.parsed ?? [];

    const btcEntry = parsed.find(p => ("0x"+p.id).toLowerCase() === PYTH_IDS.BTC_USD.toLowerCase());
    const eurEntry = parsed.find(p => ("0x"+p.id).toLowerCase() === PYTH_IDS.EUR_USD.toLowerCase());

    return {
      BTC_USD: parseEntry(btcEntry),
      EUR_USD: parseEntry(eurEntry),
    };
  } catch {
    return { BTC_USD: null, EUR_USD: null };
  }
}

// Format price for display
export function fmtPrice(p: number | null | undefined, opts?: { decimals?: number; prefix?: string }): string {
  if (p == null || p === 0) return "—";
  const dec = opts?.decimals ?? (p > 1000 ? 2 : p > 1 ? 4 : 6);
  const prefix = opts?.prefix ?? "$";
  return prefix + p.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}