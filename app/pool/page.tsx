"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance, fromUnits } from "@/lib/contracts";

// ─── Contracts ────────────────────────────────────────────────────────────────
const ROUTER = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const PAIR   = "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb"; // USDC/EURC LP token
const USDC   = CONTRACTS.USDC;
const EURC   = CONTRACTS.EURC;
const MAX_U256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// ─── ABI Encoders ─────────────────────────────────────────────────────────────
// addLiquidity(tokenA, tokenB, amtADesired, amtBDesired, amtAMin, amtBMin, to, deadline)
function encodeAddLiquidity(
  tokenA: string, tokenB: string,
  amtA: bigint, amtB: bigint,
  amtAMin: bigint, amtBMin: bigint,
  to: string, deadline: bigint,
): string {
  const sel = "0xe8e33700";
  const p = (v: string | bigint, isAddr = false) =>
    isAddr
      ? (v as string).toLowerCase().replace("0x","").padStart(64,"0")
      : (v as bigint).toString(16).padStart(64,"0");
  return sel + p(tokenA,true) + p(tokenB,true) + p(amtA) + p(amtB) + p(amtAMin) + p(amtBMin) + p(to,true) + p(deadline);
}

// removeLiquidity(tokenA, tokenB, liquidity, amtAMin, amtBMin, to, deadline)
function encodeRemoveLiquidity(
  tokenA: string, tokenB: string,
  liquidity: bigint,
  amtAMin: bigint, amtBMin: bigint,
  to: string, deadline: bigint,
): string {
  const sel = "0xbaa2abde";
  const p = (v: string | bigint, isAddr = false) =>
    isAddr
      ? (v as string).toLowerCase().replace("0x","").padStart(64,"0")
      : (v as bigint).toString(16).padStart(64,"0");
  return sel + p(tokenA,true) + p(tokenB,true) + p(liquidity) + p(amtAMin) + p(amtBMin) + p(to,true) + p(deadline);
}

// getReserves() → (uint112 reserve0, uint112 reserve1, uint32 blockTs)
function encodeGetReserves(): string { return "0x0902f1ac"; }
// totalSupply() → uint256
function encodeTotalSupply(): string { return "0x18160ddd"; }
// balanceOf(address) → uint256
function encodeBalanceOf(addr: string): string {
  return "0x70a08231" + addr.toLowerCase().replace("0x","").padStart(64,"0");
}

// ─── RPC helper ───────────────────────────────────────────────────────────────
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
  if (!eth) throw new Error("No wallet found.");
  const hex = "0x4cef52";
  let cur: string | undefined;
  try { cur = await eth.request({ method: "eth_chainId" }); } catch {}
  if (cur?.toLowerCase() === hex) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Arc Network Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: [ARC_EXPLORER] }] });
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
      if (r?.blockNumber) return r.status === "0x1" || r.status === 1;
    } catch {}
  }
  return false;
}

// ─── Pool state ───────────────────────────────────────────────────────────────
interface PoolInfo {
  reserveUSDC: number;
  reserveEURC: number;
  totalSupply: number;
  userLpBalance: number;
  userSharePct: number;
  userUSDC: number;
  userEURC: number;
}

type Tab = "add" | "remove";

