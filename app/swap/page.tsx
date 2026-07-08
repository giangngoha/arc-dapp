"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

// ─── YOUR Uniswap V2 Pool on Arc Testnet ─────────────────────────────────────
const ROUTER = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const PAIR   = "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb";
const MAX_U256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const GAS_APPROVE = "0x186A0";
const GAS_SWAP    = "0x493E0";

// Known tokens
const KNOWN_TOKENS: Record<string, { address: string; decimals: number; color: string; label: string }> = {
  USDC:   { address: CONTRACTS.USDC,   decimals: 6, color: "#2775CA", label: "USDC"   },
  EURC:   { address: CONTRACTS.EURC,   decimals: 6, color: "#2B5EDD", label: "EURC"   },
  cirBTC: { address: CONTRACTS.cirBTC, decimals: 8, color: "#F7931A", label: "cirBTC" },
};

function encodeGetAmountsOut(amtIn: bigint, t0: string, t1: string): string {
  const sel = "0xd06ca61f";
  const off = (64).toString(16).padStart(64, "0");
  const len = (2).toString(16).padStart(64, "0");
  const a0  = t0.toLowerCase().replace("0x","").padStart(64,"0");
  const a1  = t1.toLowerCase().replace("0x","").padStart(64,"0");
  return sel + amtIn.toString(16).padStart(64,"0") + off + len + a0 + a1;
}

function encodeSwap(amtIn: bigint, amtOutMin: bigint, t0: string, t1: string, to: string, deadline: bigint): string {
  const pathOff = (5*32).toString(16).padStart(64,"0");
  const len = (2).toString(16).padStart(64,"0");
  const a0  = t0.toLowerCase().replace("0x","").padStart(64,"0");
  const a1  = t1.toLowerCase().replace("0x","").padStart(64,"0");
  return "0x38ed1739" +
    amtIn.toString(16).padStart(64,"0") +
    amtOutMin.toString(16).padStart(64,"0") +
    pathOff +
    to.toLowerCase().replace("0x","").padStart(64,"0") +
    deadline.toString(16).padStart(64,"0") +
    len + a0 + a1;
}

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

async function waitTx(hash: string, maxWait = 90000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r: any = await rpcCall("eth_getTransactionReceipt", [hash]);
      if (r && r.blockNumber) return r.status === "0x1" || r.status === 1;
    } catch {}
  }
  return false;
}

