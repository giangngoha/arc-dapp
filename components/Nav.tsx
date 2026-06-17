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

const CHAINS = [
  { id:"arc",     label:"Arc Testnet",    hex:"0x4cef52", dot:"#00b4d8", rpc:"https://rpc.testnet.arc.network", explorer:"https://testnet.arcscan.app" },
  { id:"sepolia", label:"Eth Sepolia",    hex:"0xaa36a7", dot:"#627EEA", rpc:"https://rpc.sepolia.org", explorer:"https://sepolia.etherscan.io" },
  { id:"fuji",    label:"Avax Fuji",      hex:"0xa869",   dot:"#E84142", rpc:"https://api.avax-test.network/ext/bc/C/rpc", explorer:"https://testnet.snowtrace.io" },
];

function short(a:string){ return a.slice(0,6)+"…"+a.slice(-4); }
function fmt(n:number, dec=4){ if(n===0)return "0"; if(n<0.00000001)return "<0.00000001"; if(n<0.0001)return n.toFixed(8); return n.toLocaleString(undefined,{maximumFractionDigits:dec}); }

export default function Nav() {
  const path = usePathname();
  const { wallet, disconnect, openModal, refreshBalances } = useWallet();
  const [gas,        setGas]      = useState(8);
  const [menuOpen,   setMenu]     = useState(false);
  const [chainOpen,  setChainOpen]= useState(false);
  const [refreshing, setRef]      = useState(false);
  const [currentHex, setCurrentHex] = useState<string|null>(null);
  const menuRef  = useRef<HTMLDivElement>(null);
  const chainRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ const id=setInterval(()=>setGas(g=>Math.max(4,Math.min(25,g+(Math.random()>.5?1:-1)))),3000); return ()=>clearInterval(id); },[]);
  useEffect(()=>{ const h=(e:MouseEvent)=>{ if(menuRef.current&&!menuRef.current.contains(e.target as Node))setMenu(false); if(chainRef.current&&!chainRef.current.contains(e.target as Node))setChainOpen(false); }; document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h); },[]);

  // Detect current chain from MetaMask
  useEffect(()=>{
    const eth=(window as any).ethereum;
    if(!eth)return;
    eth.request({method:"eth_chainId"}).then((c:string)=>setCurrentHex(c?.toLowerCase())).catch(()=>{});
    const onChain=(c:string)=>setCurrentHex(c?.toLowerCase());
    eth.on("chainChanged",onChain);
    return ()=>eth.removeListener?.("chainChanged",onChain);
  },[wallet.connected]);

  async function switchChain(chain: typeof CHAINS[0]){
    const eth=(window as any).ethereum;
    if(!eth)return;
    try{
      await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:chain.hex}]});
    }catch(e:any){
      if(e.code===4902){
        await eth.request({method:"wallet_addEthereumChain",params:[{chainId:chain.hex,chainName:chain.label,nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18},rpcUrls:[chain.rpc],blockExplorerUrls:[chain.explorer]}]});
      }
    }
    setChainOpen(false);
  }

  const activeChain = CHAINS.find(c=>c.hex===currentHex) ?? CHAINS[0];

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
        {/* Chain Selector */}
        <div style={{position:"relative"}} ref={chainRef}>
          <button
            onClick={()=>setChainOpen(o=>!o)}
            style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"var(--text1)",transition:"all 0.2s"}}
            onMouseEnter={e=>(e.currentTarget.style.borderColor="var(--border2)")}
            onMouseLeave={e=>(e.currentTarget.style.borderColor="var(--border)")}
          >
            <div style={{width:8,height:8,borderRadius:"50%",background:activeChain.dot,boxShadow:`0 0 4px ${activeChain.dot}`}}/>
            {activeChain.label}
            <svg width="8" height="5" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          {chainOpen&&(
            <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:10,minWidth:160,zIndex:200,overflow:"hidden",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
              {CHAINS.map(chain=>(
                <button key={chain.id} onClick={()=>switchChain(chain)}
                  style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"9px 12px",border:"none",background:currentHex===chain.hex?"var(--bg2)":"transparent",cursor:"pointer",fontFamily:"var(--mono)",fontSize:12,fontWeight:700,color:currentHex===chain.hex?"var(--cyan)":"var(--text1)",transition:"all 0.15s",textAlign:"left"}}
                  onMouseEnter={e=>(e.currentTarget.style.background="var(--bg2)")}
                  onMouseLeave={e=>(e.currentTarget.style.background=currentHex===chain.hex?"var(--bg2)":"transparent")}
                >
                  <div style={{width:8,height:8,borderRadius:"50%",background:chain.dot,flexShrink:0}}/>
                  {chain.label}
                  {currentHex===chain.hex&&<span style={{marginLeft:"auto",fontSize:10,color:"var(--cyan)"}}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

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