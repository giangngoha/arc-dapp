/**
 * lib/arc.ts — Server-side AppKit + Viem adapter
 * Only used in Server Actions ("use server"). Never import in client components.
 * Docs: https://docs.arc.io/app-kit/bridge
 */
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import {
  ArcTestnet,
  EthereumSepolia,
  AvalancheFuji,
  BaseSepolia,
  PolygonAmoy,
  ArbitrumSepolia,
} from "@circle-fin/app-kit/chains";

// Map string IDs to chain definition objects
export const CHAIN_DEFS: Record<string, ReturnType<typeof ArcTestnet extends never ? never : () => typeof ArcTestnet>> = {
  Arc_Testnet:       ArcTestnet       as any,
  Ethereum_Sepolia:  EthereumSepolia  as any,
  Avalanche_Fuji:    AvalancheFuji    as any,
  Base_Sepolia:      BaseSepolia      as any,
  Polygon_Amoy:      PolygonAmoy      as any,
  Arbitrum_Sepolia:  ArbitrumSepolia  as any,
};

let _kit: AppKit | null = null;
export function getKit(): AppKit {
  if (!_kit) _kit = new AppKit();
  return _kit;
}

export function getAdapter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.trim() === "" || pk === "0xYOUR_PRIVATE_KEY_HERE") {
    throw new Error("PRIVATE_KEY not set in .env.local");
  }
  return createViemAdapterFromPrivateKey({
    privateKey: pk as `0x${string}`,
  });
}

export function hasCredentials(): boolean {
  const pk  = process.env.PRIVATE_KEY;
  const kit = process.env.KIT_KEY;
  return !!(
    pk  && pk.trim()  !== "" && pk  !== "0xYOUR_PRIVATE_KEY_HERE" &&
    kit && kit.trim() !== "" && kit !== "YOUR_KIT_KEY_HERE"
  );
}

// Legacy helper used by swap/actions.ts
export function getKitKey(): string {
  const key = process.env.KIT_KEY;
  if (!key || key.trim() === "" || key === "YOUR_KIT_KEY_HERE") {
    throw new Error("KIT_KEY not set in .env.local. Get it at console.circle.com");
  }
  return key;
}
