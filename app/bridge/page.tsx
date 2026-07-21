"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

// ─── Chain definitions ────────────────────────────────────────────────────────
const CHAINS = [
  {
    id: "Arc_Testnet", label: "Arc Testnet", sub: "Arc (0x4cef52)", color: "#00b4d8", icon: "arc",
    chainIdHex: "0x4cef52",
    usdc:        "0x3600000000000000000000000000000000000000",
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    transmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    rpc:         "https://rpc.testnet.arc.network",
    explorer:    "https://testnet.arcscan.app",
    domain:      26,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  },
  {
    id: "Ethereum_Sepolia", label: "Ethereum", sub: "Sepolia Testnet", color: "#627EEA", icon: "Ξ",
    chainIdHex: "0xaa36a7",
    usdc:        "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    transmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    rpc:         "https://ethereum-sepolia-rpc.publicnode.com",
    explorer:    "https://sepolia.etherscan.io",
    domain:      0,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
  {
    id: "Avalanche_Fuji", label: "Avalanche", sub: "Fuji Testnet", color: "#E84142", icon: "▲",
    chainIdHex: "0xa869",
    usdc:        "0x5425890298aed601595a70AB815c96711a31Bc65",
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    transmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    rpc:         "https://api.avax-test.network/ext/bc/C/rpc",
    explorer:    "https://testnet.snowtrace.io",
    domain:      1,
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  },
];
type Chain = typeof CHAINS[0];
type BridgeStep = "idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error";

// ─── Pending bridge entry (persisted to localStorage) ─────────────────────────
interface PendingBridge {
  id:           string;
  burnTxHash:   string;
  srcChainId:   string;
  destChainId:  string;
  srcDomain:    number;
  amount:       string;
  burnedAt:     number;
  fromExplorer: string;
  toExplorer:   string;
  status: "attesting" | "ready" | "minting" | "completed" | "failed";
  message?:     string;
  attestation?: string;
  mintTxHash?:  string;
}

const LS_KEY = "matrix_pending_bridges";

function loadPending(): PendingBridge[] {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}
function savePending(list: PendingBridge[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Constants ────────────────────────────────────────────────────────────────
// Large approval amount — avoids MAX_U256 which triggers NFT-style warning in MetaMask.
// 1 billion USDC (6 decimals) is large enough to never need re-approving in practice.
const LARGE_APPROVAL = BigInt(1_000_000_000) * BigInt(10 ** 6);

const DEST_CALLER_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MAX_FEE     = 500n;
const MIN_FINALITY = 1000;
const POLL_DELAY_MS   = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;

// ─── Safely parse an allowance RPC result as BigInt ──────────────────────────
function safeAllowance(raw: unknown): bigint {
  try {
    if (!raw || raw === "0x" || raw === "0x0") return 0n;
    return BigInt(raw as string);
  } catch { return 0n; }
}

// ─── ABI Encoders ─────────────────────────────────────────────────────────────
function encodeDepositForBurnV2(amount: bigint, destDomain: number, recipient: string, burnToken: string, maxFee: bigint, minFinalityThreshold: number): string {
  const recipientBytes32 = "000000000000000000000000" + recipient.toLowerCase().replace("0x", "");
  return (
    "0x8e0250ee" +
    amount.toString(16).padStart(64, "0") +
    destDomain.toString(16).padStart(64, "0") +
    recipientBytes32.padStart(64, "0") +
    burnToken.toLowerCase().replace("0x", "").padStart(64, "0") +
    DEST_CALLER_BYTES32.replace("0x", "") +
    maxFee.toString(16).padStart(64, "0") +
    minFinalityThreshold.toString(16).padStart(64, "0")
  );
}

function encodeReceiveMessage(message: string, attestation: string): string {
  const msgHex = message.replace("0x", "");
  const attHex = attestation.replace("0x", "");
  const msgLen = msgHex.length / 2;
  const attLen = attHex.length / 2;
  const msgPadded = msgHex.padEnd(Math.ceil(msgLen / 32) * 64, "0");
  const off2 = (64 + 32 + msgPadded.length / 2).toString(16).padStart(64, "0");
  const attPadded = attHex.padEnd(Math.ceil(attLen / 32) * 64, "0");
  return (
    "0x57ecfd28" +
    (64).toString(16).padStart(64, "0") +
    off2 +
    msgLen.toString(16).padStart(64, "0") + msgPadded +
    attLen.toString(16).padStart(64, "0") + attPadded
  );
}

// ─── RPC helpers ──────────────────────────────────────────────────────────────
async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}

async function switchToChain(chain: Chain) {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet found.");
  let cur: string | undefined;
  try { cur = await eth.request({ method: "eth_chainId" }); } catch {}
  if (cur?.toLowerCase() === chain.chainIdHex.toLowerCase()) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (e: any) {
    if (e.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: chain.chainIdHex, chainName: chain.label + " " + chain.sub, nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpc], blockExplorerUrls: [chain.explorer] }] });
    } else throw e;
  }
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const c = await eth.request({ method: "eth_chainId" }); if (c?.toLowerCase() === chain.chainIdHex.toLowerCase()) return; } catch {}
  }
  throw new Error(`Wallet did not switch to ${chain.label}. Please switch manually.`);
}

