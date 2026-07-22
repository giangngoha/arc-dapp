"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_RPC, ARC_CHAIN_HEX, ARC_EXPLORER } from "@/lib/contracts";

// ─── Contract addresses ───────────────────────────────────────────────────────
// TODO: replace with actual deployed address after running DeployMatrixFarm.s.sol
const MASTER_CHEF = "0x66f4ea09cdcad01061e1e13ab29c48ee05e9e5c4";

const USDC = "0x3600000000000000000000000000000000000000";

// Pool definitions matching the on-chain addPool() order
const POOL_DEFS = [
  {
    pid:     0,
    label:   "USDC / EURC",
    lpToken: "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb",
    tokenA:  "USDC",  tokenB:  "EURC",
    colorA:  "#2775CA", colorB: "#2B5EDD",
    pairAddr:"0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb",
    // Both stablecoins ≈ $1, so LP price ≈ 2 × reserveA / totalSupply
    stablePair: true,
  },
  {
    pid:     1,
    label:   "USDC / cirBTC",
    lpToken: "0xa1d507a9662012bd43bf1ba5e03989d750a8c069",
    tokenA:  "USDC",  tokenB:  "cirBTC",
    colorA:  "#2775CA", colorB: "#F7931A",
    pairAddr:"0xa1d507a9662012bd43bf1ba5e03989d750a8c069",
    stablePair: false,
  },
  {
    pid:     2,
    label:   "EURC / cirBTC",
    lpToken: "0x4404ec28d88768e3d36c3f8b981f662aba09d1c0",
    tokenA:  "EURC",  tokenB:  "cirBTC",
    colorA:  "#2B5EDD", colorB: "#F7931A",
    pairAddr:"0x4404ec28d88768e3d36c3f8b981f662aba09d1c0",
    stablePair: false,
  },
];

// ─── ABI encoders ─────────────────────────────────────────────────────────────

// ERC-20
function encodeBalanceOf(addr: string): string {
  return "0x70a08231" + addr.toLowerCase().replace("0x","").padStart(64,"0");
}
function encodeAllowance(owner: string, spender: string): string {
  return "0xdd62ed3e" + owner.toLowerCase().replace("0x","").padStart(64,"0") + spender.toLowerCase().replace("0x","").padStart(64,"0");
}
function encodeApprove(spender: string, amount: bigint): string {
  return "0x095ea7b3" + spender.toLowerCase().replace("0x","").padStart(64,"0") + amount.toString(16).padStart(64,"0");
}

// MatrixFarm view calls
function encodePendingReward(pid: number, user: string): string {
  return "0xf40f0f52" + pid.toString(16).padStart(64,"0") + user.toLowerCase().replace("0x","").padStart(64,"0");
}
function encodeUserInfo(pid: number, user: string): string {
  return "0x93f1a40b" + pid.toString(16).padStart(64,"0") + user.toLowerCase().replace("0x","").padStart(64,"0");
}
function encodePoolInfo(pid: number): string {
  return "0x1526fe27" + pid.toString(16).padStart(64,"0");
}
// MatrixFarm write calls
function encodeStake(pid: number, amount: bigint): string {
  return "0x7b0472f0" + pid.toString(16).padStart(64,"0") + amount.toString(16).padStart(64,"0");
}
function encodeUnstake(pid: number, amount: bigint): string {
  return "0x9e2c8a5b" + pid.toString(16).padStart(64,"0") + amount.toString(16).padStart(64,"0");
}
function encodeClaim(pid: number): string {
  return "0x379607f5" + pid.toString(16).padStart(64,"0");
}
// Uniswap V2 pair
function encodeTotalSupply(): string { return "0x18160ddd"; }
function encodeGetReserves(): string { return "0x0902f1ac"; }

// Safely parse RPC hex result as BigInt
function safeBigInt(hex: unknown): bigint {
  try {
    if (!hex || hex === "0x" || hex === "0x0") return 0n;
    return BigInt(hex as string);
  } catch { return 0n; }
}

