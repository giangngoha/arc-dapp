"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

export interface WalletBalances {
  ARC: number; USDC: number; EURC: number; cirBTC: number; ETH: number;
}
export interface WalletState {
  connected: boolean; address: string; walletType: string;
  chainId: number; balancesLoading: boolean; balances: WalletBalances;
}
interface WalletCtx {
  wallet: WalletState;
  connect: (type: "MetaMask" | "Rabby") => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  updateBalance: (sym: string, delta: number) => void;
  modalOpen: boolean; openModal: () => void; closeModal: () => void;
  balanceFailed: boolean;
}
const ZERO: WalletBalances = { ARC:0, USDC:0, EURC:0, cirBTC:0, ETH:0 };
const DEFAULT: WalletState = { connected:false, address:"", walletType:"", chainId:0, balancesLoading:false, balances:ZERO };
const Ctx = createContext<WalletCtx>({ wallet:DEFAULT, connect:async()=>{}, disconnect:()=>{}, refreshBalances:async()=>{}, updateBalance:()=>{}, modalOpen:false, openModal:()=>{}, closeModal:()=>{}, balanceFailed:false });

export function getBal(b: WalletBalances, sym: string): number {
  return (b as unknown as Record<string,number>)[sym] ?? 0;
}

const ARC_RPC_URL = "https://rpc.testnet.arc.network";

// Fetch a single RPC call with retry logic.
// Timeout raised to 12s — Arc Testnet can be slow.
// Retries up to 3 times with exponential backoff on timeout or rate-limit errors.
async function rpcFetch(method: string, params: unknown[], attempt = 0): Promise<string|null> {
  try {
    const res = await fetch(ARC_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc:"2.0", id:Date.now(), method, params }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json();
    if (!j.error) return j.result ?? null;
    const msg: string = j.error.message ?? "";
    // Rate limit — wait longer and retry
    if (/rate|limit|too many/i.test(msg) && attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      return rpcFetch(method, params, attempt + 1);
    }
    return null;
  } catch (e: any) {
    // Timeout or network error — retry with backoff
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      return rpcFetch(method, params, attempt + 1);
    }
    return null;
  }
}

// Fetch one token balance with its own retry — so a single token failure doesn't zero out all balances.
async function fetchTokenBal(tokenAddr: string, walletAddr: string, divisor: number): Promise<number> {
  const pad = walletAddr.toLowerCase().replace("0x","").padStart(64,"0");
  const raw = await rpcFetch("eth_call", [{to: tokenAddr, data:"0x70a08231"+pad}, "latest"]);
  if (!raw || raw === "0x" || raw === "0x0000000000000000000000000000000000000000000000000000000000000000") return 0;
  try { return Number(BigInt(raw)) / divisor; } catch { return 0; }
}

