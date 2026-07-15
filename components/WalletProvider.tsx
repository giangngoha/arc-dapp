"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

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
}
const ZERO: WalletBalances = { ARC:0, USDC:0, EURC:0, cirBTC:0, ETH:0 };
const DEFAULT: WalletState = { connected:false, address:"", walletType:"", chainId:0, balancesLoading:false, balances:ZERO };
const Ctx = createContext<WalletCtx>({ wallet:DEFAULT, connect:async()=>{}, disconnect:()=>{}, refreshBalances:async()=>{}, updateBalance:()=>{}, modalOpen:false, openModal:()=>{}, closeModal:()=>{} });

export function getBal(b: WalletBalances, sym: string): number {
  return (b as unknown as Record<string,number>)[sym] ?? 0;
}

async function fetchBal(addr: string): Promise<WalletBalances> {
  const eth = (window as any).ethereum;
  if (!eth) return ZERO;
  const call = async (to: string, data: string) => {
    try { const r = await eth.request({ method:"eth_call", params:[{to,data},"latest"] }); return r && r!=="0x" ? Number(BigInt(r))/1e6 : 0; } catch { return 0; }
  };
  const pad = addr.toLowerCase().replace("0x","").padStart(64,"0");
  const [usdc, eurc, cirbtc, native] = await Promise.all([
    call("0x3600000000000000000000000000000000000000", "0x70a08231"+pad),
    call("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", "0x70a08231"+pad),
    (async()=>{ try { const r = await eth.request({method:"eth_call",params:[{to:"0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",data:"0x70a08231"+pad},"latest"]}); return r&&r!=="0x"?Number(BigInt(r))/1e8:0; } catch{return 0;} })(),
    (async()=>{ try { const r = await eth.request({method:"eth_getBalance",params:[addr,"latest"]}); return Number(BigInt(r??'0x0'))/1e18; } catch{return 0;} })(),
  ]);
  return { USDC:usdc, EURC:eurc, cirBTC:cirbtc, ARC:native, ETH:0 };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet]     = useState<WalletState>(DEFAULT);
  const [modalOpen, setModal]   = useState(false);

  const loadBal = useCallback(async (addr: string) => {
    setWallet(p => ({ ...p, balancesLoading:true }));
    const balances = await fetchBal(addr);
    setWallet(p => ({ ...p, balancesLoading:false, balances }));
  }, []);

  const refreshBalances = useCallback(async () => {
    if (wallet.address) await loadBal(wallet.address);
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

  return <Ctx.Provider value={{ wallet, connect, disconnect, refreshBalances, updateBalance, modalOpen, openModal:()=>setModal(true), closeModal:()=>setModal(false) }}>{children}</Ctx.Provider>;
}
export function useWallet() { return useContext(Ctx); }