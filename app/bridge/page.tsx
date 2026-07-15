"use client";
import { useState } from "react";
import { useWallet} from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

// ─── Contract addresses from Circle official docs ────────────────────────────
// Sources:
//   Sepolia→Arc:  https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc
//   Sepolia→Fuji: https://developers.circle.com/cctp/transfer-usdc-on-testnet-from-ethereum-to-avalanche
//
// CCTP V2 uses CREATE2 so TokenMessengerV2 = 0x8fe6b999... on ALL testnet EVM chains.
// MessageTransmitterV2 = 0xe737e5ce... on ALL testnet EVM chains (confirmed by Circle docs).
//
// Domain IDs: Sepolia=0, Fuji=1, Arc=26
const CHAINS = [
  {
    id: "Arc_Testnet", label: "Arc Testnet", sub: "Arc (0x4cef52)", color: "#00b4d8", icon: "A",
    chainIdHex: "0x4cef52",
    usdc:        "0x3600000000000000000000000000000000000000",
    // Arc TokenMessengerV2 — burn USDC when Arc is SOURCE chain
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    // Arc MessageTransmitterV2 — mint USDC when Arc is DESTINATION chain
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
    // Sepolia TokenMessengerV2 — confirmed by Circle docs
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    // Sepolia MessageTransmitterV2 — confirmed by Circle docs
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
    // Fuji TokenMessengerV2 — same CREATE2 address as other testnets
    messenger:   "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    // Fuji MessageTransmitterV2 — confirmed by Circle docs (Sepolia→Fuji quickstart)
    transmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    rpc:         "https://api.avax-test.network/ext/bc/C/rpc",
    explorer:    "https://testnet.snowtrace.io",
    domain:      1,
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  },
];
type Chain = typeof CHAINS[0];
type BridgeStep = "idle" | "approving" | "burning" | "attesting" | "minting" | "done" | "error";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
// Destination caller = bytes32(0) → any address can call receiveMessage
const DEST_CALLER_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
// maxFee = 500 subunits = 0.0005 USDC (per Circle docs example)
const MAX_FEE = 500n;
// minFinalityThreshold = 1000 → Fast Transfer
const MIN_FINALITY = 1000;

// ─── ABI Encoders (CCTP V2) ──────────────────────────────────────────────────
// depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient,
//               address burnToken, bytes32 destinationCaller, uint256 maxFee,
//               uint32 minFinalityThreshold)
// selector: keccak256("depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)")[0:4]
function encodeDepositForBurnV2(
  amount: bigint,
  destDomain: number,
  recipient: string, // EVM address → padded to bytes32
  burnToken: string,
  maxFee: bigint,
  minFinalityThreshold: number,
): string {
  // bytes32 recipient: 0x000...000{address}
  const recipientBytes32 = "000000000000000000000000" + recipient.toLowerCase().replace("0x", "");
  return (
    "0x8e0250ee" + // selector: keccak256("depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)")[0:4] = 0x8e0250ee
    amount.toString(16).padStart(64, "0") +
    destDomain.toString(16).padStart(64, "0") +
    recipientBytes32.padStart(64, "0") +
    burnToken.toLowerCase().replace("0x", "").padStart(64, "0") +
    DEST_CALLER_BYTES32.replace("0x", "") + // destinationCaller = 0
    maxFee.toString(16).padStart(64, "0") +
    minFinalityThreshold.toString(16).padStart(64, "0")
  );
}

// receiveMessage(bytes message, bytes attestation)
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
    (64).toString(16).padStart(64, "0") + // offset1 = 64
    off2 +
    msgLen.toString(16).padStart(64, "0") + msgPadded +
    attLen.toString(16).padStart(64, "0") + attPadded
  );
}

// ─── RPC helpers ──────────────────────────────────────────────────────────────
async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
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
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chain.chainIdHex,
          chainName: chain.label + " " + chain.sub,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpc],
          blockExplorerUrls: [chain.explorer],
        }],
      });
    } else throw e;
  }
  // Wait until wallet confirms the switch
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const c = await eth.request({ method: "eth_chainId" });
      if (c?.toLowerCase() === chain.chainIdHex.toLowerCase()) return;
    } catch {}
  }
  throw new Error(`Wallet did not switch to ${chain.label}. Please switch manually.`);
}

