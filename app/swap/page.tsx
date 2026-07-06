"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

// ─── Uniswap V2 on Arc Testnet (deployed by osr21/arc-swap) ──────────────────
const ROUTER   = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const PAIR     = "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb";
const USDC     = CONTRACTS.USDC;
const EURC     = CONTRACTS.EURC;
const MAX_U256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// Arc Testnet quirk: eth_estimateGas is broken — use explicit gas limits
const GAS_APPROVE = "0x186A0";   // 100,000
const GAS_SWAP    = "0x3D090";   // 250,000

// getAmountsOut(uint256 amountIn, address[] path) → uint256[]
function encodeGetAmountsOut(amtIn: bigint, tokenIn: string, tokenOut: string): string {
  const sel    = "0xd06ca61f";
  const offset = (64).toString(16).padStart(64, "0"); // offset to array
  const len    = (2).toString(16).padStart(64, "0");  // 2 addresses
  const a0     = tokenIn.toLowerCase().replace("0x","").padStart(64,"0");
  const a1     = tokenOut.toLowerCase().replace("0x","").padStart(64,"0");
  return sel + amtIn.toString(16).padStart(64,"0") + offset + len + a0 + a1;
}

// swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
function encodeSwap(amtIn: bigint, amtOutMin: bigint, tokenIn: string, tokenOut: string, to: string, deadline: bigint): string {
  const sel     = "0x38ed1739";
  const pathOff = (5 * 32).toString(16).padStart(64,"0"); // offset: after 5 fixed params
  const len     = (2).toString(16).padStart(64,"0");
  const a0      = tokenIn.toLowerCase().replace("0x","").padStart(64,"0");
  const a1      = tokenOut.toLowerCase().replace("0x","").padStart(64,"0");
  return (
    sel +
    amtIn.toString(16).padStart(64,"0") +
    amtOutMin.toString(16).padStart(64,"0") +
    pathOff +
    to.toLowerCase().replace("0x","").padStart(64,"0") +
    deadline.toString(16).padStart(64,"0") +
    len + a0 + a1
  );
}

// getReserves() → (uint112,uint112,uint32)
function encodeGetReserves(): string { return "0x0902f1ac"; }

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch("https://rpc.testnet.arc.network", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}

async function switchToArc() {
  const eth = (window as any).ethereum;
  const hex = "0x4cef52";
  let cur: string | undefined;
  try { cur = await eth.request({ method: "eth_chainId" }); } catch {}
  if (cur?.toLowerCase() === hex) return;
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
  catch (e: any) {
    if (e.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Arc Network Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    else throw e;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    try { const c = await eth.request({ method: "eth_chainId" }); if (c?.toLowerCase() === hex) return; } catch {}
  }
}

async function waitTx(hash: string, maxMs = 90000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r: any = await rpcCall("eth_getTransactionReceipt", [hash]);
      if (r && r.blockNumber) {
        // Got receipt - check status
        return r.status === "0x1" || r.status === 1;
      }
    } catch {}
  }
  return false;
}

