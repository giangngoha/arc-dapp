"use server";

import { getKit, getAdapter, getKitKey } from "@/lib/arc";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface SwapActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

const EURC_ADDR = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const USDC_ADDR = "0x3600000000000000000000000000000000000000" as `0x${string}`;

const ERC20_ABI = [
  { name: "transfer",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }],                                  outputs: [{ type: "uint256" }] },
] as const;

function makeClients(privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const transport = http("https://rpc.testnet.arc.network");
  const publicClient  = createPublicClient({ chain: arcChain, transport });
  const walletClient  = createWalletClient({ account, chain: arcChain, transport });
  return { account, publicClient, walletClient };
}

async function waitForTxReceipt(publicClient: any, txHash: string, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      if (receipt) return receipt;
    } catch {}
  }
  return null;
}

async function getBalance(publicClient: any, tokenAddr: `0x${string}`, walletAddr: `0x${string}`): Promise<bigint> {
  try {
    return await publicClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [walletAddr] });
  } catch { return 0n; }
}

export async function swapTokens(formData: FormData): Promise<SwapActionResult> {
  try {
    const chain     = formData.get("chain")     as string;
    const tokenIn   = formData.get("tokenIn")   as string;
    const tokenOut  = formData.get("tokenOut")  as string;
    const amountIn  = formData.get("amountIn")  as string;
    const toAddress = formData.get("toAddress") as string;

    if (!chain || !tokenIn || !tokenOut || !amountIn) return { success: false, error: "Missing fields." };
    if (tokenIn === tokenOut) return { success: false, error: "Tokens must be different." };
    if (!toAddress) return { success: false, error: "User wallet address required." };

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) return { success: false, error: "Server PRIVATE_KEY not configured in .env.local" };

    const { account, publicClient, walletClient } = makeClients(privateKey);
    const kit     = getKit();
    const adapter = getAdapter();
    const kitKey  = getKitKey();

    const tokenOutAddr = tokenOut === "EURC" ? EURC_ADDR : USDC_ADDR;

    // ── 1. Read balance BEFORE swap ──
    const balBefore = await getBalance(publicClient, tokenOutAddr, account.address);

    // ── 2. kit.swap() — server wallet làm maker, swap xảy ra on-chain ──
    const swapResult: any = await kit.swap({
      from:     { adapter, chain: chain as any },
      tokenIn:  tokenIn  as "USDC" | "EURC",
      tokenOut: tokenOut as "USDC" | "EURC",
      amountIn,
      config: { kitKey },
    });

    const swapTxHash: string = swapResult?.txHash ?? swapResult?.transactionHash ?? "";

    // ── 3. Đợi TX confirm on-chain ──
    if (swapTxHash) {
      await waitForTxReceipt(publicClient, swapTxHash);
    } else {
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── 4. Đọc balance AFTER swap — delta = số token nhận được ──
    const balAfter = await getBalance(publicClient, tokenOutAddr, account.address);
    let amountToTransfer = balAfter - balBefore;

    // Fallback nếu delta = 0 (estimate từ SDK)
    if (amountToTransfer <= 0n) {
      const estimatedOut = swapResult?.amountOut;
      if (estimatedOut) {
        // amountOut từ SDK có thể là string dạng "0.924500"
        amountToTransfer = BigInt(Math.round(parseFloat(String(estimatedOut)) * 1_000_000));
      }
    }

    if (amountToTransfer <= 0n) {
      return {
        success: false,
        error: `Swap completed (TX: ${swapTxHash}) nhưng không đọc được số token nhận. Server wallet có thể chưa có đủ ${tokenOut}. Kiểm tra balance server wallet và nạp thêm ${tokenOut} từ faucet.`,
        data: { swapTxHash },
      };
    }

    // ── 5. Transfer tokenOut từ server wallet → user wallet ──
    const transferTxHash = await walletClient.writeContract({
      address: tokenOutAddr,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, amountToTransfer],
    });

    // Đợi transfer confirm
    await waitForTxReceipt(publicClient, transferTxHash);

    const amountOutFormatted = (Number(amountToTransfer) / 1_000_000).toFixed(6);

    return {
      success: true,
      data: {
        swapTxHash,
        transferTxHash,
        amountOut: amountOutFormatted,
        tokenOut,
        toAddress,
      },
    };

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
      from:     { adapter, chain: chain as any },
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