async function waitTxRpc(rpcUrl: string, hash: string, maxWait = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    try { const r: any = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [hash]); if (r?.status) return r.status === "0x1"; } catch {}
  }
  return false;
}

async function checkAllowance(rpcUrl: string, token: string, owner: string, spender: string): Promise<bigint> {
  try {
    const r: any = await rpcCall(rpcUrl, "eth_call", [{ to: token, data: encodeAllowance(owner, spender) }, "latest"]);
    return safeAllowance(r);
  } catch { return 0n; }
}

async function pollAttestationV2(srcDomain: number, burnTxHash: string, onStatus: (s: string) => void, maxWait = 1800000): Promise<{ message: string; attestation: string } | null> {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${srcDomain}?transactionHash=${burnTxHash}`;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    onStatus(`Waiting for Circle attestation… ${elapsedStr} elapsed`);
    await new Promise(r => setTimeout(r, 12000));
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        const j = await res.json();
        const msg = j?.messages?.[0];
        if (msg?.status === "complete" && msg?.attestation) return { message: msg.message as string, attestation: msg.attestation as string };
        if (msg?.status) onStatus(`Attestation status: ${msg.status} — ${elapsedStr} elapsed`);
      }
    } catch {}
  }
  return null;
}

async function checkAttestationOnce(srcDomain: number, burnTxHash: string): Promise<{ message: string; attestation: string } | null> {
  try {
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${srcDomain}?transactionHash=${burnTxHash}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const j = await res.json();
    const msg = j?.messages?.[0];
    if (msg?.status === "complete" && msg?.attestation) return { message: msg.message as string, attestation: msg.attestation as string };
  } catch {}
  return null;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

// Arc Network logo — uses the official Arc logo image from /public/arc-logo.png
function ArcIcon({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/arc-logo.png"
      alt="Arc Network"
      width={size}
      height={size}
      style={{ objectFit: "contain", display: "block" }}
    />
  );
}

// ─── Chain icon renderer ───────────────────────────────────────────────────────
function ChainIconContent({ chain, size = 36 }: { chain: Chain; size?: number }) {
  if (chain.icon === "arc") return <ArcIcon size={Math.round(size * 0.65)} />;
  return <span style={{ fontSize: size * 0.42, fontWeight: 800, color: "#fff" }}>{chain.icon}</span>;
}

// ─── UI components ─────────────────────────────────────────────────────────────
function ChainCard({ chain, selected, onClick }: { chain: Chain; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: "1px solid", borderColor: selected ? chain.color + "99" : "var(--border)", background: selected ? chain.color + "18" : "var(--bg2)", cursor: "pointer", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {/* Arc chain: show logo image directly without circle background */}
      {chain.icon === "arc" ? (
        <div style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArcIcon size={32} />
        </div>
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: selected ? chain.color : "var(--bg3)", border: `2px solid ${selected ? chain.color : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: selected ? `0 0 12px ${chain.color}44` : "none" }}>
          <ChainIconContent chain={chain} size={36} />
        </div>
      )}
      <span style={{ fontSize: 12, fontWeight: 700, color: selected ? "#fff" : "var(--text1)" }}>{chain.label}</span>
      <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: selected ? chain.color : "var(--text2)" }}>{chain.sub}</span>
    </button>
  );
}

