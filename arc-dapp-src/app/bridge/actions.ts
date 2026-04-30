"use server";

import { getKit, getAdapter } from "@/lib/arc";

export interface BridgeActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function bridgeTokens(formData: FormData): Promise<BridgeActionResult> {
  try {
    const fromChain = formData.get("fromChain") as string;
    const toChain = formData.get("toChain") as string;
    const amount = formData.get("amount") as string;

    if (!fromChain || !toChain || !amount) {
      return { success: false, error: "Vui lòng điền đầy đủ thông tin" };
    }

    if (fromChain === toChain) {
      return { success: false, error: "Chain nguồn và đích không được trùng nhau" };
    }

    const kit = getKit();
    const adapter = getAdapter();

    // Bridge USDC giữa 2 EVM chains
    // Cùng adapter cho cả 2 chain — bridge sẽ gửi đến cùng địa chỉ ví
    const result = await kit.bridge({
      from: { adapter, chain: fromChain as Parameters<typeof kit.bridge>[0]["from"]["chain"] },
      to: { adapter, chain: toChain as Parameters<typeof kit.bridge>[0]["to"]["chain"] },
      amount,
    });

    return { success: true, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function estimateBridge(formData: FormData): Promise<BridgeActionResult> {
  try {
    const fromChain = formData.get("fromChain") as string;
    const toChain = formData.get("toChain") as string;
    const amount = formData.get("amount") as string;

    if (!fromChain || !toChain || !amount) {
      return { success: false, error: "Thiếu thông tin để ước tính" };
    }

    const kit = getKit();
    const adapter = getAdapter();

    const estimate = await kit.estimateBridge({
      from: { adapter, chain: fromChain as Parameters<typeof kit.bridge>[0]["from"]["chain"] },
      to: { adapter, chain: toChain as Parameters<typeof kit.bridge>[0]["to"]["chain"] },
      amount,
    });

    return { success: true, data: estimate };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