// Format LP token amount for display.
// LP tokens use 18 decimals but are tiny numbers — show in a readable way:
// - If >= 0.000001: show up to 6 significant digits
// - If < 0.000001: show scientific notation (e.g. 1.11e-7)
// Raw bigint is always used for actual contract calls — this is display only.
function fmtLP(raw: bigint): string {
  if (raw === 0n) return "0";
  const n = Number(raw) / 1e18;
  if (n >= 0.000001) return n.toPrecision(6).replace(/\.?0+$/, "");
  // Scientific notation for very small values
  return n.toExponential(4);
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────
// Single RPC call with retry on rate limit / timeout.
async function rpcCall(method: string, params: unknown[], attempt = 0): Promise<unknown> {
  try {
    const res = await fetch(ARC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc:"2.0", id: Date.now(), method, params }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json();
    if (j.error) {
      const msg: string = j.error.message ?? "RPC error";
      if (/rate|limit|too many|reached/i.test(msg) && attempt < 4) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        return rpcCall(method, params, attempt + 1);
      }
      throw new Error(msg);
    }
    return j.result;
  } catch (e: any) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      return rpcCall(method, params, attempt + 1);
    }
    throw e;
  }
}

// Batch multiple eth_call requests into a single HTTP request.
// Drastically reduces the number of round-trips and avoids rate limiting.
async function ethCallBatch(calls: { to: string; data: string }[], attempt = 0): Promise<string[]> {
  try {
    const body = calls.map((c, i) => ({
      jsonrpc: "2.0", id: i,
      method: "eth_call",
      params: [{ to: c.to, data: c.data }, "latest"],
    }));
    const res = await fetch(ARC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    // Response is an array ordered by id
    if (!Array.isArray(j)) throw new Error("Batch response not array");
    const isRateLimit = j.some((r: any) => /rate|limit|too many|reached/i.test(r?.error?.message ?? ""));
    if (isRateLimit && attempt < 4) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      return ethCallBatch(calls, attempt + 1);
    }
    return j.map((r: any) => (r?.result as string) ?? "0x");
  } catch (e: any) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      return ethCallBatch(calls, attempt + 1);
    }
    return calls.map(() => "0x");
  }
}

async function ethCall(to: string, data: string): Promise<string> {
  const results = await ethCallBatch([{ to, data }]);
  return results[0] ?? "0x";
}

// Wait for a transaction to be mined
async function waitTx(hash: string, maxMs = 90000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r: any = await rpcCall("eth_getTransactionReceipt", [hash]);
      if (r?.status) return r.status === "0x1";
    } catch {}
  }
  return false;
}

// Ensure wallet is on Arc Testnet before sending transactions
async function ensureArcChain(): Promise<void> {
  const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
  const cur: string = await eth.request({ method: "eth_chainId" });
  if (cur.toLowerCase() !== ARC_CHAIN_HEX.toLowerCase()) {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
    await new Promise(r => setTimeout(r, 1000));
  }
}

// ─── BTC price cache ──────────────────────────────────────────────────────────
let _btcPrice = 95000; // default fallback
let _btcFetchedAt = 0;
async function getBtcPrice(): Promise<number> {
  if (Date.now() - _btcFetchedAt < 5 * 60 * 1000) return _btcPrice;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    if (j?.bitcoin?.usd) { _btcPrice = j.bitcoin.usd; _btcFetchedAt = Date.now(); }
  } catch {}
  return _btcPrice;
}

// ─── Farm pool state ──────────────────────────────────────────────────────────
interface PoolState {
  pid:           number;
  totalStaked:   bigint; // LP tokens staked in MatrixFarm
  userStaked:    bigint; // user's staked LP tokens
  userLpBal:     bigint; // user's unstaked LP token balance
  pendingReward: bigint; // USDC claimable (6 decimals)
  allocPoint:    bigint;
  farmApr:       number | null; // annualised % based on reward rate and TVL
  tvlUSD:        number;
}

