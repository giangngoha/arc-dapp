"use server";
// app/send/actions.ts – Server Action để gọi Arc SDK

import { getKit, getAdapter } from "@/lib/arc";
import type { SendParams } from "@circle-fin/app-kit";

export interface SendActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function sendTokens(formData: FormData): Promise<SendActionResult> {
  try {
    const chain = formData.get("chain") as string;
    const recipient = formData.get("recipient") as string;
    const amount = formData.get("amount") as string;
    const token = formData.get("token") as string;

    if (!chain || !recipient || !amount || !token) {
      return { success: false, error: "Vui lòng điền đầy đủ thông tin" };
    }

    const kit = getKit();
    const adapter = getAdapter();

    const params: SendParams = {
      from: { adapter, chain: chain as Parameters<typeof kit.send>[0]["from"]["chain"] },
      to: recipient as `0x${string}`,
      amount,
      token: token as "USDC" | "EURC",
    };

    // Estimate trước khi gửi
    await kit.estimateSend(params);

    // Thực hiện gửi
    const result = await kit.send(params);
    return { success: true, data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
