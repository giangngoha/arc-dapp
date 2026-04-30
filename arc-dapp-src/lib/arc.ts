/**
 * lib/arc.ts
 * Server-side helper: khởi tạo AppKit + adapter Viem từ env vars.
 * Chỉ dùng trong Server Actions hoặc API Routes (không import vào client component).
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

// Singleton AppKit instance
let _kit: AppKit | null = null;

export function getKit(): AppKit {
  if (!_kit) _kit = new AppKit();
  return _kit;
}

/**
 * Tạo Viem adapter từ PRIVATE_KEY trong env.
 * Lưu ý: private key chỉ tồn tại trên server.
 */
export function getAdapter() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY chưa được cấu hình trong .env.local");
  }
  return createViemAdapterFromPrivateKey({
    privateKey: privateKey as `0x${string}`,
  });
}

export function getKitKey(): string {
  const kitKey = process.env.KIT_KEY;
  if (!kitKey) {
    throw new Error("KIT_KEY chưa được cấu hình (cần cho tính năng Swap)");
  }
  return kitKey;
}

// Supported chains — đối chiếu với docs Arc
export const CHAINS = [
  { id: "Arc_Testnet", label: "Arc Testnet", isTestnet: true },
  { id: "Ethereum_Sepolia", label: "Ethereum Sepolia", isTestnet: true },
  { id: "Avalanche_Fuji", label: "Avalanche Fuji", isTestnet: true },
] as const;

export type ChainId = (typeof CHAINS)[number]["id"];

// Supported tokens
export const TOKENS = ["USDC", "EURC"] as const;
export type Token = (typeof TOKENS)[number];
