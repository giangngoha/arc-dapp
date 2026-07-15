"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "./WalletProvider";
import WalletModal from "./WalletModal";

const LINKS = [
  { href:"/swap",      label:"Exchange"   },
  { href:"/pool",      label:"Pools"      },
  { href:"/bridge",    label:"Bridge"     },
  { href:"/send",      label:"Send Tokens"},
  { href:"/portfolio", label:"Portfolio"  },
];

const CHAINS = [
  { id:"arc",     label:"Arc Testnet", hex:"0x4cef52", dot:"#00b4d8", rpc:"https://rpc.testnet.arc.network",              explorer:"https://testnet.arcscan.app",        nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18} },
  { id:"sepolia", label:"Eth Sepolia", hex:"0xaa36a7", dot:"#627EEA", rpc:"https://ethereum-sepolia-rpc.publicnode.com", explorer:"https://sepolia.etherscan.io",       nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18}  },
  { id:"fuji",    label:"Avax Fuji",   hex:"0xa869",   dot:"#E84142", rpc:"https://api.avax-test.network/ext/bc/C/rpc",   explorer:"https://testnet.snowtrace.io",       nativeCurrency:{name:"AVAX",symbol:"AVAX",decimals:18} },
];

function short(a:string){ return a.slice(0,6)+"…"+a.slice(-4); }
function fmt(n:number, dec=4){ if(n===0)return "0"; if(n<0.00000001)return "<0.00000001"; if(n<0.0001)return n.toFixed(8); return n.toLocaleString(undefined,{maximumFractionDigits:dec}); }

export default function Nav() {
  const path = usePathname();
  const { wallet, disconnect, openModal } = useWallet();
  const [gas,         setGas]       = useState(8);
  const [menuOpen,    setMenu]      = useState(false);
  const [chainOpen,   setChainOpen] = useState(false);
  const [currentHex,  setCurrentHex]= useState<string|null>(null);
  const [copied,      setCopied]    = useState(false);
  const [nativeBal,   setNativeBal] = useState<number|null>(null); // native token balance for non-Arc chains
  const menuRef  = useRef<HTMLDivElement>(null);
  const chainRef = useRef<HTMLDivElement>(null);

  // Fetch real gas price from current chain RPC every 12 seconds
  useEffect(()=>{
    async function fetchGas(){
      const chain = CHAINS.find(c=>c.hex===currentHex) ?? CHAINS[0];
      try{
        const res = await fetch(chain.rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_gasPrice",params:[]})});
        const j = await res.json();
        if(j.result){ const gwei = Number(BigInt(j.result)) / 1e9; setGas(Math.round(gwei*10)/10); }
      }catch{}
    }
    fetchGas();
    const id = setInterval(fetchGas, 12000);
    return ()=>clearInterval(id);
  },[currentHex]);

  // Fetch native token balance when on non-Arc chains (ETH on Sepolia, AVAX on Fuji)
  useEffect(()=>{
    const isArc = currentHex === "0x4cef52";
    if (isArc || !wallet.connected || !wallet.address) { setNativeBal(null); return; }
    const chain = CHAINS.find(c=>c.hex===currentHex);
    if (!chain) return;
    async function fetchNativeBal(){
      try {
        const res = await fetch(chain!.rpc,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getBalance",params:[wallet.address,"latest"]})});
        const j = await res.json();
        if(j.result){ setNativeBal(Number(BigInt(j.result)) / 1e18); }
      } catch {}
    }
    fetchNativeBal();
    const id = setInterval(fetchNativeBal, 15000);
    return ()=>clearInterval(id);
  },[currentHex, wallet.connected, wallet.address]);
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
        await eth.request({method:"wallet_addEthereumChain",params:[{chainId:chain.hex,chainName:chain.label,nativeCurrency:chain.nativeCurrency,rpcUrls:[chain.rpc],blockExplorerUrls:[chain.explorer]}]});
      }
    }
    setChainOpen(false);
  }

  const activeChain = CHAINS.find(c=>c.hex===currentHex) ?? CHAINS[0];


  return (
    <>
    <nav>
      <div className="logo-wrap">
        <div className="logo-box"><span className="logo-m">M</span></div>
        <div>
          <div className="logo-name">Matrix</div>
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
                  <span style={{fontFamily:"var(--mono)",fontSize:11}}>{wallet.walletType} · {short(wallet.address)}</span>
                  <button
                    onClick={()=>{ navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(()=>setCopied(false),1500); }}
                    title="Copy address"
                    style={{background:"none",border:"none",cursor:"pointer",color:copied?"var(--green)":"var(--text2)",padding:"2px 4px",display:"flex",alignItems:"center",transition:"color 0.2s"}}
                  >
                    {copied ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="4" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                        <rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="var(--bg2)"/>
                      </svg>
                    )}
                  </button>
                </div>
                {currentHex === "0x4cef52" ? (
                  // Arc chain — show USDC / EURC / cirBTC balances
                  wallet.balancesLoading ? (
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
                  )
                ) : (
                  // Non-Arc chain — show native token balance (ETH / AVAX)
                  <div className="menu-bal">
                    <span className="mk">{CHAINS.find(c=>c.hex===currentHex)?.nativeCurrency.symbol ?? "ETH"}</span>
                    <span style={{fontFamily:"var(--mono)"}}>
                      {nativeBal !== null ? fmt(nativeBal, 6) : "…"}
                    </span>
                  </div>
                )}
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