async function fetchBal(addr: string): Promise<WalletBalances> {
  // Sequential with small delays between calls to avoid rate limiting on Arc Testnet RPC.
  // Slightly slower than Promise.all but far more reliable on public testnet endpoints.
  const USDC   = await fetchTokenBal("0x3600000000000000000000000000000000000000", addr, 1e6);
  await new Promise(r => setTimeout(r, 150));
  const EURC   = await fetchTokenBal("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", addr, 1e6);
  await new Promise(r => setTimeout(r, 150));
  const cirBTC = await fetchTokenBal("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", addr, 1e8);
  await new Promise(r => setTimeout(r, 150));
  const nativeRaw = await rpcFetch("eth_getBalance", [addr, "latest"]);
  const ARC = nativeRaw && nativeRaw !== "0x"
    ? (() => { try { return Number(BigInt(nativeRaw)) / 1e18; } catch { return 0; } })()
    : 0;

  return { USDC, EURC, cirBTC, ARC, ETH: 0 };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet]       = useState<WalletState>(DEFAULT);
  const [modalOpen, setModal]     = useState(false);
  const [balanceFailed, setFailed] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if all balances are zero — likely a failed fetch
  function isFetchFailed(b: WalletBalances) {
    return b.USDC === 0 && b.EURC === 0 && b.cirBTC === 0 && b.ARC === 0;
  }

  const loadBal = useCallback(async (addr: string, attempt = 0) => {
    setWallet(p => ({ ...p, balancesLoading: true }));
    setFailed(false);
    const balances = await fetchBal(addr);
    setWallet(p => ({ ...p, balancesLoading: false, balances }));

    // Retry if fetch failed (all zeros) — the sequential fetch + per-token retry
    // already handles most cases, but this is a final safety net.
    if (isFetchFailed(balances) && attempt < 2) {
      const delay = (attempt + 1) * 3000;
      retryRef.current = setTimeout(() => loadBal(addr, attempt + 1), delay);
    } else if (isFetchFailed(balances)) {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, []);

  const refreshBalances = useCallback(async () => {
    if (retryRef.current) clearTimeout(retryRef.current);
    if (wallet.address) await loadBal(wallet.address, 0);
  }, [wallet.address, loadBal]);

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.request({method:"eth_accounts"}).then((accs:string[]) => {
      if (accs?.length) eth.request({method:"eth_chainId"}).then((h:string)=>finish(accs[0],parseInt(h,16),eth.isRabby?"Rabby":"MetaMask"));
    }).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function finish(address:string, chainId:number, walletType:string) {
    setWallet(p => ({ ...p, connected:true, address, chainId, walletType }));
    loadBal(address);
    // Register Arc tokens as ERC-20 with MetaMask so the wallet
    // does not misidentify approve() calls as NFT withdrawal requests.
    registerArcTokensWithWallet().catch(() => {});
  }

  async function registerArcTokensWithWallet() {
    // Only register once per browser session — avoid repeated MetaMask popups
    const LS_KEY = "matrix_arc_tokens_registered";
    if (localStorage.getItem(LS_KEY) === "1") return;
    const eth = (window as any).ethereum;
    if (!eth?.request) return;
    const tokens = [
      { symbol: "USDC",   address: "0x3600000000000000000000000000000000000000", decimals: 6  },
      { symbol: "EURC",   address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6  },
      { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8  },
    ];
    await Promise.allSettled(tokens.map(t =>
      eth.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
      })
    ));
    // Mark as registered so we never call wallet_watchAsset again in this browser
    localStorage.setItem(LS_KEY, "1");
  }

  const connect = useCallback(async (type:"MetaMask"|"Rabby") => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error(`${type} not detected.`);
    let provider = eth;
    if (eth.providers?.length>1) provider = type==="Rabby" ? (eth.providers.find((p:any)=>p.isRabby)??eth) : (eth.providers.find((p:any)=>p.isMetaMask&&!p.isRabby)??eth);
    const accs: string[] = await provider.request({method:"eth_requestAccounts"});
    const hex: string    = await provider.request({method:"eth_chainId"});
    finish(accs[0], parseInt(hex,16), type);
    provider.on("accountsChanged",(a:string[])=>{ if(!a.length) disconnect(); else { setWallet(p=>({...p,address:a[0]})); loadBal(a[0]); } });
    provider.on("chainChanged",()=>window.location.reload());
    setModal(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loadBal]);

  const disconnect = useCallback(()=>setWallet(DEFAULT),[]);
  const updateBalance = useCallback((sym:string,delta:number)=>{
    setWallet(p=>({ ...p, balances:{ ...p.balances, [sym]:Math.max(0,parseFloat(((p.balances as unknown as Record<string,number>)[sym]+delta).toFixed(8))) } }));
  },[]);

  return <Ctx.Provider value={{ wallet, connect, disconnect, refreshBalances, updateBalance, modalOpen, openModal:()=>setModal(true), closeModal:()=>setModal(false), balanceFailed }}>{children}</Ctx.Provider>;
}
export function useWallet() { return useContext(Ctx); }