// ─── Token symbol badges ──────────────────────────────────────────────────────
function TokenBadge({ sym, color }: { sym: string; color: string }) {
  return (
    <div style={{ width: 22, height: 22, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
      {sym.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Single pool card ─────────────────────────────────────────────────────────
function PoolCard({
  def, state, onRefresh, expanded, onToggle,
}: {
  def: typeof POOL_DEFS[0];
  state: PoolState | null;
  onRefresh: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { wallet, openModal } = useWallet();
  const [stakeInput,   setStakeInput]   = useState("");
  const [unstakeInput, setUnstakeInput] = useState("");
  const [loading,      setLoading]      = useState<"stake"|"unstake"|"claim"|null>(null);

  const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
  const lpBal   = state ? Number(state.userLpBal)   / 1e18 : 0;
  const staked  = state ? Number(state.userStaked)  / 1e18 : 0;
  const pending = state ? Number(state.pendingReward) / 1e6 : 0;

  async function handleStake() {
    if (!wallet.connected) { openModal(); return; }
    const amt = parseFloat(stakeInput);
    if (!amt || amt <= 0) return;
    // Guard: prevent staking more than wallet balance — avoids ds-math-sub-underflow on contract
    if (amt > lpBal) {
      showToast(false, "Insufficient LP balance", `You have ${fmtLP(state?.userLpBal ?? 0n)} LP in wallet`);
      return;
    }
    setLoading("stake");
    try {
      await ensureArcChain();
      const amtRaw = BigInt(Math.floor(amt * 1e18));

      // Check and approve LP token if needed
      const allowHex = await ethCall(def.lpToken, encodeAllowance(wallet.address, MASTER_CHEF));
      if (safeBigInt(allowHex) < amtRaw) {
        showToast(true, "Approving LP token…", "Confirm in wallet");
        // Approve large amount — avoids MetaMask NFT approval warning
        const approveTx: string = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: def.lpToken, data: encodeApprove(MASTER_CHEF, BigInt(2) ** BigInt(128)), gas: "0x186A0" }],
        });
        if (!await waitTx(approveTx)) throw new Error("LP approve failed");
      }

      showToast(true, "Staking LP tokens…", "Confirm in wallet");
      const tx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: MASTER_CHEF, data: encodeStake(def.pid, amtRaw), gas: "0x493E0" }],
      });
      if (!await waitTx(tx)) throw new Error("Stake transaction failed");
      showToast(true, "Staked ✓", `${amt.toFixed(6)} LP tokens staked in ${def.label} farm`);
      setStakeInput("");
      onRefresh();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!msg.includes("4001") && !/reject|cancel/i.test(msg)) showToast(false, "Stake failed", msg.slice(0,100));
    } finally { setLoading(null); }
  }

  async function handleUnstake() {
    if (!wallet.connected) { openModal(); return; }
    const amt = parseFloat(unstakeInput);
    if (!amt || amt <= 0) return;
    setLoading("unstake");
    try {
      await ensureArcChain();
      const amtRaw = BigInt(Math.floor(amt * 1e18));
      showToast(true, "Unstaking…", "Confirm in wallet");
      const tx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: MASTER_CHEF, data: encodeUnstake(def.pid, amtRaw), gas: "0x493E0" }],
      });
      if (!await waitTx(tx)) throw new Error("Unstake failed");
      showToast(true, "Unstaked ✓", `${amt.toFixed(6)} LP tokens returned to wallet`);
      setUnstakeInput("");
      onRefresh();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!msg.includes("4001") && !/reject|cancel/i.test(msg)) showToast(false, "Unstake failed", msg.slice(0,100));
    } finally { setLoading(null); }
  }

  async function handleClaim() {
    if (!wallet.connected) { openModal(); return; }
    if (pending <= 0) return;
    setLoading("claim");
    try {
      await ensureArcChain();
      showToast(true, "Claiming reward…", "Confirm in wallet");
      const tx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: MASTER_CHEF, data: encodeClaim(def.pid), gas: "0x30D40" }],
      });
      if (!await waitTx(tx)) throw new Error("Claim failed");
      showToast(true, "Claimed ✓", `${pending.toFixed(4)} USDC added to your wallet`);
      onRefresh();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!msg.includes("4001") && !/reject|cancel/i.test(msg)) showToast(false, "Claim failed", msg.slice(0,100));
    } finally { setLoading(null); }
  }

  const apr = state?.farmApr;
  const tvl = state?.tvlUSD ?? 0;

  return (
    <div className="fade-in" style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, overflow: "hidden" }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", cursor: "pointer", userSelect: "none" }}
      >
        {/* LP token icon pair */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <TokenBadge sym={def.tokenA} color={def.colorA} />
          <div style={{ marginLeft: -6, zIndex: 1 }}>
            <TokenBadge sym={def.tokenB} color={def.colorB} />
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{def.label}</div>
          <div style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", marginTop: 2 }}>
            Uniswap V2 · 0.3% fee · Earn USDC
          </div>
        </div>

        {/* APR */}
        <div style={{ textAlign: "right", minWidth: 90 }}>
          <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 2 }}>Farm APR</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: apr && apr > 0 ? "var(--green)" : "var(--text2)", fontFamily: "var(--mono)" }}>
            {apr == null ? "—" : apr > 0 ? `${apr.toFixed(1)}%` : "—"}
          </div>
        </div>

        {/* TVL */}
        <div style={{ textAlign: "right", minWidth: 80 }}>
          <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 2 }}>TVL Staked</div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--mono)" }}>
            {tvl > 0 ? `$${tvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
          </div>
        </div>

        {/* Expand indicator */}
        <div style={{ color: "var(--text2)", fontSize: 18, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "" }}>⌄</div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="fade-in" style={{ borderTop: "1px solid var(--border)", padding: "18px 20px", display: "flex", gap: 16, flexWrap: "wrap" }}>

          {/* ── User stats ── */}
          <div style={{ display: "flex", gap: 12, width: "100%", flexWrap: "wrap" }}>
            {[
              { label: "Your staked",   value: state ? fmtLP(state.userStaked) + " LP" : "0 LP" },
              { label: "LP in wallet",  value: state ? fmtLP(state.userLpBal) + " LP" : "…" },
              { label: "Pending USDC",  value: pending > 0 ? pending.toFixed(6) + " USDC" : "0 USDC",  highlight: pending > 0 },
            ].map(({ label, value, highlight }) => (
              <div key={label} style={{ flex: 1, minWidth: 120, background: "var(--bg2)", borderRadius: 12, padding: "10px 14px" }}>
                <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)", color: highlight ? "var(--green)" : "var(--text0)" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── Claim reward ── */}
          {wallet.connected && pending > 0 && (
            <div style={{ width: "100%" }}>
              <button
                disabled={loading === "claim"}
                onClick={handleClaim}
                style={{ width: "100%", padding: "12px 0", borderRadius: 14, border: "none", background: "linear-gradient(90deg, var(--green), #00e5a0)", color: "#000", fontWeight: 800, fontSize: 14, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                {loading === "claim" && <span className="spinner" style={{ borderTopColor: "#000" }} />}
                Claim {pending.toFixed(4)} USDC
              </button>
            </div>
          )}

          {/* ── Stake form ── */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Stake LP</div>
            {/* Percentage quick-select buttons */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => {
                    // Use raw bigint value from state for precision — avoid floating point issues
                    const rawBal = state?.userLpBal ?? 0n;
                    if (rawBal <= 0n) return;
                    const amt = (rawBal * BigInt(pct) / 100n);
                    setStakeInput((Number(amt) / 1e18).toFixed(18).replace(/\.?0+$/, ""));
                  }}
                  style={{ flex: 1, padding: "4px 0", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--cyan)", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "var(--bg2)")}
                >{pct === 100 ? "MAX" : `${pct}%`}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, display: "flex", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 12px", alignItems: "center", gap: 8 }}>
                <input
                  type="number" placeholder="0.00000000" min="0" step="0.000001"
                  value={stakeInput}
                  onChange={e => setStakeInput(e.target.value)}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text0)", fontSize: 14, fontFamily: "var(--mono)", minWidth: 0 }}
                />
              </div>
              <button
                disabled={!stakeInput || parseFloat(stakeInput) <= 0 || loading === "stake"}
                onClick={handleStake}
                style={{ padding: "8px 18px", borderRadius: 12, border: "none", background: stakeInput && parseFloat(stakeInput) > 0 ? "var(--cyan)" : "var(--bg3)", color: stakeInput && parseFloat(stakeInput) > 0 ? "#000" : "var(--text2)", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              >
                {loading === "stake" && <span className="spinner" style={{ borderTopColor: "#000" }} />}
                Stake
              </button>
            </div>
            {lpBal > 0 && (
              <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4, fontFamily: "var(--mono)" }}>
                Wallet: {fmtLP(state?.userLpBal ?? 0n)} LP
              </div>
            )}
            {lpBal === 0 && wallet.connected && (
              <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4, fontFamily: "var(--mono)" }}>
                No LP tokens in wallet —{" "}
                <a href="/pool" style={{ color: "var(--cyan)", textDecoration: "none" }}>add liquidity first ↗</a>
                {" · "}
                <span onClick={onRefresh} style={{ color: "var(--cyan)", cursor: "pointer", textDecoration: "underline" }}>↺ </span>
              </div>
            )}
          </div>

          {/* ── Unstake form ── */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Unstake LP</div>
            {/* Percentage quick-select buttons */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => {
                    const rawStaked = state?.userStaked ?? 0n;
                    if (rawStaked <= 0n) return;
                    const amt = (rawStaked * BigInt(pct) / 100n);
                    setUnstakeInput((Number(amt) / 1e18).toFixed(18).replace(/\.?0+$/, ""));
                  }}
                  style={{ flex: 1, padding: "4px 0", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--red)", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "var(--bg2)")}
                >{pct === 100 ? "MAX" : `${pct}%`}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, display: "flex", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 12px", alignItems: "center", gap: 8 }}>
                <input
                  type="number" placeholder="0.00000000" min="0" step="0.000001"
                  value={unstakeInput}
                  onChange={e => setUnstakeInput(e.target.value)}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text0)", fontSize: 14, fontFamily: "var(--mono)", minWidth: 0 }}
                />
              </div>
              <button
                disabled={!unstakeInput || parseFloat(unstakeInput) <= 0 || staked <= 0 || loading === "unstake"}
                onClick={handleUnstake}
                style={{ padding: "8px 18px", borderRadius: 12, border: "none", background: unstakeInput && parseFloat(unstakeInput) > 0 && staked > 0 ? "var(--red)" : "var(--bg3)", color: unstakeInput && parseFloat(unstakeInput) > 0 && staked > 0 ? "#fff" : "var(--text2)", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              >
                {loading === "unstake" && <span className="spinner" />}
                Unstake
              </button>
            </div>
            {staked > 0 && (
              <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4, fontFamily: "var(--mono)" }}>
                Staked: {fmtLP(state?.userStaked ?? 0n)} LP
              </div>
            )}
          </div>

          {/* Info note */}
          <div style={{ width: "100%", fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", padding: "8px 12px", background: "var(--bg2)", borderRadius: 10 }}>
            💡 Unstaking also auto-claims your pending USDC reward.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function FarmPage() {
  const { wallet } = useWallet();
  const [poolStates, setPoolStates] = useState<(PoolState | null)[]>([null, null, null]);
  const [totalPending, setTotalPending] = useState(0);
  const [rewardBudget, setRewardBudget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPid, setExpandedPid] = useState<number | null>(null); // only one pool expanded at a time
  const isRunning = useRef(false); // prevent concurrent loadFarmData calls

  const isDeployed = true;

  const loadFarmData = useCallback(async () => {
    if (!isDeployed) return;
    if (isRunning.current) return; // skip if already running
    isRunning.current = true;
    setLoading(true);
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    try {
      const btcPrice = await getBtcPrice();

      // Fetch shared contract data once — avoids repeating same calls per pool
      const budgetHex = await ethCall(USDC, encodeBalanceOf(MASTER_CHEF));
      setRewardBudget(Number(safeBigInt(budgetHex)) / 1e6);
      await delay(150);

      const rpsHex = await ethCall(MASTER_CHEF, "0x9f1a5439"); // rewardPerSecond()
      await delay(150);
      const tapHex = await ethCall(MASTER_CHEF, "0x17caf6f1"); // totalAllocPoint()
      const rewardPerSec = Number(safeBigInt(rpsHex)) / 1e6;
      const totalAllocPt = Number(safeBigInt(tapHex));

      // Fetch pools sequentially with batch RPC per pool.
      // User-specific data (LP balance, pending reward) only fetched for the expanded pool
      // to minimize RPC calls — other pools only fetch public data (reserves, TVL).
      const states: (PoolState | null)[] = [];
      for (const def of POOL_DEFS) {
        await delay(100);
        try {
          const isExpanded = expandedPid === def.pid;
          const baseCalls = [
            { to: MASTER_CHEF, data: encodePoolInfo(def.pid) },
            { to: def.lpToken,  data: encodeTotalSupply() },
            { to: def.pairAddr, data: encodeGetReserves() },
          ];
          // Only fetch user data for the currently expanded pool
          const userCalls = wallet.connected && isExpanded ? [
            { to: MASTER_CHEF, data: encodeUserInfo(def.pid, wallet.address) },
            { to: MASTER_CHEF, data: encodePendingReward(def.pid, wallet.address) },
            { to: def.lpToken,  data: encodeBalanceOf(wallet.address) },
          ] : [];

          const allResults = await ethCallBatch([...baseCalls, ...userCalls]);
          const [poolHex, supplyHex, reservesHex] = allResults;
          const userResults = allResults.slice(3);

          const d = poolHex.replace("0x","");
          const allocPoint  = safeBigInt("0x" + d.slice(64, 128));
          const totalStaked = safeBigInt("0x" + d.slice(192, 256));

          // Parse user data — only available for expanded pool
          let userStaked    = 0n;
          let pendingReward = 0n;
          let userLpBal     = 0n;
          if (wallet.connected && isExpanded && userResults.length === 3) {
            const ud = userResults[0].replace("0x","");
            userStaked    = safeBigInt("0x" + ud.slice(0, 64));
            pendingReward = safeBigInt(userResults[1]);
            userLpBal     = safeBigInt(userResults[2]);
          }
          const supply   = safeBigInt(supplyHex);
          const rd       = reservesHex.replace("0x","");
          const reserve0 = safeBigInt("0x" + rd.slice(0, 64));
          const reserve1 = safeBigInt("0x" + rd.slice(64, 128));

          let tvlStakedUSD = 0;
          if (supply > 0n && (reserve0 > 0n || reserve1 > 0n)) {
            let poolUSD: number;
            if (def.stablePair) {
              poolUSD = (Number(reserve0) + Number(reserve1)) / 1e6;
            } else if (def.tokenB === "cirBTC") {
              poolUSD = Number(reserve0) / 1e6 + Number(reserve1) / 1e8 * btcPrice;
            } else {
              poolUSD = Number(reserve0) / 1e6;
            }
            if (totalStaked > 0n) {
              const lpPriceUSD = poolUSD / (Number(supply) / 1e18);
              tvlStakedUSD = lpPriceUSD * (Number(totalStaked) / 1e18);
            }
          }

          // Farm APR — uses shared rewardPerSec and totalAllocPt fetched once above
          const thisAllocPt = Number(allocPoint);
          let farmApr: number | null = null;
          if (tvlStakedUSD > 0 && totalAllocPt > 0) {
            const poolShare        = thisAllocPt / totalAllocPt;
            const rewardPerYearUSD = rewardPerSec * poolShare * 86400 * 365;
            farmApr = (rewardPerYearUSD / tvlStakedUSD) * 100;
          }

            states.push({ pid: def.pid, totalStaked, userStaked, userLpBal, pendingReward, allocPoint, farmApr, tvlUSD: tvlStakedUSD });
          } catch { states.push(null); }
      }

      setPoolStates(states);
      const total = states.reduce((s, p) => s + (p ? Number(p.pendingReward) / 1e6 : 0), 0);
      setTotalPending(total);
    } catch (e) {
      console.error("Farm load error:", e);
    } finally {
      setLoading(false);
      isRunning.current = false;
    }
  }, [wallet.connected, wallet.address, isDeployed]);

  // Fetch user-specific data for a single pool immediately when it is expanded.
  // Uses MetaMask eth_call directly for LP balance as fallback when RPC is rate-limited.
  const loadPoolUserData = useCallback(async (pid: number) => {
    if (!wallet.connected || !isDeployed) return;
    const def = POOL_DEFS.find(d => d.pid === pid);
    if (!def) return;
    try {
      const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
      const addr = wallet.address;
      const balData = encodeBalanceOf(addr);

      // Fetch MasterChef data via batch RPC
      const chefResults = await ethCallBatch([
        { to: MASTER_CHEF, data: encodeUserInfo(pid, addr) },
        { to: MASTER_CHEF, data: encodePendingReward(pid, addr) },
      ]);
      const ud = chefResults[0].replace("0x","");
      const userStaked    = safeBigInt("0x" + ud.slice(0, 64));
      const pendingReward = safeBigInt(chefResults[1]);

      // Fetch LP balance via MetaMask directly — bypasses RPC rate limit entirely
      let userLpBal = 0n;
      try {
        const lpRaw: string = await eth.request({
          method: "eth_call",
          params: [{ to: def.lpToken, data: balData }, "latest"],
        });
        userLpBal = safeBigInt(lpRaw);
      } catch {
        // Fallback to RPC if MetaMask call fails
        const lpRpc = await ethCall(def.lpToken, balData);
        userLpBal = safeBigInt(lpRpc);
      }

      setPoolStates(prev => prev.map((s, i) =>
        i === pid && s !== null
          ? { ...s, userStaked, pendingReward, userLpBal }
          : s
      ));
    } catch (e) {
      console.error("loadPoolUserData error:", e);
    }
  }, [wallet.connected, wallet.address, isDeployed]);

  // Load on mount and every 30s
  useEffect(() => {
    loadFarmData();
    const t = setInterval(loadFarmData, 30000);
    return () => clearInterval(t);
  }, [loadFarmData]);

  // When a pool is expanded, immediately fetch its user data
  useEffect(() => {
    if (expandedPid !== null) loadPoolUserData(expandedPid);
  }, [expandedPid, loadPoolUserData]);

  // ── Not deployed yet banner ─────────────────────────────────────────────────
  if (!isDeployed) {
    return (
      <div className="fade-in" style={{ maxWidth: 560, margin: "40px auto", padding: "0 24px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>Farm</h1>
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24 }}>Stake LP tokens · Earn USDC rewards</p>
        <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>Farm contract not deployed yet</p>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, marginBottom: 16 }}>
            Deploy <code>MatrixFarm.sol</code> to Arc Testnet, then update <code>MASTER_CHEF</code> address in <code>app/farm/page.tsx</code>.
          </p>
          <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "12px 14px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--cyan)", lineHeight: 1.8 }}>
            <div>cd contracts</div>
            <div>forge script script/DeployMatrixFarm.s.sol \</div>
            <div>&nbsp;&nbsp;--rpc-url arc --broadcast --private-key $PRIVATE_KEY</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 760, margin: "0 auto", padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>Farm</h1>
        <p style={{ fontSize: 13, color: "var(--text2)" }}>Stake LP tokens · Earn USDC rewards · APR updates live</p>
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          {
            label: "Total Farm TVL",
            value: poolStates.reduce((s, p) => s + (p?.tvlUSD ?? 0), 0),
            format: (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          },
          {
            label: "Reward Budget",
            value: rewardBudget ?? 0,
            format: (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC`,
          },
          {
            label: "Your Total Pending",
            value: totalPending,
            format: (v: number) => `${v.toFixed(4)} USDC`,
            highlight: totalPending > 0,
          },
        ].map(({ label, value, format, highlight }) => (
          <div key={label} style={{ flex: 1, minWidth: 150, background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--mono)", color: (highlight as boolean) ? "var(--green)" : "var(--text0)" }}>
              {loading ? "…" : format(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Pool cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {POOL_DEFS.map((def, i) => (
          <PoolCard
            key={def.pid}
            def={def}
            state={poolStates[i]}
            onRefresh={() => { loadPoolUserData(def.pid); loadFarmData(); }}
            expanded={expandedPid === def.pid}
            onToggle={() => setExpandedPid(prev => prev === def.pid ? null : def.pid)}
          />
        ))}
      </div>

      {/* Info footer */}
      <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 14, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
        <strong style={{ color: "var(--text1)" }}>How it works:</strong>{" "}
        Add liquidity to any pool to receive LP tokens → stake LP tokens here to earn USDC rewards.
        Rewards accrue every second proportional to your share of the pool.
        Unstaking automatically claims your pending rewards.
        Farm APR decreases as more LP tokens are staked (more people = shared rewards).
      </div>
    </div>
  );
}