// ─── Sub-components ───────────────────────────────────────────────────────────
function TI({ sym, bg, size = 26 }: { sym: string; bg: string; size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", background: bg, border: "2px solid var(--bg1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{sym === "cirBTC" ? "₿" : sym.slice(0, 2)}</div>;
}

function IR({ k, v, green, mono }: { k: string; v: string; green?: boolean; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", fontFamily: mono ? "var(--mono)" : undefined }}>
      <span style={{ color: "var(--text2)" }}>{k}</span>
      <span style={{ color: green ? "var(--green)" : "var(--text1)", fontWeight: 600 }}>{v}</span>
    </div>
  );
}

export default function PoolPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tab, setTab]       = useState<Tab>("add");
  const [poolInfo, setPool] = useState<PoolInfo | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [a0, setA0]         = useState("");  // USDC amount
  const [a1, setA1]         = useState("");  // EURC amount
  const [pct, setPct]       = useState(50);  // remove percentage
  const [slippage, setSlip] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [status, setStat]   = useState("");
  const [lastTx, setTx]     = useState<{ hash: string; action: string } | null>(null);

  const balUSDC = wallet.connected ? getBal(wallet.balances, "USDC") : 0;
  const balEURC = wallet.connected ? getBal(wallet.balances, "EURC") : 0;

  // ── Load pool data ──────────────────────────────────────────────────────────
  const loadPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const [resRaw, supRaw, userLpRaw] = await Promise.all([
        rpcCall("eth_call", [{ to: PAIR, data: encodeGetReserves() }, "latest"]),
        rpcCall("eth_call", [{ to: PAIR, data: encodeTotalSupply() }, "latest"]),
        wallet.connected
          ? rpcCall("eth_call", [{ to: PAIR, data: encodeBalanceOf(wallet.address) }, "latest"])
          : Promise.resolve("0x0"),
      ]);

      // Parse reserves — reserve0=USDC, reserve1=EURC (sorted by address)
      // USDC address < EURC address → USDC is token0
      const resHex = (resRaw as string).replace("0x", "");
      const reserveUSDC = resHex.length >= 64 ? Number(BigInt("0x" + resHex.slice(0, 64))) / 1e6 : 0;
      const reserveEURC = resHex.length >= 128 ? Number(BigInt("0x" + resHex.slice(64, 128))) / 1e6 : 0;

      const totalSupply = supRaw && supRaw !== "0x"
        ? Number(BigInt(supRaw as string)) / 1e18 : 0; // LP tokens use 18 decimals

      const userLpBalance = userLpRaw && userLpRaw !== "0x" && userLpRaw !== "0x0"
        ? Number(BigInt(userLpRaw as string)) / 1e18 : 0;

      const userSharePct = totalSupply > 0 ? (userLpBalance / totalSupply) * 100 : 0;
      const userUSDC = reserveUSDC * (userSharePct / 100);
      const userEURC = reserveEURC * (userSharePct / 100);

      setPool({ reserveUSDC, reserveEURC, totalSupply, userLpBalance, userSharePct, userUSDC, userEURC });
    } catch (e) {
      console.error("loadPool error:", e);
    } finally {
      setLoadingPool(false);
    }
  }, [wallet.connected, wallet.address]);

  useEffect(() => { loadPool(); }, [loadPool]);

  // Auto-calculate EURC when USDC entered (based on current ratio)
  function handleA0Change(v: string) {
    setA0(v);
    if (poolInfo && poolInfo.reserveUSDC > 0 && v) {
      const ratio = poolInfo.reserveEURC / poolInfo.reserveUSDC;
      setA1((parseFloat(v) * ratio).toFixed(6));
    }
  }
  function handleA1Change(v: string) {
    setA1(v);
    if (poolInfo && poolInfo.reserveEURC > 0 && v) {
      const ratio = poolInfo.reserveUSDC / poolInfo.reserveEURC;
      setA0((parseFloat(v) * ratio).toFixed(6));
    }
  }

  // ── Add Liquidity ───────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!wallet.connected) { openModal(); return; }
    const amtUSDC = parseFloat(a0) || 0;
    const amtEURC = parseFloat(a1) || 0;
    if (!amtUSDC || !amtEURC) return;

    setLoading(true); setStat(""); setTx(null);
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const amtURaw = toUnits(amtUSDC, 6);
      const amtERaw = toUnits(amtEURC, 6);
      const amtUMin = toUnits(amtUSDC * (1 - slippage / 100), 6);
      const amtEMin = toUnits(amtEURC * (1 - slippage / 100), 6);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // 1. Approve USDC
      setStat("Checking USDC allowance…");
      const allowU: any = await rpcCall("eth_call", [{ to: USDC, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
      if (!allowU || BigInt(allowU) < amtURaw) {
        setStat("Approving USDC — confirm in wallet…");
        const txU: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: USDC, data: encodeApprove(ROUTER, MAX_U256), gas: "0x186A0" }] });
        setStat("Waiting for USDC approval…");
        if (!await waitTx(txU)) throw new Error("USDC approve failed.");
        await new Promise(r => setTimeout(r, 2000));
      }

      // 2. Approve EURC
      setStat("Checking EURC allowance…");
      const allowE: any = await rpcCall("eth_call", [{ to: EURC, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
      if (!allowE || BigInt(allowE) < amtERaw) {
        setStat("Approving EURC — confirm in wallet…");
        const txE: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: EURC, data: encodeApprove(ROUTER, MAX_U256), gas: "0x186A0" }] });
        setStat("Waiting for EURC approval…");
        if (!await waitTx(txE)) throw new Error("EURC approve failed.");
        await new Promise(r => setTimeout(r, 2000));
      }

      // 3. addLiquidity
      setStat("Adding liquidity — confirm in wallet…");
      const data = encodeAddLiquidity(USDC, EURC, amtURaw, amtERaw, amtUMin, amtEMin, wallet.address, deadline);
      const txHash: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: ROUTER, data, gas: "0x493E0" }] });
      setStat("Waiting for confirmation…");
      const ok = await waitTx(txHash);
      if (!ok) throw new Error(`addLiquidity reverted. Check: ${ARC_EXPLORER}/tx/${txHash}`);

      setTx({ hash: txHash, action: "Add Liquidity" });
      showToast(true, "Liquidity Added ✓", `${amtUSDC} USDC + ${amtEURC} EURC`);
      setA0(""); setA1("");
      await refreshBalances();
      await loadPool();
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("4001") || /reject|denied|cancel/i.test(msg)) showToast(false, "Cancelled", "Rejected in wallet.");
      else showToast(false, "Failed", msg.slice(0, 120));
    } finally { setLoading(false); setStat(""); }
  }

  // ── Remove Liquidity ────────────────────────────────────────────────────────
  async function handleRemove() {
    if (!wallet.connected) { openModal(); return; }
    if (!poolInfo || poolInfo.userLpBalance <= 0) {
      showToast(false, "No liquidity", "You have no LP tokens in this pool.");
      return;
    }

    setLoading(true); setStat(""); setTx(null);
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const lpRaw    = BigInt(Math.floor(poolInfo.userLpBalance * (pct / 100) * 1e18));
      const expUSDC  = poolInfo.userUSDC * (pct / 100);
      const expEURC  = poolInfo.userEURC * (pct / 100);
      const minUSDC  = toUnits(expUSDC * (1 - slippage / 100), 6);
      const minEURC  = toUnits(expEURC * (1 - slippage / 100), 6);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // 1. Approve LP token (PAIR) to Router
      setStat("Checking LP token allowance…");
      const allowLP: any = await rpcCall("eth_call", [{ to: PAIR, data: encodeAllowance(wallet.address, ROUTER) }, "latest"]);
      if (!allowLP || BigInt(allowLP) < lpRaw) {
        setStat("Approving LP token — confirm in wallet…");
        const txLP: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: PAIR, data: encodeApprove(ROUTER, MAX_U256), gas: "0x186A0" }] });
        setStat("Waiting for LP approval…");
        if (!await waitTx(txLP)) throw new Error("LP token approve failed.");
        await new Promise(r => setTimeout(r, 2000));
      }

      // 2. removeLiquidity
      setStat(`Removing ${pct}% liquidity — confirm in wallet…`);
      const data = encodeRemoveLiquidity(USDC, EURC, lpRaw, minUSDC, minEURC, wallet.address, deadline);
      const txHash: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: ROUTER, data, gas: "0x493E0" }] });
      setStat("Waiting for confirmation…");
      const ok = await waitTx(txHash);
      if (!ok) throw new Error(`removeLiquidity reverted. Check: ${ARC_EXPLORER}/tx/${txHash}`);

      setTx({ hash: txHash, action: `Remove ${pct}% Liquidity` });
      showToast(true, `Removed ${pct}% ✓`, `~${expUSDC.toFixed(2)} USDC + ~${expEURC.toFixed(2)} EURC returned`);
      await refreshBalances();
      await loadPool();
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("4001") || /reject|denied|cancel/i.test(msg)) showToast(false, "Cancelled", "Rejected in wallet.");
      else showToast(false, "Failed", msg.slice(0, 120));
    } finally { setLoading(false); setStat(""); }
  }

  // ─── Tab button helper ────────────────────────────────────────────────────
  function TB(t: Tab, l: string) {
    const active = tab === t;
    return (
      <button onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 0, background: "transparent", color: active ? "var(--text0)" : "var(--text2)", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, cursor: "pointer", borderBottom: active ? "2px solid var(--cyan)" : "2px solid transparent", transition: "all 0.2s" }}>
        {l}
      </button>
    );
  }

  const rate = poolInfo && poolInfo.reserveUSDC > 0 ? poolInfo.reserveEURC / poolInfo.reserveUSDC : null;

  return (
    <div className="fade-in" style={{ padding: "20px 24px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 3 }}>Liquidity Pool</h1>
        <p style={{ fontSize: 13, color: "var(--text2)" }}>Uniswap V2 · USDC / EURC · Arc Testnet</p>
      </div>

      {/* Pool Stats Card */}
      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex" }}>
            <TI sym="USDC" bg="#2775CA" />
            <TI sym="EURC" bg="#2B5EDD" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>USDC / EURC</div>
            <div style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)" }}>Uniswap V2 · 0.3% fee</div>
          </div>
          <button onClick={loadPool} disabled={loadingPool} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", fontSize: 18, animation: loadingPool ? "spin .7s linear infinite" : "none" }}>↻</button>
        </div>

        {loadingPool ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text2)", fontFamily: "var(--mono)" }}>
            <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />Loading pool data…
          </div>
        ) : poolInfo ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Pool USDC</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--mono)" }}>{poolInfo.reserveUSDC.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
            <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Pool EURC</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--mono)" }}>{poolInfo.reserveEURC.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text2)" }}>Could not load pool data.</div>
        )}

        {rate && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)" }}>
            Rate: 1 USDC ≈ <strong style={{ color: "var(--text1)" }}>{rate.toFixed(6)} EURC</strong>
            <span style={{ marginLeft: 16 }}>1 EURC ≈ <strong style={{ color: "var(--text1)" }}>{(1 / rate).toFixed(6)} USDC</strong></span>
          </div>
        )}
      </div>

      {/* Your Position */}
      {wallet.connected && poolInfo && poolInfo.userLpBalance > 0 && (
        <div className="fade-in" style={{ background: "rgba(0,200,150,0.06)", border: "1px solid rgba(0,200,150,0.2)", borderRadius: 14, padding: "14px 18px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.6px", fontFamily: "var(--mono)", marginBottom: 10 }}>Your Position</div>
          <IR k="LP Tokens" v={poolInfo.userLpBalance.toFixed(8)} mono />
          <IR k="Pool Share" v={`${poolInfo.userSharePct.toFixed(4)}%`} mono />
          <IR k="USDC Value" v={`${poolInfo.userUSDC.toFixed(4)} USDC`} green mono />
          <IR k="EURC Value" v={`${poolInfo.userEURC.toFixed(4)} EURC`} green mono />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        {TB("add", "Add Liquidity")}
        {TB("remove", "Remove")}
      </div>

      {/* ── ADD LIQUIDITY TAB ── */}
      {tab === "add" && (
        <div className="fade-in" style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 20px 16px" }}>
          {/* Slippage */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Deposit amounts</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)" }}>Slippage:</span>
              {[0.1, 0.5, 1.0].map(s => (
                <button key={s} onClick={() => setSlip(s)} style={{ padding: "3px 7px", borderRadius: 6, border: "1px solid", borderColor: slippage === s ? "var(--cyan)" : "var(--border)", background: slippage === s ? "rgba(0,229,255,0.1)" : "var(--bg2)", color: slippage === s ? "var(--cyan)" : "var(--text2)", fontSize: 10, cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}>{s}%</button>
              ))}
            </div>
          </div>

          {/* USDC input */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><TI sym="USDC" bg="#2775CA" size={22} /><span style={{ fontWeight: 700, fontSize: 14 }}>USDC</span></div>
              {wallet.connected && <span style={{ fontSize: 12, color: "var(--cyan)", cursor: "pointer", fontFamily: "var(--mono)" }} onClick={() => handleA0Change(balUSDC.toFixed(2))}>Balance: <strong>{balUSDC.toFixed(4)}</strong></span>}
            </div>
            <input type="number" placeholder="0.0" step="0.01" min="0" value={a0} onChange={e => handleA0Change(e.target.value)}
              style={{ width: "100%", background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)" }} />
          </div>

          <div style={{ textAlign: "center", fontSize: 16, color: "var(--text2)", margin: "4px 0" }}>+</div>

          {/* EURC input */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><TI sym="EURC" bg="#2B5EDD" size={22} /><span style={{ fontWeight: 700, fontSize: 14 }}>EURC</span></div>
              {wallet.connected && <span style={{ fontSize: 12, color: "var(--cyan)", cursor: "pointer", fontFamily: "var(--mono)" }} onClick={() => handleA1Change(balEURC.toFixed(2))}>Balance: <strong>{balEURC.toFixed(4)}</strong></span>}
            </div>
            <input type="number" placeholder="0.0" step="0.01" min="0" value={a1} onChange={e => handleA1Change(e.target.value)}
              style={{ width: "100%", background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)" }} />
          </div>

          {/* Summary */}
          {(parseFloat(a0) > 0 && parseFloat(a1) > 0) && poolInfo && (
            <div className="fade-in" style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
              <IR k="USDC" v={`${a0}`} mono />
              <IR k="EURC" v={`${a1}`} mono />
              <IR k="Est. pool share" v={`${poolInfo.totalSupply > 0 ? ((parseFloat(a0) / (poolInfo.reserveUSDC + parseFloat(a0))) * 100).toFixed(4) : "100.0000"}%`} green mono />
              <IR k="Slippage tolerance" v={`${slippage}%`} mono />
            </div>
          )}

          {loading && status && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
            </div>
          )}

          {!wallet.connected
            ? <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button onClick={handleAdd} disabled={loading || !parseFloat(a0) || !parseFloat(a1)} className={loading || !parseFloat(a0) || !parseFloat(a1) ? "swap-btn disabled-state" : "swap-btn ready"} style={{ margin: 0 }}>
                {loading && <span className="spinner" />}
                {loading ? "Adding…" : "Add Liquidity"}
              </button>
          }
        </div>
      )}

      {/* ── REMOVE LIQUIDITY TAB ── */}
      {tab === "remove" && (
        <div className="fade-in" style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 20px 16px" }}>
          {!wallet.connected ? (
            <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
          ) : !poolInfo || poolInfo.userLpBalance <= 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>💧</div>
              <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 6 }}>No liquidity position</div>
              <div style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)" }}>Add liquidity first to earn fees.</div>
              <button onClick={() => setTab("add")} style={{ marginTop: 14, padding: "8px 20px", borderRadius: 10, border: "1px solid rgba(0,229,255,0.3)", background: "rgba(0,229,255,0.08)", color: "var(--cyan)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--mono)" }}>+ Add Liquidity</button>
            </div>
          ) : (
            <>
              {/* Slippage */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Remove amount</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)" }}>Slippage:</span>
                  {[0.1, 0.5, 1.0].map(s => (
                    <button key={s} onClick={() => setSlip(s)} style={{ padding: "3px 7px", borderRadius: 6, border: "1px solid", borderColor: slippage === s ? "var(--cyan)" : "var(--border)", background: slippage === s ? "rgba(0,229,255,0.1)" : "var(--bg2)", color: slippage === s ? "var(--cyan)" : "var(--text2)", fontSize: 10, cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}>{s}%</button>
                  ))}
                </div>
              </div>

              {/* Percentage slider */}
              <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text2)" }}>Percentage to remove</span>
                  <span style={{ fontSize: 26, fontWeight: 800, color: "var(--red)", fontFamily: "var(--mono)" }}>{pct}%</span>
                </div>
                <input type="range" min={1} max={100} value={pct} onChange={e => setPct(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--red)", marginBottom: 10 }} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                  {[25, 50, 75, 100].map(v => (
                    <button key={v} onClick={() => setPct(v)} style={{ padding: "8px 0", borderRadius: 8, border: "1px solid", borderColor: pct === v ? "var(--red)" : "var(--border)", background: pct === v ? "rgba(224,65,90,0.12)" : "var(--bg3)", color: pct === v ? "var(--red)" : "var(--text2)", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{v}%</button>
                  ))}
                </div>
              </div>

              {/* You will receive */}
              <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>You will receive (estimated)</div>
                <IR k="USDC" v={`~${(poolInfo.userUSDC * pct / 100).toFixed(4)}`} green mono />
                <IR k="EURC" v={`~${(poolInfo.userEURC * pct / 100).toFixed(4)}`} green mono />
                <IR k="LP burned" v={`${(poolInfo.userLpBalance * pct / 100).toFixed(8)}`} mono />
              </div>

              {loading && status && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
                  <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
                </div>
              )}

              <button onClick={handleRemove} disabled={loading} style={{ width: "100%", padding: 15, borderRadius: 12, border: "1px solid rgba(224,65,90,0.4)", background: loading ? "var(--bg3)" : "rgba(224,65,90,0.14)", color: loading ? "var(--text2)" : "var(--red)", fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: 0 }}>
                {loading && <span className="spinner" />}
                {loading ? "Removing…" : `Remove ${pct}% Liquidity`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Last TX */}
      {lastTx && (
        <div className="fade-in" style={{ marginTop: 14, background: "var(--bg1)", border: "1px solid rgba(0,200,150,0.25)", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{lastTx.action} ✓</span>
          </div>
          <a href={`${ARC_EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", textDecoration: "none" }}>{lastTx.hash.slice(0, 10)}…{lastTx.hash.slice(-6)} ↗</a>
        </div>
      )}
    </div>
  );
}