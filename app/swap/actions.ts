"use server";

import { getKit, getAdapter, getKitKey } from "@/lib/arc";

export interface SwapActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function swapTokens(formData: FormData): Promise<SwapActionResult> {
  try {
    const chain      = formData.get("chain")      as string;
    const tokenIn    = formData.get("tokenIn")    as string;
    const tokenOut   = formData.get("tokenOut")   as string;
    const amountIn   = formData.get("amountIn")   as string;
    const toAddress  = formData.get("toAddress")  as string | null; // user wallet address

    if (!chain || !tokenIn || !tokenOut || !amountIn) {
      return { success: false, error: "Please fill in all required fields" };
    }
    if (tokenIn === tokenOut) {
      return { success: false, error: "Token In and Token Out must be different" };
    }

    const kit    = getKit();
    const adapter = getAdapter();
    const kitKey = getKitKey();

    const result = await kit.swap({
      from:     { adapter, chain: chain as Parameters<typeof kit.swap>[0]["from"]["chain"] },
      tokenIn:  tokenIn  as "USDC" | "EURC",
      tokenOut: tokenOut as "USDC" | "EURC",
      amountIn,
      // KEY FIX: send output tokens to the user's wallet, not the server wallet
      ...(toAddress ? { to: toAddress as `0x${string}` } : {}),
      config: { kitKey },
    });

    return { success: true, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function estimateSwapRate(formData: FormData): Promise<SwapActionResult> {
  try {
    const chain    = formData.get("chain")    as string;
    const tokenIn  = formData.get("tokenIn")  as string;
    const tokenOut = formData.get("tokenOut") as string;
    const amountIn = formData.get("amountIn") as string;

    const kit     = getKit();
    const adapter = getAdapter();
    const kitKey  = getKitKey();

    const estimate = await kit.estimateSwap({
      from:     { adapter, chain: chain as Parameters<typeof kit.swap>[0]["from"]["chain"] },
      tokenIn:  tokenIn  as "USDC" | "EURC",
      tokenOut: tokenOut as "USDC" | "EURC",
      amountIn,
      config: { kitKey },
    });

    return { success: true, data: estimate };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