export default function SwapPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tokenIn,  setTokenIn]  = useState<"USDC"|"EURC">("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [estimate, setEstimate] = useState<{ amtOut: string; rate: string; impact: string } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState("");
  const [result,   setResult]   = useState<{ success: boolean; txHash?: string; amountOut?: string; error?: string } | null>(null);
  const [slippage, setSlippage] = useState(0.5);
  const [reserves, setReserves] = useState<{ usdc: number; eurc: number } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>|null>(null);

  const tokenOut = tokenIn === "USDC" ? "EURC" : "USDC";
  const tokenInAddr  = tokenIn  === "USDC" ? USDC : EURC;
  const tokenOutAddr = tokenOut === "USDC" ? USDC : EURC;
  const balIn  = wallet.connected ? getBal(wallet.balances, tokenIn)  : 0;
  const balOut = wallet.connected ? getBal(wallet.balances, tokenOut) : 0;
  const amtNum = parseFloat(amountIn) || 0;

  // Load reserves from pair contract
  useEffect(() => {
    rpcCall("eth_call", [{ to: PAIR, data: encodeGetReserves() }, "latest"])
      .then((r: any) => {
        if (!r || r === "0x") return;
        const hex = r.replace("0x","");
        // getReserves returns (reserve0, reserve1, blockTimestamp) each padded to 32 bytes
        // reserve0 = USDC (first token in pair), reserve1 = EURC
        const r0 = parseInt(hex.slice(0,64), 16) / 1e6;
        const r1 = parseInt(hex.slice(64,128), 16) / 1e6;
        setReserves({ usdc: r0, eurc: r1 });
      }).catch(() => {});
  }, []);

  // Auto-estimate via getAmountsOut
  useEffect(() => {
    if (!amtNum || amtNum <= 0) { setEstimate(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const amtInRaw = toUnits(amtNum, 6);
        const data = encodeGetAmountsOut(amtInRaw, tokenInAddr, tokenOutAddr);
        const r: any = await rpcCall("eth_call", [{ to: ROUTER, data }, "latest"]);
        if (!r || r === "0x") { setEstimate(null); return; }
        const hex = r.replace("0x","");
        // Returns: [offset(32), length(32), amounts[0](32), amounts[1](32)]
        const amtOutRaw = BigInt("0x" + hex.slice(192, 256));
        const amtOut = Number(amtOutRaw) / 1e6;
        const rate = (amtOut / amtNum).toFixed(6);
        const impact = (Math.abs(1 - amtOut / amtNum) * 100).toFixed(2);
        setEstimate({ amtOut: amtOut.toFixed(6), rate, impact });
      } catch { setEstimate(null); }
      finally { setEstimating(false); }
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenIn]);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.connected) { openModal(); return; }
    if (!amtNum) return;
    setLoading(true); setStatus(""); setResult(null);
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const amtInRaw   = toUnits(amtNum, 6);
      const amtOutNum  = estimate ? parseFloat(estimate.amtOut) : amtNum * 0.9;
      const amtOutMin  = toUnits(amtOutNum * (1 - slippage / 100), 6);
      const deadline   = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

      // ── 1. Check & approve Router ──
      setStatus("Checking allowance…");
      const allowRaw: any = await rpcCall("eth_call", [{ to: tokenInAddr, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
      const allowance = allowRaw && allowRaw !== "0x" ? BigInt(allowRaw) : 0n;

      if (allowance < amtInRaw) {
        setStatus(`Approving ${tokenIn} — confirm in wallet…`);
        const approveTx: string = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: tokenInAddr, data: encodeApprove(ROUTER, MAX_U256), gas: GAS_APPROVE }],
        });
        setStatus("Waiting for approval to confirm on Arc…");
        const approveOk = await waitTx(approveTx, 90000);
        if (!approveOk) throw new Error(`Approve TX not confirmed. Hash: ${approveTx}`);
        // Extra wait for Arc to process state change
        setStatus("Approve confirmed, preparing swap…");
        await new Promise(r => setTimeout(r, 3000));
        // Verify allowance actually updated
        const newAllowRaw: any = await rpcCall("eth_call", [{ to: tokenInAddr, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
        const newAllow = newAllowRaw && newAllowRaw !== "0x" ? BigInt(newAllowRaw) : 0n;
        if (newAllow < amtInRaw) throw new Error(`Allowance not updated after approve. Got: ${Number(newAllow)/1e6}, needed: ${amtNum}`);
      }

      // ── 2. swapExactTokensForTokens ──
      setStatus(`Swapping ${tokenIn} → ${tokenOut} — confirm in wallet…`);
      const swapData = encodeSwap(amtInRaw, amtOutMin, tokenInAddr, tokenOutAddr, wallet.address, deadline);
      const swapTx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: ROUTER, data: swapData, gas: GAS_SWAP }],
      });
      setStatus("Waiting for swap confirmation…");
      const ok = await waitTx(swapTx);
      if (!ok) throw new Error(`Swap reverted. Check: ${ARC_EXPLORER}/tx/${swapTx}`);

      setResult({ success: true, txHash: swapTx, amountOut: estimate?.amtOut });
      showToast(true, "Swap Confirmed ✓", `${amtNum} ${tokenIn} → ~${estimate?.amtOut ?? "?"} ${tokenOut}`);
      setAmountIn(""); setEstimate(null);
      setTimeout(() => refreshBalances(), 1500);
      await refreshBalances();
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("4001") || /reject|denied|cancel/i.test(msg)) {
        showToast(false, "Cancelled", "Rejected in wallet.");
        setResult({ success: false, error: "User rejected." });
      } else {
        setResult({ success: false, error: msg.slice(0, 300) });
        showToast(false, "Swap Failed", msg.slice(0, 80));
      }
    } finally { setLoading(false); setStatus(""); }
  }

  const impactColor = (v: string) => {
    const n = parseFloat(v);
    return n < 1 ? "var(--green)" : n < 3 ? "#f59e0b" : "var(--red)";
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(0,200,150,0.15)", border: "1px solid rgba(0,200,150,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔄</div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Swap Exchange</h1>
          <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>Uniswap V2 AMM · Arc Testnet</p>
        </div>
        {/* Slippage selector */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[0.1, 0.5, 1.0].map(s => (
            <button key={s} onClick={() => setSlippage(s)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid", borderColor: slippage===s ? "var(--cyan)" : "var(--border)", background: slippage===s ? "rgba(0,229,255,0.1)" : "var(--bg2)", color: slippage===s ? "var(--cyan)" : "var(--text2)", fontSize: 11, cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}>
              {s}%
            </button>
          ))}
        </div>
      </div>

      {/* Pool reserves */}
      {reserves && (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 14px", marginBottom: 12, display: "flex", gap: 20, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text2)" }}>
          <span>Pool: <strong style={{ color: "var(--text1)" }}>{reserves.usdc.toFixed(2)} USDC</strong></span>
          <span>/ <strong style={{ color: "var(--text1)" }}>{reserves.eurc.toFixed(2)} EURC</strong></span>
          <span style={{ marginLeft: "auto" }}>Rate: 1 USDC ≈ {(reserves.eurc / reserves.usdc).toFixed(4)} EURC</span>
        </div>
      )}

      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, padding: "20px 20px 16px" }}>
        <form onSubmit={handleSwap}>
          {/* Sell box */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Sell (From)</span>
              {wallet.connected && <span style={{ fontSize: 12, color: "var(--cyan)", cursor: "pointer", fontFamily: "var(--mono)" }} onClick={() => setAmountIn(balIn.toFixed(2))}>Balance: <strong>{balIn.toFixed(4)}</strong></span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" placeholder="0.0" step="0.01" min="0" value={amountIn}
                onChange={e => { setAmountIn(e.target.value); setResult(null); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)", minWidth: 0 }} />
              <div style={{ display: "flex", gap: 6 }}>
                {(["USDC","EURC"] as const).map(t => (
                  <button key={t} type="button" onClick={() => { if(tokenIn!==t){setTokenIn(t);setAmountIn("");setEstimate(null);setResult(null);}}}
                    style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid", borderColor: tokenIn===t ? "var(--cyan)" : "var(--border)", background: tokenIn===t ? "rgba(0,229,255,0.1)" : "var(--bg3)", color: tokenIn===t ? "var(--cyan)" : "var(--text1)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Flip */}
          <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
            <button type="button" onClick={() => { setTokenIn(tokenOut as "USDC"|"EURC"); setAmountIn(""); setEstimate(null); setResult(null); }}
              style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg1)", color: "var(--cyan)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>⇅</button>
          </div>

          {/* Buy box */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Buy (To)</span>
              {wallet.connected && <span style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)" }}>Balance: <strong style={{ color: "var(--text1)" }}>{balOut.toFixed(4)}</strong></span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, fontSize: 28, fontWeight: 700, fontFamily: "var(--mono)", color: estimating ? "var(--text2)" : estimate ? "var(--green)" : "var(--text2)" }}>
                {estimating ? "…" : estimate?.amtOut ?? "0.0"}
              </div>
              <div style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid var(--cyan)", background: "rgba(0,229,255,0.1)", color: "var(--cyan)", fontWeight: 700, fontSize: 13 }}>{tokenOut}</div>
            </div>
          </div>

          {/* Rate + impact */}
          {estimate && !estimating && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 12, fontFamily: "var(--mono)", color: "var(--text2)" }}>
              <span>1 {tokenIn} = {estimate.rate} {tokenOut}</span>
              <span style={{ color: impactColor(estimate.impact) }}>Impact: {estimate.impact}%</span>
            </div>
          )}

          {/* Status */}
          {loading && status && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
            </div>
          )}

          {/* Button */}
          {!wallet.connected
            ? <button type="button" onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button type="submit" disabled={loading || !amtNum} className={loading || !amtNum ? "swap-btn disabled-state" : "swap-btn ready"} style={{ margin: 0 }}>
                {loading && <span className="spinner" />}
                {loading ? "Swapping…" : amtNum > 0 ? `Swap ${amtNum} ${tokenIn} → ${tokenOut}` : "Enter amount"}
              </button>
          }
        </form>
      </div>

      {/* Result */}
      {result && (
        <div className="fade-in" style={{ marginTop: 14, background: "var(--bg1)", border: `1px solid ${result.success ? "rgba(0,200,150,0.3)" : "rgba(224,65,90,0.3)"}`, borderRadius: 16, padding: "16px 18px" }}>
          {result.success ? (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--green)", marginBottom: 8 }}>✅ Swap Confirmed</p>
              <p style={{ fontSize: 13, fontFamily: "var(--mono)", marginBottom: 6 }}>
                Received: <strong style={{ color: "var(--green)" }}>~{result.amountOut} {tokenOut}</strong>
              </p>
              {result.txHash && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)" }}>
                  <span style={{ color: "var(--text2)" }}>TX: {result.txHash.slice(0,14)}…{result.txHash.slice(-6)}</span>
                  <a href={`${ARC_EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)", textDecoration: "none" }}>View on Explorer ↗</a>
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--red)", marginBottom: 8 }}>❌ Swap Failed</p>
              <p style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{result.error}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}