// ─── History card (shows only completed bridges) ───────────────────────────────
function HistoryCard({
  bridge, onDismiss,
}: {
  bridge: PendingBridge;
  onDismiss: (id: string) => void;
}) {
  const src  = CHAINS.find(c => c.id === bridge.srcChainId)!;
  const dest = CHAINS.find(c => c.id === bridge.destChainId)!;

  return (
    <div className="fade-in" style={{ background: "transparent", border: "1px solid rgba(0,200,150,0.18)", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Chain icons — Arc shows logo directly, others use colored circle */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {src?.icon === "arc"
              ? <ArcIcon size={18} />
              : <div style={{ width: 18, height: 18, borderRadius: "50%", background: src?.color ?? "#888", display: "flex", alignItems: "center", justifyContent: "center" }}><ChainIconContent chain={src} size={18} /></div>
            }
            <span style={{ fontSize: 10, color: "var(--text2)" }}>→</span>
            {dest?.icon === "arc"
              ? <ArcIcon size={18} />
              : <div style={{ width: 18, height: 18, borderRadius: "50%", background: dest?.color ?? "#888", display: "flex", alignItems: "center", justifyContent: "center" }}><ChainIconContent chain={dest} size={18} /></div>
            }
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--mono)" }}>{bridge.amount} USDC</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "rgba(0,200,150,0.12)", color: "var(--green)", fontFamily: "var(--mono)", fontWeight: 700 }}>✓ Done</span>
          <button onClick={() => onDismiss(bridge.id)} style={{ background: "none", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      </div>

      {/* TX links */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "var(--mono)", color: "var(--text2)", marginBottom: bridge.mintTxHash ? 3 : 0 }}>
        <span>Burn TX ({src?.label})</span>
        <a href={`${bridge.fromExplorer}/tx/${bridge.burnTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)", textDecoration: "none" }}>
          {bridge.burnTxHash.slice(0, 8)}…{bridge.burnTxHash.slice(-6)} ↗
        </a>
      </div>
      {bridge.mintTxHash && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "var(--mono)", color: "var(--text2)" }}>
          <span>Mint TX ({dest?.label})</span>
          <a href={`${bridge.toExplorer}/tx/${bridge.mintTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)", textDecoration: "none" }}>
            {bridge.mintTxHash.slice(0, 8)}…{bridge.mintTxHash.slice(-6)} ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Pending bridge card (for active/attesting/ready/minting) ─────────────────
function PendingBridgeCard({
  bridge, now, onMint, onDismiss,
}: {
  bridge: PendingBridge;
  now: number;
  onMint: (b: PendingBridge) => void;
  onDismiss: (id: string) => void;
}) {
  const src  = CHAINS.find(c => c.id === bridge.srcChainId)!;
  const dest = CHAINS.find(c => c.id === bridge.destChainId)!;
  const elapsed = now - bridge.burnedAt;
  const pollStartsIn = Math.max(0, POLL_DELAY_MS - elapsed);

  const isReady    = bridge.status === "ready";
  const isMinting  = bridge.status === "minting";
  const isFailed   = bridge.status === "failed";
  const isAttesting = bridge.status === "attesting";

  const borderColor = isReady ? "rgba(0,229,255,0.4)" : isFailed ? "rgba(224,65,90,0.3)" : "var(--border)";
  const bgColor     = isReady ? "rgba(0,229,255,0.06)" : "var(--bg1)";

  return (
    <div className="fade-in" style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: src?.color ?? "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChainIconContent chain={src} size={22} />
            </div>
            <span style={{ fontSize: 11, color: "var(--text2)" }}>→</span>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: dest?.color ?? "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChainIconContent chain={dest} size={22} />
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)" }}>{bridge.amount} USDC</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isReady && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(0,229,255,0.15)", color: "var(--cyan)", fontFamily: "var(--mono)", fontWeight: 700 }}>Ready to Mint</span>}
          {isMinting && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(0,229,255,0.1)", color: "var(--cyan)", fontFamily: "var(--mono)", fontWeight: 700 }}>Minting…</span>}
          {isFailed && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(224,65,90,0.12)", color: "var(--red)", fontFamily: "var(--mono)", fontWeight: 700 }}>Failed</span>}
          {isAttesting && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "var(--bg3)", color: "var(--text2)", fontFamily: "var(--mono)", fontWeight: 700 }}>Attesting</span>}
          {isFailed && (
            <button onClick={() => onDismiss(bridge.id)} style={{ background: "none", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isReady || isMinting ? 10 : 0 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
          {isFailed ? (
            <span style={{ color: "var(--red)" }}>Failed after {fmtElapsed(elapsed)}</span>
          ) : (
            <span style={{ color: "var(--text2)" }}>
              ⏱ <strong style={{ color: "var(--text1)", fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</strong>
              {isAttesting && pollStartsIn > 0 && (
                <span style={{ color: "var(--text2)", marginLeft: 6 }}>· polling starts in {fmtElapsed(pollStartsIn)}</span>
              )}
              {isAttesting && pollStartsIn === 0 && (
                <span style={{ color: "var(--cyan)", marginLeft: 6 }}>· checking attestation…</span>
              )}
            </span>
          )}
        </div>
        <a href={`${bridge.fromExplorer}/tx/${bridge.burnTxHash}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", textDecoration: "none" }}>
          {bridge.burnTxHash.slice(0, 8)}…{bridge.burnTxHash.slice(-6)} ↗
        </a>
      </div>

      {isReady && (
        <button onClick={() => onMint(bridge)}
          className="swap-btn ready"
          style={{ margin: 0, fontSize: 13, padding: "10px 0", background: "linear-gradient(90deg, #00b4d8, #0077b6)" }}>
          🟢 Mint Now on {dest?.label}
        </button>
      )}

      {isMinting && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)", padding: "6px 0" }}>
          <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />Minting USDC on {dest?.label}…
        </div>
      )}
    </div>
  );
}

const STEP_ORDER: BridgeStep[] = ["approving", "burning", "attesting", "minting", "done"];

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function BridgePage() {
  const { wallet, openModal } = useWallet();
  const [fromId,   setFromId]  = useState("Arc_Testnet");
  const [toId,     setToId]    = useState("Ethereum_Sepolia");
  const [amount,   setAmount]  = useState("");
  const [step,     setStep]    = useState<BridgeStep>("idle");
  const [status,   setStat]    = useState("");
  const [srcBal,   setSrcBal]  = useState<number | null>(null);
  const [txLinks,  setTxLinks] = useState<{ burnTx?: string; mintTx?: string; fromExplorer?: string; toExplorer?: string; toLabel?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Pending bridges state ──────────────────────────────────────────────────
  const [pending,  setPending] = useState<PendingBridge[]>([]);
  const [now,      setNow]     = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = loadPending();
    setPending(saved);
    // On mount: immediately check attestation for any attesting bridges past the delay
    const toCheck = saved.filter(b => b.status === "attesting" && (Date.now() - b.burnedAt) >= POLL_DELAY_MS);
    if (toCheck.length > 0) {
      // Run async without blocking render
      (async () => {
        let changed = false;
        const updated = await Promise.all(saved.map(async (b) => {
          if (b.status !== "attesting" || (Date.now() - b.burnedAt) < POLL_DELAY_MS) return b;
          const result = await checkAttestationOnce(b.srcDomain, b.burnTxHash);
          if (result) {
            changed = true;
            return { ...b, status: "ready" as const, message: result.message, attestation: result.attestation };
          }
          return b;
        }));
        if (changed) {
          savePending(updated);
          setPending(updated);
          showToast(true, "Attestation Ready ✓", "A bridge is ready to mint!");
        }
      })();
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const checkPending = useCallback(async () => {
    const list = loadPending();
    let changed = false;
    const updated = await Promise.all(list.map(async (b) => {
      if (b.status !== "attesting") return b;
      const elapsed = Date.now() - b.burnedAt;
      if (elapsed < POLL_DELAY_MS) return b;
      const result = await checkAttestationOnce(b.srcDomain, b.burnTxHash);
      if (result) {
        changed = true;
        return { ...b, status: "ready" as const, message: result.message, attestation: result.attestation };
      }
      return b;
    }));
    if (changed) {
      savePending(updated);
      setPending(updated);
      showToast(true, "Attestation Ready ✓", "A bridge is ready to mint!");
    }
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasAttesting = pending.some(b => b.status === "attesting");
    if (!hasAttesting) return;
    pollRef.current = setInterval(checkPending, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pending, checkPending]);

  function updatePending(list: PendingBridge[]) { savePending(list); setPending(list); }
  function addPending(b: PendingBridge) { updatePending([...loadPending(), b]); }
  function mutatePending(id: string, patch: Partial<PendingBridge>) {
    updatePending(loadPending().map(b => b.id === id ? { ...b, ...patch } : b));
  }
  function dismissPending(id: string) { updatePending(loadPending().filter(b => b.id !== id)); }

  // ── Mint handler (from tracker) ────────────────────────────────────────────
  async function handleMint(bridge: PendingBridge) {
    if (!wallet.connected) { openModal(); return; }
    if (!bridge.message || !bridge.attestation) return;
    const dest = CHAINS.find(c => c.id === bridge.destChainId)!;
    mutatePending(bridge.id, { status: "minting" });
    const eth = (window as any).ethereum;
    try {
      await switchToChain(dest);
      const mintData = encodeReceiveMessage(bridge.message, bridge.attestation);
      const mintTx: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: dest.transmitter, data: mintData, gas: "0x493E0" }] });
      const ok = await waitTxRpc(dest.rpc, mintTx, 120000);
      if (!ok) throw new Error("receiveMessage failed on-chain.");
      mutatePending(bridge.id, { status: "completed", mintTxHash: mintTx });
      showToast(true, "Mint Complete ✓", `${bridge.amount} USDC minted on ${dest.label}!`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("4001") || /reject|denied|cancel/i.test(msg)) {
        mutatePending(bridge.id, { status: "ready" });
        showToast(false, "Cancelled", "Rejected in wallet.");
      } else {
        mutatePending(bridge.id, { status: "failed" });
        showToast(false, "Mint Failed", msg.slice(0, 100));
      }
    }
  }

  // ── Bridge form helpers ────────────────────────────────────────────────────
  const from = CHAINS.find(c => c.id === fromId)!;
  const to   = CHAINS.find(c => c.id === toId)!;
  const amtN     = parseFloat(amount) || 0;
  const samePair = fromId === toId;
  const loading  = step !== "idle" && step !== "done" && step !== "error";
  const canBridge = wallet.connected && amtN > 0 && !samePair && !loading;

  function reset() { setStep("idle"); setAmount(""); setSrcBal(null); setTxLinks(null); setErrorMsg(""); setStat(""); }

  async function fetchSrcBal() {
    if (!wallet.connected) return;
    try {
      const data = "0x70a08231" + wallet.address.toLowerCase().replace("0x", "").padStart(64, "0");
      const r: any = await rpcCall(from.rpc, "eth_call", [{ to: from.usdc, data }, "latest"]);
      setSrcBal(r && r !== "0x" ? Number(BigInt(r)) / 1e6 : 0);
    } catch {}
  }

  async function handleBridge() {
    if (!wallet.connected) { openModal(); return; }
    if (!canBridge) return;
    setStep("idle"); setStat(""); setTxLinks(null); setErrorMsg("");
    const eth = (window as any).ethereum;

    try {
      // ── 1. Approve (only if allowance insufficient) ────────────────────────
      setStep("approving");
      setStat(`Switching to ${from.label}…`);
      await switchToChain(from);
      await fetchSrcBal();
      const amtRaw = toUnits(amtN, 6);

      setStat("Checking USDC allowance…");
      const allowance = await checkAllowance(from.rpc, from.usdc, wallet.address, from.messenger);
      if (allowance < amtRaw) {
        // Approve a large amount (not MAX_U256 — avoids MetaMask NFT withdrawal warning)
        setStat(`Approving USDC on ${from.label} — confirm in wallet…`);
        const approveTx: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: from.usdc, data: encodeApprove(from.messenger, LARGE_APPROVAL), gas: "0x186A0" }] });
        setStat("Waiting for approval confirmation…");
        if (!await waitTxRpc(from.rpc, approveTx)) throw new Error("Approve transaction failed on-chain.");
      } else {
        setStat("USDC already approved ✓");
        await new Promise(r => setTimeout(r, 500));
      }

      // ── 2. depositForBurn ──────────────────────────────────────────────────
      setStep("burning");
      const burnData = encodeDepositForBurnV2(amtRaw, to.domain, wallet.address, from.usdc, MAX_FEE, MIN_FINALITY);

      setStat("Simulating burn TX…");
      try {
        await rpcCall(from.rpc, "eth_call", [{ from: wallet.address, to: from.messenger, data: burnData, gas: "0x493E0" }, "latest"]);
      } catch (simErr: any) {
        throw new Error(`depositForBurn would revert: ${simErr?.message ?? simErr}`);
      }

      setStat(`Burning USDC on ${from.label} — confirm in wallet…`);
      const burnTx: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: from.messenger, data: burnData, gas: "0x493E0" }] });
      setStat("Burn TX sent — waiting for confirmation…");
      if (!await waitTxRpc(from.rpc, burnTx, 90000)) throw new Error(`depositForBurn failed. Check: ${from.explorer}/tx/${burnTx}`);

      setTxLinks({ burnTx, fromExplorer: from.explorer, toExplorer: to.explorer, toLabel: to.label });
      showToast(true, "Burn Confirmed ✓", "Tracking attestation in background…");

      // ── Save to pending tracker ────────────────────────────────────────────
      const pendingEntry: PendingBridge = {
        id: uid(), burnTxHash: burnTx, srcChainId: from.id, destChainId: to.id,
        srcDomain: from.domain, amount: amtN.toFixed(2), burnedAt: Date.now(),
        fromExplorer: from.explorer, toExplorer: to.explorer, status: "attesting",
      };
      addPending(pendingEntry);

      // ── 3. Poll attestation ────────────────────────────────────────────────
      setStep("attesting");
      setStat("Waiting for Circle attestation — this usually takes 5–20 minutes on testnet…");
      const attestResult = await pollAttestationV2(from.domain, burnTx, setStat);
      if (!attestResult) {
        mutatePending(pendingEntry.id, { status: "attesting" });
        showToast(false, "Attestation Timeout", "Bridge saved — check Status Tracker below to mint later.");
        setStep("error");
        setErrorMsg("Circle attestation timed out. Your burn is confirmed — use the Bridge Status Tracker below to complete the mint when ready.");
        return;
      }

      mutatePending(pendingEntry.id, { status: "ready", message: attestResult.message, attestation: attestResult.attestation });

      // ── 4. receiveMessage ──────────────────────────────────────────────────
      setStep("minting");
      setStat(`Switching to ${to.label}…`);
      await switchToChain(to);
      setStat(`Minting USDC on ${to.label} — confirm in wallet…`);
      const mintData = encodeReceiveMessage(attestResult.message, attestResult.attestation);
      const mintTx: string = await eth.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: to.transmitter, data: mintData, gas: "0x493E0" }] });
      setStat("Waiting for mint confirmation…");
      if (!await waitTxRpc(to.rpc, mintTx, 120000)) throw new Error(`receiveMessage failed. Check: ${to.explorer}/tx/${mintTx}`);

      mutatePending(pendingEntry.id, { status: "completed", mintTxHash: mintTx });
      setTxLinks(prev => ({ ...prev, mintTx }));
      setStep("done");
      setStat("Bridge complete!");
      showToast(true, "Bridge Complete ✓", `${amtN} USDC minted on ${to.label}!`);
      setAmount("");

    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("4001") || /reject|denied|cancel/i.test(msg)) {
        showToast(false, "Cancelled", "Rejected in wallet.");
        setErrorMsg("User rejected the transaction.");
      } else {
        setErrorMsg(msg.slice(0, 500));
        showToast(false, "Bridge Error", msg.slice(0, 100));
      }
      setStep("error");
      setStat("");
    }
  }

  const stepDone   = (s: BridgeStep) => STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(s) || step === "done";
  const stepActive = (s: BridgeStep) => step === s;

  // Separate active (attesting/ready/minting/failed) from completed
  const activePending    = pending.filter(b => b.status !== "completed");
  const completedPending = pending.filter(b => b.status === "completed");

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 24px", paddingLeft: 180 }}>
      <div style={{ marginBottom: 22, width: "100%", maxWidth: 904 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>Bridge</h1>
        <p style={{ fontSize: 13, color: "var(--text2)" }}>Cross-chain USDC · Circle CCTP V2 · Auto Attest &amp; Mint</p>
      </div>

      {/* Two-column layout: bridge form left, history right */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", width: "100%", maxWidth: 904 }}>
      {/* ── LEFT: bridge form ───────────────────────────────────────────────── */}
      <div style={{ flex: "0 0 520px", minWidth: 0 }}>

      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, padding: 22 }}>
        {/* FROM */}
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "var(--mono)", marginBottom: 10 }}>From</p>
          <div style={{ display: "flex", gap: 8 }}>
            {CHAINS.map(c => <ChainCard key={c.id} chain={c} selected={fromId === c.id} onClick={() => { if (c.id === toId) setToId(fromId); setFromId(c.id); reset(); }} />)}
          </div>
        </div>

        {/* Flip */}
        <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
          <button onClick={() => { const tmp = fromId; setFromId(toId); setToId(tmp); reset(); }}
            style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, transition: "all 0.25s" }}
            onMouseEnter={e => { (e.currentTarget as any).style.transform = "rotate(180deg)"; (e.currentTarget as any).style.color = "var(--cyan)"; }}
            onMouseLeave={e => { (e.currentTarget as any).style.transform = ""; (e.currentTarget as any).style.color = "var(--text1)"; }}>⇅</button>
        </div>

        {/* TO */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "var(--mono)", marginBottom: 10 }}>To</p>
          <div style={{ display: "flex", gap: 8 }}>
            {CHAINS.map(c => <ChainCard key={c.id} chain={c} selected={toId === c.id} onClick={() => { if (c.id === fromId) setFromId(toId); setToId(c.id); reset(); }} />)}
          </div>
        </div>

        {/* Route */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: from.color, boxShadow: `0 0 5px ${from.color}` }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{from.label}</span>
          </div>
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
            <div style={{ flex: 1, borderTop: "1px dashed var(--border2)" }} />
            <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", background: "var(--bg2)", padding: "0 8px", fontSize: 10, fontWeight: 700, color: "var(--cyan)", fontFamily: "var(--mono)" }}>CCTP V2</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: to.color, boxShadow: `0 0 5px ${to.color}` }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{to.label}</span>
          </div>
        </div>

        {samePair && <div style={{ background: "rgba(224,65,90,0.08)", border: "1px solid rgba(224,65,90,0.22)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--red)", fontFamily: "var(--mono)" }}>⚠ Source and destination must be different.</div>}

        {/* Amount */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "var(--mono)" }}>Amount (USDC)</p>
            {wallet.connected && srcBal !== null && (
              <span style={{ fontSize: 11, color: "var(--cyan)", fontFamily: "var(--mono)", fontWeight: 600, cursor: "pointer" }} onClick={() => setAmount(String(Math.max(0, srcBal - 0.01).toFixed(2)))}>
                MAX: {srcBal.toFixed(2)} on {from.label}
              </span>
            )}
            {wallet.connected && srcBal === null && (
              <span style={{ fontSize: 11, color: "var(--text2)", fontFamily: "var(--mono)", cursor: "pointer" }} onClick={fetchSrcBal}>Check balance ↗</span>
            )}
          </div>
          <div className="token-box">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" placeholder="0.00" step="0.01" min="0.01" value={amount}
                onChange={e => { setAmount(e.target.value); setStep("idle"); setTxLinks(null); setErrorMsg(""); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 28, fontWeight: 700, color: "var(--text0)", fontFamily: "var(--mono)", minWidth: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 50, padding: "7px 14px 7px 8px", flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#2775CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>US</div>
                <span style={{ fontSize: 13, fontWeight: 700 }}>USDC</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 8, fontFamily: "var(--mono)" }}>{amtN > 0 ? `≈ $${amount} USD` : "$0.00"}</div>
          </div>
        </div>

        {/* Summary */}
        {amtN > 0 && !samePair && (
          <div className="fade-in" style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", marginBottom: 18 }}>
            {[
              ["You send",    `${amount} USDC on ${from.label}`],
              ["You receive", `${amount} USDC on ${to.label}`],
              ["Steps",       "Approve → Burn → Attest → Mint"],
              ["Est. time",   "~5–15 minutes"],
              ["Protocol",    "Circle CCTP V2"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", fontFamily: "var(--mono)" }}>
                <span style={{ color: "var(--text2)" }}>{k}</span>
                <span style={{ color: k === "Protocol" ? "var(--cyan)" : "var(--text1)", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Progress steps */}
        {step !== "idle" && (
          <div className="fade-in" style={{ marginBottom: 14, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              {(["approving", "burning", "attesting", "minting", "done"] as BridgeStep[]).map((s, i) => (
                <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: stepDone(s) ? "var(--green)" : stepActive(s) ? "var(--cyan)" : "var(--bg3)", color: stepDone(s) || stepActive(s) ? "#fff" : "var(--text2)", border: `2px solid ${stepDone(s) ? "var(--green)" : stepActive(s) ? "var(--cyan)" : "var(--border)"}`, transition: "all 0.3s" }}>
                    {stepDone(s) ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 9, color: stepActive(s) ? "var(--cyan)" : stepDone(s) ? "var(--green)" : "var(--text2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "center" }}>
                    {s === "approving" ? "Approve" : s === "burning" ? "Burn" : s === "attesting" ? "Attest" : s === "minting" ? "Mint" : "Done"}
                  </span>
                </div>
              ))}
            </div>
            {loading && status && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan)", fontFamily: "var(--mono)" }}>
                <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />{status}
              </div>
            )}
            {step === "done" && <div style={{ fontSize: 13, color: "var(--green)", fontFamily: "var(--mono)", fontWeight: 700 }}>✅ Bridge complete!</div>}
          </div>
        )}

        {/* Button */}
        {!wallet.connected
          ? <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
          : <button disabled={!canBridge} onClick={handleBridge} className={canBridge ? "swap-btn ready" : "swap-btn disabled-state"} style={{ margin: 0 }}>
              {loading && <span className="spinner" />}
              {loading ? "Bridging…" : `Bridge ${amtN > 0 ? amount + " " : ""}USDC →`}
            </button>
        }
      </div>

      {/* Result card */}
      {(txLinks || (step === "error" && errorMsg)) && (
        <div className="fade-in" style={{ marginTop: 14, background: "var(--bg1)", border: `1px solid ${step === "done" ? "rgba(0,200,150,0.3)" : step === "error" ? "rgba(224,65,90,0.3)" : "rgba(0,229,255,0.2)"}`, borderRadius: 16, padding: "16px 18px" }}>
          {step === "error" && errorMsg ? (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--red)", marginBottom: 8 }}>❌ Bridge Error</p>
              <p style={{ fontSize: 12, color: "var(--text2)", fontFamily: "var(--mono)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{errorMsg}</p>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 700, fontSize: 13, color: step === "done" ? "var(--green)" : "var(--cyan)", marginBottom: 10 }}>
                {step === "done" ? "✅ Bridge Complete" : "⏳ Bridge in progress…"}
              </p>
              {txLinks?.burnTx && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", fontFamily: "var(--mono)" }}>
                  <span style={{ color: "var(--text2)" }}>Burn TX ({from.label})</span>
                  <a href={`${txLinks.fromExplorer}/tx/${txLinks.burnTx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)", textDecoration: "none" }}>{txLinks.burnTx.slice(0, 10)}…{txLinks.burnTx.slice(-6)} ↗</a>
                </div>
              )}
              {txLinks?.mintTx && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", fontFamily: "var(--mono)" }}>
                  <span style={{ color: "var(--text2)" }}>Mint TX ({txLinks.toLabel})</span>
                  <a href={`${txLinks.toExplorer}/tx/${txLinks.mintTx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)", textDecoration: "none" }}>{txLinks.mintTx.slice(0, 10)}…{txLinks.mintTx.slice(-6)} ↗</a>
                </div>
              )}
            </>
          )}
        </div>
      )}

      </div>{/* end left col */}

      {/* ── RIGHT: History panel — compact, fixed width, single scroll ──── */}
      <div style={{ flex: "0 0 360px", position: "sticky", top: 20 }}>
        <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 16, padding: "14px 14px 12px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text1)", letterSpacing: "0.2px" }}>Bridge Status</span>
            <div style={{ display: "flex", gap: 6 }}>
              {activePending.length > 0 && (
                <span style={{ fontSize: 9, background: "rgba(0,229,255,0.12)", color: "var(--cyan)", borderRadius: 20, padding: "2px 7px", fontFamily: "var(--mono)", fontWeight: 700 }}>
                  {activePending.length} active
                </span>
              )}
              {completedPending.length > 0 && (
                <span style={{ fontSize: 9, background: "rgba(0,200,150,0.12)", color: "var(--green)", borderRadius: 20, padding: "2px 7px", fontFamily: "var(--mono)", fontWeight: 700 }}>
                  {completedPending.length} done
                </span>
              )}
            </div>
          </div>

          {activePending.length === 0 && completedPending.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text2)", fontSize: 11, fontFamily: "var(--mono)" }}>
              <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.25 }}>⇄</div>
              No bridges yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
              {/* Active bridges first (attesting / ready / minting / failed) */}
              {activePending.slice().reverse().map(b => (
                <PendingBridgeCard key={b.id} bridge={b} now={now} onMint={handleMint} onDismiss={dismissPending} />
              ))}

              {/* Divider between active and completed */}
              {activePending.length > 0 && completedPending.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0", opacity: 0.5 }} />
              )}

              {/* Completed bridges */}
              {completedPending.slice().reverse().map(b => (
                <HistoryCard key={b.id} bridge={b} onDismiss={dismissPending} />
              ))}
            </div>
          )}
        </div>
      </div>
      </div>{/* end two-col */}
    </div>
  );
}