// Poll tx receipt via direct RPC (avoids MetaMask being on wrong chain)
async function waitTxRpc(rpcUrl: string, hash: string, maxWait = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r: any = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [hash]);
      if (r?.status) return r.status === "0x1";
    } catch {}
  }
  return false;
}

async function checkAllowance(rpcUrl: string, token: string, owner: string, spender: string): Promise<bigint> {
  try {
    const r: any = await rpcCall(rpcUrl, "eth_call", [{ to: token, data: encodeAllowance(owner, spender) }, "latest"]);
    return r && r !== "0x" ? BigInt(r) : 0n;
  } catch { return 0n; }
}

// ─── Attestation via Circle V2 API ───────────────────────────────────────────
// Source: https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc
// GET /v2/messages/{srcDomain}?transactionHash={burnTxHash}
// Returns messages[0].message + messages[0].attestation when status === "complete"
async function pollAttestationV2(
  srcDomain: number,
  burnTxHash: string,
  onStatus: (s: string) => void,
  maxWait = 1800000, // 30 minutes
): Promise<{ message: string; attestation: string } | null> {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${srcDomain}?transactionHash=${burnTxHash}`;
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWait) {
    attempt++;
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`;
    onStatus(`Waiting for Circle attestation… ${elapsedStr} elapsed`);
    await new Promise(r => setTimeout(r, 12000));
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        const j = await res.json();
        const msg = j?.messages?.[0];
        if (msg?.status === "complete" && msg?.attestation) {
          return { message: msg.message as string, attestation: msg.attestation as string };
        }
        if (msg?.status) onStatus(`Attestation status: ${msg.status} — ${elapsedStr} elapsed`);
      }
    } catch {}
  }
  return null;
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function ChainCard({ chain, selected, onClick }: { chain: Chain; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: "1px solid", borderColor: selected ? chain.color + "99" : "var(--border)", background: selected ? chain.color + "18" : "var(--bg2)", cursor: "pointer", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: selected ? chain.color : "var(--bg3)", border: `2px solid ${selected ? chain.color : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", boxShadow: selected ? `0 0 12px ${chain.color}44` : "none" }}>{chain.icon}</div>
      <span style={{ fontSize: 12, fontWeight: 700, color: selected ? "#fff" : "var(--text1)" }}>{chain.label}</span>
      <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: selected ? chain.color : "var(--text2)" }}>{chain.sub}</span>
    </button>
  );
}

const STEP_ORDER: BridgeStep[] = ["approving", "burning", "attesting", "minting", "done"];

export default function BridgePage() {
  const { wallet, openModal } = useWallet();
  const [fromId, setFromId] = useState("Arc_Testnet");
  const [toId,   setToId]   = useState("Ethereum_Sepolia");
  const [amount, setAmount] = useState("");
  const [step,   setStep]   = useState<BridgeStep>("idle");
  const [status, setStat]   = useState("");
  const [srcBal, setSrcBal] = useState<number | null>(null);
  const [txLinks, setTxLinks] = useState<{ burnTx?: string; mintTx?: string; fromExplorer?: string; toExplorer?: string; toLabel?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [attestStart, setAttestStart] = useState<number|null>(null); // timestamp when attestation started

  const from     = CHAINS.find(c => c.id === fromId)!;
  const to       = CHAINS.find(c => c.id === toId)!;
  const amtN     = parseFloat(amount) || 0;
  const samePair = fromId === toId;
  const loading  = step !== "idle" && step !== "done" && step !== "error";
  const canBridge = wallet.connected && amtN > 0 && !samePair && !loading;

  function reset() { setStep("idle"); setAmount(""); setSrcBal(null); setTxLinks(null); setErrorMsg(""); setStat(""); setAttestStart(null); }

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
      // ── 1. Approve ──────────────────────────────────────────────────────────
      setStep("approving");
      setStat(`Switching to ${from.label}…`);
      await switchToChain(from);
      await fetchSrcBal();
      const amtRaw = toUnits(amtN, 6);

      setStat("Checking USDC allowance…");
      const allowance = await checkAllowance(from.rpc, from.usdc, wallet.address, from.messenger);
      if (allowance < amtRaw) {
        setStat(`Approving USDC on ${from.label} — confirm in wallet…`);
        const approveTx: string = await eth.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: from.usdc, data: encodeApprove(from.messenger, MAX_UINT256), gas: "0x186A0" }],
        });
        setStat("Waiting for approval confirmation…");
        const ok = await waitTxRpc(from.rpc, approveTx);
        if (!ok) throw new Error("Approve transaction failed on-chain.");
      } else {
        setStat("USDC already approved ✓");
        await new Promise(r => setTimeout(r, 500));
      }

      // ── 2. depositForBurn (CCTP V2 — 7 params) ─────────────────────────────
      setStep("burning");
      setStat(`Burning USDC on ${from.label} — confirm in wallet…`);
      const burnData = encodeDepositForBurnV2(amtRaw, to.domain, wallet.address, from.usdc, MAX_FEE, MIN_FINALITY);

      // Simulate first to catch revert reason before asking wallet to sign
      setStat("Simulating burn TX…");
      try {
        const sim: any = await rpcCall(from.rpc, "eth_call", [{
          from: wallet.address, to: from.messenger, data: burnData, gas: "0x493E0"
        }, "latest"]);
        console.log("[Bridge] Simulation result:", sim);
      } catch (simErr: any) {
        const simMsg = simErr?.message || String(simErr);
        throw new Error(`depositForBurn would revert: ${simMsg}

Messenger: ${from.messenger}
Domain: ${to.domain}
Amount: ${amtRaw} (${amtN} USDC)
Recipient: ${wallet.address}`);
      }

      setStat(`Burning USDC on ${from.label} — confirm in wallet…`);
      const burnTx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: from.messenger, data: burnData, gas: "0x493E0" }],
      });
      setStat(`Burn TX sent — waiting for confirmation…`);
      const burnOk = await waitTxRpc(from.rpc, burnTx, 90000);
      if (!burnOk) throw new Error(`depositForBurn failed.\nCheck: ${from.explorer}/tx/${burnTx}`);

      setTxLinks({ burnTx, fromExplorer: from.explorer, toExplorer: to.explorer, toLabel: to.label });
      showToast(true, "Burn Confirmed ✓", "Fetching Circle attestation…");

      // ── 3. Poll Circle Iris V2 API ──────────────────────────────────────────
      // Uses: GET /v2/messages/{srcDomain}?transactionHash={burnTxHash}
      // No need to extract logs or compute message hash manually!
      setStep("attesting");
      setAttestStart(Date.now());
      setStat("Waiting for Circle attestation — this usually takes 5–20 minutes on testnet…");
      const attestResult = await pollAttestationV2(from.domain, burnTx, setStat);
      if (!attestResult) {
        throw new Error(
          "Circle attestation timed out after 30 minutes. " +
          "Your funds are safe — the burn TX is confirmed on-chain. " +
          `Complete the mint manually at https://app.circle.com/transfer using Burn TX: ${from.explorer}/tx/${burnTx}`
        );
      }

      // ── 4. receiveMessage on destination ────────────────────────────────────
      setStep("minting");
      setStat(`Switching to ${to.label}…`);
      await switchToChain(to);
      setStat(`Minting USDC on ${to.label} — confirm in wallet…`);
      const mintData = encodeReceiveMessage(attestResult.message, attestResult.attestation);
      const mintTx: string = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: to.transmitter, data: mintData, gas: "0x493E0" }],
      });
      setStat("Waiting for mint confirmation…");
      const mintOk = await waitTxRpc(to.rpc, mintTx, 120000);
      if (!mintOk) throw new Error(`receiveMessage failed on ${to.label}.\nCheck: ${to.explorer}/tx/${mintTx}`);

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

  return (
    <div className="fade-in" style={{ maxWidth: 520, margin: "0 auto", padding: "20px 24px" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>Bridge</h1>
        <p style={{ fontSize: 13, color: "var(--text2)" }}>Cross-chain USDC · Circle CCTP V2 · Auto Attest &amp; Mint</p>
      </div>

      <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 20, padding: 22 }}>
        {/* FROM */}
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "var(--mono)", marginBottom: 10 }}>From</p>
          <div style={{ display: "flex", gap: 8 }}>
            {CHAINS.map(c => <ChainCard key={c.id} chain={c} selected={fromId === c.id} onClick={() => { if (c.id === toId) setToId(fromId); setFromId(c.id); reset(); }} />)}
          </div>
        </div>

        {/* Flip button */}
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

        {/* Amount input */}
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
                <span className="spinner" style={{ borderTopColor: "var(--cyan)" }} />
                {status}
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
    </div>
  );
}