// Token selector dropdown
function TokenDropdown({ value, onChange, exclude }: {
  value: string; onChange: (sym: string, addr: string) => void; exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const tok = KNOWN_TOKENS[value];
  const isCustom = !tok;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--bg3)", cursor: "pointer", minWidth: 100 }}>
        {tok && <div style={{ width: 20, height: 20, borderRadius: "50%", background: tok.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>{tok.label.slice(0,2).toUpperCase()}</div>}
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text1)" }}>{isCustom ? value.slice(0,6)+"…" : value}</span>
        <svg width="8" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 12, minWidth: 180, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}>
          {Object.entries(KNOWN_TOKENS).filter(([sym]) => sym !== exclude).map(([sym, t]) => (
            <button key={sym} type="button"
              onClick={() => { onChange(sym, t.address); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", border: "none", background: value === sym ? "var(--bg2)" : "transparent", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg2)")}
              onMouseLeave={e => (e.currentTarget.style.background = value === sym ? "var(--bg2)" : "transparent")}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>{t.label.slice(0,2).toUpperCase()}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text1)" }}>{sym}</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>{t.address.slice(0,10)}…</div>
              </div>
              {value === sym && <span style={{ marginLeft: "auto", color: "var(--cyan)", fontSize: 12 }}>✓</span>}
            </button>
          ))}
          {/* Custom token */}
          <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)" }}>
            <p style={{ fontSize: 10, color: "var(--text2)", marginBottom: 6, fontFamily: "var(--mono)" }}>Custom contract address</p>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="0x..."
                style={{ flex: 1, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", fontSize: 11, color: "var(--text1)", outline: "none", fontFamily: "var(--mono)" }} />
              <button type="button"
                onClick={() => { if (custom.startsWith("0x") && custom.length === 42) { onChange(custom, custom); setOpen(false); setCustom(""); } }}
                style={{ padding: "5px 10px", borderRadius: 8, border: "none", background: "var(--cyan)", color: "#000", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SwapPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tokenIn,    setTokenIn]    = useState<string>("USDC");
  const [tokenInAddr, setTokenInAddr] = useState<string>(CONTRACTS.USDC);
  const [tokenOut,   setTokenOut]   = useState<string>("EURC");
  const [tokenOutAddr, setTokenOutAddr] = useState<string>(CONTRACTS.EURC);
  const [amountIn,   setAmountIn]   = useState("");
  const [estimate,   setEstimate]   = useState<{ amtOut: string; rate: string } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [status,     setStatus]     = useState("");
  const [result,     setResult]     = useState<{ success: boolean; txHash?: string; amountOut?: string; error?: string } | null>(null);
  const [slippage,   setSlippage]   = useState(0.5);
  const [rate,       setRate]       = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const decimalsIn  = KNOWN_TOKENS[tokenIn]?.decimals  ?? 6;
  const decimalsOut = KNOWN_TOKENS[tokenOut]?.decimals ?? 6;
  const balIn  = wallet.connected ? getBal(wallet.balances, tokenIn)  : 0;
  const balOut = wallet.connected ? getBal(wallet.balances, tokenOut) : 0;
  const amtNum = parseFloat(amountIn) || 0;

  // Fetch rate from pool
  useEffect(() => {
    rpcCall("eth_call", [{ to: PAIR, data: "0x0902f1ac" }, "latest"])
      .then((r: any) => {
        if (!r || r === "0x") return;
        const hex = r.replace("0x","");
        const r0 = parseInt(hex.slice(0,64), 16) / 1e6;
        const r1 = parseInt(hex.slice(64,128), 16) / 1e6;
        if (r0 > 0) setRate(`1 USDC ≈ ${(r1/r0).toFixed(4)} EURC`);
      }).catch(() => {});
  }, []);

  // Auto-estimate
  useEffect(() => {
    if (!amtNum || amtNum <= 0 || tokenInAddr.toLowerCase() === tokenOutAddr.toLowerCase()) { setEstimate(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const amtInRaw = toUnits(amtNum, decimalsIn);
        const data = encodeGetAmountsOut(amtInRaw, tokenInAddr, tokenOutAddr);
        const r: any = await rpcCall("eth_call", [{ to: ROUTER, data }, "latest"]);
        if (!r || r === "0x") { setEstimate(null); return; }
        const hex = r.replace("0x","");
        const amtOutRaw = BigInt("0x" + hex.slice(192, 256));
        const amtOut = Number(amtOutRaw) / 10 ** decimalsOut;
        const rateVal = amtNum > 0 ? (amtOut / amtNum).toFixed(6) : "—";
        setEstimate({ amtOut: amtOut.toFixed(6), rate: rateVal });
      } catch { setEstimate(null); }
      finally { setEstimating(false); }
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenIn, tokenOut]);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.connected) { openModal(); return; }
    if (!amtNum || tokenInAddr.toLowerCase() === tokenOutAddr.toLowerCase()) return;
    setLoading(true); setStatus(""); setResult(null);
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const amtInRaw  = toUnits(amtNum, decimalsIn);
      const amtOutNum = estimate ? parseFloat(estimate.amtOut) : amtNum * 0.9;
      const amtOutMin = toUnits(amtOutNum * (1 - slippage / 100), decimalsOut);
      const deadline  = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Check & approve
      setStatus("Checking allowance…");
      const allowRaw: any = await rpcCall("eth_call", [{ to: tokenInAddr, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
      const allowance = allowRaw && allowRaw !== "0x" ? BigInt(allowRaw) : 0n;

      if (allowance < amtInRaw) {
        setStatus(`Approving ${tokenIn} — confirm in wallet…`);
        const approveTx: string = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: tokenInAddr, data: encodeApprove(ROUTER, MAX_U256), gas: GAS_APPROVE }],
        });
        setStatus("Waiting for approval…");
        const approveOk = await waitTx(approveTx, 90000);
        if (!approveOk) throw new Error("Approve failed.");
        await new Promise(r => setTimeout(r, 2000));
      }

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

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#00e5ff,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff", boxShadow: "0 0 16px rgba(0,229,255,0.4)" }}>🔄</div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Swap Exchange</h1>
          {rate && <p style={{ fontSize: 11, color: "var(--cyan)", margin: 0, fontFamily: "var(--mono)" }}>{rate}</p>}
        </div>
        {/* Slippage */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[0.1, 0.5, 1.0].map(s => (
            <button key={s} type="button" onClick={() => setSlippage(s)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid", borderColor: slippage===s ? "var(--cyan)" : "var(--border)", background: slippage===s ? "rgba(0,229,255,0.1)" : "var(--bg2)", color: slippage===s ? "var(--cyan)" : "var(--text2)", fontSize: 11, cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}>
              {s}%
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, padding: "20px 20px 16px" }}>
        <form onSubmit={handleSwap}>
          {/* FROM */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>From</span>
              {wallet.connected && (
                <span style={{ fontSize: 12, color: "var(--cyan)", cursor: "pointer", fontFamily: "var(--mono)" }}
                  onClick={() => setAmountIn(balIn.toFixed(4))}>
                  Balance: <strong>{balIn.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" placeholder="0.0" step="any" min="0" value={amountIn}
                onChange={e => { setAmountIn(e.target.value); setResult(null); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)", minWidth: 0 }} />
              <TokenDropdown value={tokenIn} exclude={tokenOut}
                onChange={(sym, addr) => { setTokenIn(sym); setTokenInAddr(addr); setResult(null); setEstimate(null); }} />
            </div>
          </div>

          {/* Flip */}
          <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
            <button type="button"
              onClick={() => { setTokenIn(tokenOut); setTokenInAddr(tokenOutAddr); setTokenOut(tokenIn); setTokenOutAddr(tokenInAddr); setAmountIn(""); setEstimate(null); setResult(null); }}
              style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg1)", color: "var(--cyan)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>⇅</button>
          </div>

          {/* TO */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>To</span>
              {wallet.connected && (
                <span style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)" }}>
                  Balance: <strong style={{ color: "var(--text1)" }}>{balOut.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, fontSize: 28, fontWeight: 700, fontFamily: "var(--mono)", color: estimating ? "var(--text2)" : estimate ? "var(--green)" : "var(--text2)" }}>
                {estimating ? "…" : estimate?.amtOut ?? "0.0"}
              </div>
              <TokenDropdown value={tokenOut} exclude={tokenIn}
                onChange={(sym, addr) => { setTokenOut(sym); setTokenOutAddr(addr); setResult(null); setEstimate(null); }} />
            </div>
            {estimate && !estimating && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)" }}>
                1 {tokenIn} = {estimate.rate} {tokenOut}
              </div>
            )}
          </div>

          {/* Status */}
          {loading && status && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
            </div>
          )}

          {/* Button */}
          {!wallet.connected
            ? <button type="button" onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button type="submit" disabled={loading || !amtNum || tokenInAddr === tokenOutAddr}
                className={loading || !amtNum ? "swap-btn disabled-state" : "swap-btn ready"} style={{ margin: 0 }}>
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
              {result.amountOut && <p style={{ fontSize: 13, fontFamily: "var(--mono)", marginBottom: 6 }}>Received: <strong style={{ color: "var(--green)" }}>~{result.amountOut} {tokenOut}</strong></p>}
              {result.txHash && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)" }}>
                  <span style={{ color: "var(--text2)" }}>TX: {result.txHash.slice(0,14)}…{result.txHash.slice(-6)}</span>
                  <a href={`${ARC_EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)", textDecoration: "none" }}>View ↗</a>
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