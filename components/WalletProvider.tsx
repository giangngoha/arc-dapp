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

async function rpcFetch(method: string, params: unknown[]): Promise<string|null> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(ARC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc:"2.0", id:1, method, params }),
        signal: AbortSignal.timeout(4000),
      });
      const j = await res.json();
      if (!j.error) return j.result ?? null;
      const msg: string = j.error.message ?? "";
      if (/rate|limit|too many/i.test(msg) && i === 0) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return null;
    } catch { return null; }
  }
  return null;
}

async function fetchBal(addr: string): Promise<WalletBalances> {
  const pad = addr.toLowerCase().replace("0x","").padStart(64,"0");
  const parse = (r: string|null, div: number) => r && r !== "0x" ? Number(BigInt(r)) / div : 0;

  // All 4 calls in parallel — fast and works fine with Arc RPC
  const [usdcRaw, eurcRaw, cirbtcRaw, nativeRaw] = await Promise.all([
    rpcFetch("eth_call", [{to:"0x3600000000000000000000000000000000000000", data:"0x70a08231"+pad}, "latest"]),
    rpcFetch("eth_call", [{to:"0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", data:"0x70a08231"+pad}, "latest"]),
    rpcFetch("eth_call", [{to:"0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", data:"0x70a08231"+pad}, "latest"]),
    rpcFetch("eth_getBalance", [addr, "latest"]),
  ]);

  return {
    USDC:   parse(usdcRaw,   1e6),
    EURC:   parse(eurcRaw,   1e6),
    cirBTC: parse(cirbtcRaw, 1e8),
    ARC:    parse(nativeRaw, 1e18),
    ETH:    0,
  };
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

    // If all zeros and wallet should have balance → auto-retry up to 2 times
    if (isFetchFailed(balances) && attempt < 2) {
      const delay = (attempt + 1) * 2000; // 2s then 4s
      retryRef.current = setTimeout(() => loadBal(addr, attempt + 1), delay);
    } else if (isFetchFailed(balances)) {
      setFailed(true); // show retry button after all attempts fail
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