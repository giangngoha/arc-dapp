"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { swapTokens, estimateSwapRate } from "./actions";
import TokenSelector, { type TokenInfo } from "@/components/TokenSelector";
import SwapSettings, { type SwapConfig } from "@/components/SwapSettings";
import { ARC_EXPLORER } from "@/lib/contracts";

export default function SwapPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [loading,    setLoading]    = useState(false);
  const [status,     setStatus]     = useState("");
  const [result,     setResult]     = useState<{
    success: boolean;
    txHash?: string;
    amountOut?: string;
    error?: string;
  } | null>(null);
  const [estimate,   setEstimate]   = useState<{
    estimatedAmountOut?: string;
    exchangeRate?: string;
    priceImpact?: string;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [tokenIn,    setTokenIn]    = useState<TokenInfo>({ symbol: "USDC" });
  const [tokenOut,   setTokenOut]   = useState<TokenInfo>({ symbol: "EURC" });
  const [settings,   setSettings]   = useState<SwapConfig>({ slippage: 0.5, gasPriceMode: "normal" });
  const [amountIn,   setAmountIn]   = useState("");
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const balIn  = wallet.connected ? getBal(wallet.balances, tokenIn.symbol)  : 0;
  const balOut = wallet.connected ? getBal(wallet.balances, tokenOut.symbol) : 0;
  const amtNum = parseFloat(amountIn) || 0;

  // Auto-estimate when amount/tokens change
  useEffect(() => {
    if (!amtNum || amtNum <= 0 || tokenIn.symbol === tokenOut.symbol) {
      setEstimate(null);
      return;
    }
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    estimateTimer.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const fd = new FormData();
        fd.set("chain", "Arc_Testnet");
        fd.set("tokenIn", tokenIn.symbol);
        fd.set("tokenOut", tokenOut.symbol);
        fd.set("amountIn", amountIn);
        const res = await estimateSwapRate(fd);
        if (res.success && res.data) {
          setEstimate(res.data as typeof estimate);
        } else {
          setEstimate(null);
        }
      } catch {
        setEstimate(null);
      } finally {
        setEstimating(false);
      }
    }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenIn.symbol, tokenOut.symbol]);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.connected) { openModal(); return; }
    if (!amtNum || tokenIn.symbol === tokenOut.symbol) return;

    setLoading(true); setStatus("Preparing swap…"); setResult(null);
    try {
      const fd = new FormData();
      fd.set("chain",     "Arc_Testnet");
      fd.set("tokenIn",   tokenIn.symbol);
      fd.set("tokenOut",  tokenOut.symbol);
      fd.set("amountIn",  amountIn);
      fd.set("toAddress", wallet.address); // ← KEY FIX: output goes to user wallet

      setStatus(`Swapping ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}…`);
      const res = await swapTokens(fd);

      if (res.success) {
        const d = res.data as any;
        const txHash    = d?.txHash    ?? d?.transactionHash ?? d?.hash ?? undefined;
        const amountOut = d?.amountOut ?? d?.estimatedAmountOut ?? estimate?.estimatedAmountOut ?? undefined;
        setResult({ success: true, txHash, amountOut });
        showToast(true, "Swap Confirmed ✓", `${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}`);
        setAmountIn("");
        setEstimate(null);
        // Refresh balance after a short delay to let chain settle
        setTimeout(() => refreshBalances(), 2000);
        await refreshBalances();
      } else {
        setResult({ success: false, error: res.error });
        showToast(false, "Swap Failed", res.error?.slice(0, 100) ?? "Unknown error");
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setResult({ success: false, error: msg.slice(0, 300) });
      showToast(false, "Swap Error", msg.slice(0, 100));
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  const impactColor = (v: string | undefined) => {
    if (!v) return "var(--text2)";
    const n = parseFloat(v);
    if (isNaN(n)) return "var(--text2)";
    return n < 1 ? "var(--green)" : n < 3 ? "#f59e0b" : "var(--red)";
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(0,200,150,0.15)", border: "1px solid rgba(0,200,150,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔄</div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Swap Exchange</h1>
          <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>Arc Testnet · Circle StableFX</p>
        </div>
        <div style={{ marginLeft: "auto" }}><SwapSettings config={settings} onChange={setSettings} /></div>
      </div>

      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, padding: "20px 20px 16px" }}>
        <form onSubmit={handleSwap}>
          {/* Sell box */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Sell (From)</span>
              {wallet.connected && (
                <span
                  style={{ fontSize: 12, color: "var(--cyan)", cursor: "pointer", fontFamily: "var(--mono)" }}
                  onClick={() => setAmountIn(balIn.toFixed(2))}
                >
                  Balance: <strong>{balIn.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="number" placeholder="0.0" step="0.01" min="0" value={amountIn}
                onChange={e => { setAmountIn(e.target.value); setResult(null); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)", minWidth: 0 }}
              />
              <TokenSelector label="" name="tokenIn" value={tokenIn} onChange={t => { setTokenIn(t); setResult(null); setEstimate(null); }} />
            </div>
          </div>

          {/* Flip button */}
          <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
            <button
              type="button"
              onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn(""); setEstimate(null); setResult(null); }}
              style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg1)", color: "var(--cyan)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}
            >⇅</button>
          </div>

          {/* Buy box */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>Buy (To)</span>
              {wallet.connected && (
                <span style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)" }}>
                  Balance: <strong style={{ color: "var(--text1)" }}>{balOut.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, fontSize: 28, fontWeight: 700, fontFamily: "var(--mono)", color: estimating ? "var(--text2)" : estimate?.estimatedAmountOut ? "var(--green)" : "var(--text2)" }}>
                {estimating ? "…" : estimate?.estimatedAmountOut ?? "0.0"}
              </div>
              <TokenSelector label="" name="tokenOut" value={tokenOut} onChange={t => { setTokenOut(t); setResult(null); setEstimate(null); }} />
            </div>
          </div>

          {/* Rate row */}
          {estimate && !estimating && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 12, fontFamily: "var(--mono)", color: "var(--text2)" }}>
              <span>1 {tokenIn.symbol} = {estimate.exchangeRate} {tokenOut.symbol}</span>
              <span style={{ color: impactColor(estimate.priceImpact) }}>
                Impact: {estimate.priceImpact}%
              </span>
            </div>
          )}

          {/* Status */}
          {loading && status && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
            </div>
          )}

          {/* Button */}
          {!wallet.connected ? (
            <button type="button" onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
          ) : (
            <button
              type="submit"
              disabled={loading || !amtNum || tokenIn.symbol === tokenOut.symbol}
              className={loading || !amtNum ? "swap-btn disabled-state" : "swap-btn ready"}
              style={{ margin: 0 }}
            >
              {loading && <span className="spinner" />}
              {loading ? "Swapping…" : amtNum > 0 ? `Swap ${tokenIn.symbol} → ${tokenOut.symbol}` : "Enter amount"}
            </button>
          )}
        </form>
      </div>

      {/* Result */}
      {result && (
        <div
          className="fade-in"
          style={{ marginTop: 14, background: "var(--bg1)", border: `1px solid ${result.success ? "rgba(0,200,150,0.3)" : "rgba(224,65,90,0.3)"}`, borderRadius: 16, padding: "16px 18px" }}
        >
          {result.success ? (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--green)", marginBottom: 6 }}>
                ✅ Swap Confirmed — TRANSFER EXECUTED
              </p>
              <div style={{ fontSize: 13, fontFamily: "var(--mono)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#2775CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>
                  {tokenIn.symbol.slice(0,2).toUpperCase()}
                </div>
                <strong style={{ color: "var(--text1)" }}>{amountIn} {tokenIn.symbol}</strong>
                <span style={{ color: "var(--text2)" }}>→</span>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#627EEA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>
                  {tokenOut.symbol.slice(0,2).toUpperCase()}
                </div>
                <strong style={{ color: "var(--cyan)" }}>{result.amountOut ?? estimate?.estimatedAmountOut ?? "?"} {tokenOut.symbol}</strong>
              </div>
              {result.txHash && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)" }}>TX: {result.txHash.slice(0,14)}…{result.txHash.slice(-6)}</span>
                  <a
                    href={`${ARC_EXPLORER}/tx/${result.txHash}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "var(--cyan)", textDecoration: "none" }}
                  >View on Explorer ↗</a>
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--green)", marginTop: 6 }}>✓ Confirmed</p>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--red)", marginBottom: 8 }}>❌ Swap Failed</p>
              <p style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{result.error}</p>
            </>
          )}
        </div>
      )}

      {/* Recent TX placeholder */}
      {!result && (
        <div style={{ marginTop: 14, background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px" }}>
          <p style={{ fontSize: 12, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text2)", display: "inline-block" }} />
            <strong>Recent Transaction</strong>
          </p>
          <p style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", marginTop: 4, lineHeight: 1.6 }}>
            Your most recent transaction will appear here. Each new TX replaces the previous one.
          </p>
        </div>
      )}
    </div>
  );
}
