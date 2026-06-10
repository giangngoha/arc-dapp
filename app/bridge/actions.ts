"use server";
import { getKit, getAdapter, hasCredentials, CHAIN_DEFS } from "@/lib/arc";

export interface BridgeResult {
  success: boolean;
  data?: unknown;
  error?: string;
  needsKey?: boolean;
}

export async function estimateBridge(formData: FormData): Promise<BridgeResult> {
  const fromId = formData.get("fromChain") as string;
  const toId   = formData.get("toChain")   as string;
  const amount = formData.get("amount")    as string;

  if (!fromId || !toId || !amount) return { success:false, error:"Missing fields." };
  if (fromId === toId) return { success:false, error:"Source and destination must differ." };

  const fromChain = CHAIN_DEFS[fromId];
  const toChain   = CHAIN_DEFS[toId];
  if (!fromChain) return { success:false, error:`Unsupported source chain: ${fromId}` };
  if (!toChain)   return { success:false, error:`Unsupported destination chain: ${toId}` };

  if (!hasCredentials()) {
    return {
      success: true,
      needsKey: true,
      data: {
        note: "Mock estimate — add credentials to .env.local for real fees.",
        fees: [{ type:"network", amount:"~0.001", token:"USDC" }],
        estimatedTime: "~5–15 minutes",
        from: fromId, to: toId, amount,
      },
    };
  }

  try {
    const kit     = getKit();
    const adapter = getAdapter();
    const result  = await kit.estimateBridge({
      from: { adapter, chain: fromChain as any },
      to:   { adapter, chain: toChain   as any },
      amount,
    });
    return { success:true, data: result };
  } catch (err) {
    return { success:false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function bridgeTokens(formData: FormData): Promise<BridgeResult> {
  const fromId    = formData.get("fromChain")  as string;
  const toId      = formData.get("toChain")    as string;
  const amount    = formData.get("amount")     as string;
  const recipient = formData.get("recipient")  as string | null;

  if (!fromId || !toId || !amount) return { success:false, error:"Missing fields." };
  if (fromId === toId) return { success:false, error:"Source and destination must differ." };
  if (parseFloat(amount) <= 0) return { success:false, error:"Amount must be > 0." };

  const fromChain = CHAIN_DEFS[fromId];
  const toChain   = CHAIN_DEFS[toId];
  if (!fromChain) return { success:false, error:`Unsupported source chain: ${fromId}` };
  if (!toChain)   return { success:false, error:`Unsupported destination chain: ${toId}` };

  if (!hasCredentials()) {
    return {
      success: false,
      needsKey: true,
      error: "PRIVATE_KEY and KIT_KEY required in .env.local",
    };
  }

  try {
    const kit     = getKit();
    const adapter = getAdapter();

    const params: Parameters<typeof kit.bridge>[0] = {
      from: { adapter, chain: fromChain as any },
      to:   { adapter, chain: toChain   as any },
      amount,
    };

    // Optional custom recipient address on destination chain
    if (recipient && /^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      (params as unknown as Record<string, unknown>).recipientAddress = recipient;
    }

    const result = await kit.bridge(params);
    return { success:true, data: result };
  } catch (err) {
    return { success:false, error: err instanceof Error ? err.message : String(err) };
  }
}
