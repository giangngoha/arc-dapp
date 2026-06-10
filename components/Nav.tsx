"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "./WalletProvider";
import WalletModal from "./WalletModal";

const LINKS = [
  { href:"/",       label:"Exchange"    },
  { href:"/pool",   label:"Pools"       },
  { href:"/bridge", label:"Bridge"      },
  { href:"/send",   label:"Send Tokens" },
];

function short(a:string){ return a.slice(0,6)+"…"+a.slice(-4); }
function fmt(n:number, dec=4){ if(n===0)return "0"; if(n<0.00000001)return "<0.00000001"; if(n<0.0001)return n.toFixed(8); return n.toLocaleString(undefined,{maximumFractionDigits:dec}); }

export default function Nav() {
  const path = usePathname();
  const { wallet, disconnect, openModal, refreshBalances } = useWallet();
  const [gas,       setGas]     = useState(8);
  const [menuOpen,  setMenu]    = useState(false);
  const [refreshing,setRef]     = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ const id=setInterval(()=>setGas(g=>Math.max(4,Math.min(25,g+(Math.random()>.5?1:-1)))),3000); return ()=>clearInterval(id); },[]);
  useEffect(()=>{ const h=(e:MouseEvent)=>{ if(menuRef.current&&!menuRef.current.contains(e.target as Node))setMenu(false); }; document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h); },[]);

  async function handleRefresh(){ setRef(true); await refreshBalances(); setRef(false); }

  return (
    <>
    <nav>
      <div className="logo-wrap">
        <div className="logo-box">A</div>
        <div>
          <div className="logo-name">Arc Dapp</div>
          <a className="logo-faucet" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">FAUCET ↗</a>
        </div>
      </div>

      <div className="nav-links">
        {LINKS.map(({href,label})=>(
          <Link key={href} href={href} className={`nav-link${path===href?" active":""}`}>{label}</Link>
        ))}
      </div>

      <div className="nav-right">
        <div className="net-indicator"><div className="net-dot"/><span style={{fontFamily:"var(--mono)",fontSize:11}}>Arc Testnet</span></div>
        <div className="gas-badge"><span>🔥</span><span>{gas} Gwei Gas</span></div>

        {wallet.connected ? (
          <div style={{position:"relative"}} ref={menuRef}>
            <button className="wallet-btn connected" onClick={()=>setMenu(o=>!o)}>
              <div className="wallet-dot"/>
              <span style={{fontFamily:"var(--mono)",fontSize:13}}>{short(wallet.address)}</span>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {menuOpen&&(
              <div className="wallet-menu">
                <div className="menu-addr">
                  <span>{wallet.walletType} · {short(wallet.address)}</span>
                  <button onClick={handleRefresh} style={{background:"none",border:"none",cursor:"pointer",color:"var(--cyan)",fontSize:15,animation:refreshing?"spin .7s linear infinite":"none"}}>↻</button>
                </div>
                {wallet.balancesLoading ? (
                  <div style={{padding:"10px 12px",fontSize:12,color:"var(--text2)",fontFamily:"var(--mono)",display:"flex",gap:6}}>
                    <span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>Loading…
                  </div>
                ) : (
                  [["USDC",4],["EURC",4],["cirBTC",8]].map(([sym,dec])=>(
                    <div key={sym as string} className="menu-bal">
                      <span className="mk">{sym}</span>
                      <span style={{fontFamily:"var(--mono)"}}>{fmt(getBal(wallet.balances,sym as string),dec as number)}</span>
                    </div>
                  ))
                )}
                <div style={{padding:"2px 12px 6px",fontSize:10,color:"var(--text2)",fontFamily:"var(--mono)"}}>
                  {wallet.chainId===5042002?"● Arc Network Testnet":`⚠ Chain ID: ${wallet.chainId}`}
                </div>
                <hr className="sep"/>
                <button className="menu-disconnect" onClick={()=>{disconnect();setMenu(false);}}>Disconnect</button>
              </div>
            )}
          </div>
        ) : (
          <button className="wallet-btn" onClick={openModal}>
            <div className="wallet-dot off"/>Connect Wallet
          </button>
        )}
      </div>
    </nav>
    <WalletModal/>
    </>
  );
}
