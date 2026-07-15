"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

// ─── Pool definitions ─────────────────────────────────────────────────────────
const ROUTER  = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const FACTORY = "0x8994A0b7E383bd62341319b22A198dEF7154ff9F";

const TOKENS = {
  USDC:   { addr: CONTRACTS.USDC,   decimals: 6,  color: "#2775CA", label: "USDC" },
  EURC:   { addr: CONTRACTS.EURC,   decimals: 6,  color: "#2B5EDD", label: "EURC" },
  cirBTC: { addr: CONTRACTS.cirBTC, decimals: 8,  color: "#F7931A", label: "cirBTC" },
};

const POOLS = [
  {
    id:    "usdc-eurc",
    tokenA: "USDC", tokenB: "EURC",
    pair:  "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb",
    label: "USDC / EURC",
    fee:   "0.3%",
  },
  {
    id:    "usdc-cirbtc",
    tokenA: "USDC", tokenB: "cirBTC",
    pair:  "0xa1d507a9662012bd43bf1ba5e03989d750a8c069",
    label: "USDC / cirBTC",
    fee:   "0.3%",
  },
  {
    id:    "eurc-cirbtc",
    tokenA: "EURC", tokenB: "cirBTC",
    pair:  "0x4404ec28d88768e3d36c3f8b981f662aba09d1c0",
    label: "EURC / cirBTC",
    fee:   "0.3%",
  },
];

// Known pool combinations — UI discovers pair address dynamically from Factory
const POOL_PAIRS = [
  { id:"usdc-eurc",   tokenA:"USDC", tokenB:"EURC",   label:"USDC / EURC",   fee:"0.3%" },
  { id:"usdc-cirbtc", tokenA:"USDC", tokenB:"cirBTC", label:"USDC / cirBTC", fee:"0.3%" },
  { id:"eurc-cirbtc", tokenA:"EURC", tokenB:"cirBTC", label:"EURC / cirBTC", fee:"0.3%" },
];

type PoolDef = typeof POOL_PAIRS[0] & { pair: string; exists: boolean; fee: string };

function encodeGetPair(tA: string, tB: string): string {
  return "0xe6a43905" + tA.toLowerCase().replace("0x","").padStart(64,"0") + tB.toLowerCase().replace("0x","").padStart(64,"0");
}

const MAX_U256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// ─── ABI Encoders ─────────────────────────────────────────────────────────────
function pad32(val: string | bigint, isAddr = false) {
  if (isAddr) return (val as string).toLowerCase().replace("0x","").padStart(64,"0");
  return (val as bigint).toString(16).padStart(64,"0");
}
function encodeAddLiquidity(tA:string,tB:string,amtA:bigint,amtB:bigint,minA:bigint,minB:bigint,to:string,deadline:bigint) {
  return "0xe8e33700"+pad32(tA,true)+pad32(tB,true)+pad32(amtA)+pad32(amtB)+pad32(minA)+pad32(minB)+pad32(to,true)+pad32(deadline);
}
function encodeRemoveLiquidity(tA:string,tB:string,lp:bigint,minA:bigint,minB:bigint,to:string,deadline:bigint) {
  return "0xbaa2abde"+pad32(tA,true)+pad32(tB,true)+pad32(lp)+pad32(minA)+pad32(minB)+pad32(to,true)+pad32(deadline);
}
const encodeGetReserves  = () => "0x0902f1ac";
const encodeTotalSupply  = () => "0x18160ddd";
const encodeBalanceOfLP  = (a:string) => "0x70a08231"+pad32(a,true);

// ─── RPC / helpers ───────────────────────────────────────────────────────────
// Tính APR từ Swap events trong 24h
// Swap event topic: keccak256("Swap(address,uint256,uint256,uint256,uint256,address)")
const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

async function getVolume24h(pairAddr: string, tokenADecimals: number): Promise<number> {
  try {
    // Lấy block hiện tại
    const blockHex = await rpc("eth_blockNumber", []) as string;
    const currentBlock = parseInt(blockHex, 16);
    // ~24h = 7200 blocks (Arc ~12s/block)
    const fromBlock = Math.max(0, currentBlock - 7200).toString(16);
    const logs: any = await rpc("eth_getLogs", [{
      address: pairAddr,
      topics:  [SWAP_TOPIC],
      fromBlock: "0x" + fromBlock,
      toBlock:   "latest",
    }]);
    if (!logs || !Array.isArray(logs)) return 0;
    // Mỗi Swap log: amount0In(32) amount1In(32) amount0Out(32) amount1Out(32)
    let totalVol = 0;
    for (const log of logs) {
      const d = log.data.replace("0x","");
      if (d.length < 256) continue;
      const a0in  = Number(BigInt("0x"+d.slice(0,64)))   / 10**tokenADecimals;
      const a0out = Number(BigInt("0x"+d.slice(128,192))) / 10**tokenADecimals;
      totalVol += a0in + a0out; // volume tính theo tokenA (USDC hoặc EURC ≈ 1 USD)
    }
    return totalVol;
  } catch { return 0; }
}

async function rpc(method:string,params:unknown[]):Promise<unknown> {
  const r = await fetch("https://rpc.testnet.arc.network",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const j = await r.json();
  if(j.error) throw new Error(j.error.message??JSON.stringify(j.error));
  return j.result;
}
async function switchToArc() {
  const eth=(window as any).ethereum; const hex="0x4cef52";
  let cur:string|undefined;
  try{cur=await eth.request({method:"eth_chainId"});}catch{}
  if(cur?.toLowerCase()===hex) return;
  try{await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:hex}]});}
  catch(e:any){if(e.code===4902)await eth.request({method:"wallet_addEthereumChain",params:[{chainId:hex,chainName:"Arc Network Testnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},rpcUrls:["https://rpc.testnet.arc.network"],blockExplorerUrls:[ARC_EXPLORER]}]});else throw e;}
  for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,400));try{const c=await eth.request({method:"eth_chainId"});if(c?.toLowerCase()===hex)return;}catch{}}
}
async function waitTx(hash:string,maxMs=90000):Promise<boolean> {
  const start=Date.now();
  while(Date.now()-start<maxMs){await new Promise(r=>setTimeout(r,3000));try{const r:any=await rpc("eth_getTransactionReceipt",[hash]);if(r?.blockNumber)return r.status==="0x1"||r.status===1;}catch{}}
  return false;
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function TokenIcon({sym,size=26}:{sym:string;size?:number}) {
  const c = TOKENS[sym as keyof typeof TOKENS]?.color ?? "#666";
  return <div style={{width:size,height:size,borderRadius:"50%",background:c,border:"2px solid var(--bg1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.35,fontWeight:800,color:"#fff",flexShrink:0}}>
    {sym==="cirBTC"?"₿":sym.slice(0,2)}
  </div>;
}
function IR({k,v,green,mono}:{k:string;v:string;green?:boolean;mono?:boolean}) {
  return <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",fontFamily:mono?"var(--mono)":undefined}}>
    <span style={{color:"var(--text2)"}}>{k}</span>
    <span style={{color:green?"var(--green)":"var(--text1)",fontWeight:600}}>{v}</span>
  </div>;
}

// ─── Pool card (list view) ────────────────────────────────────────────────────
function PoolCard({pool,onClick}:{pool:PoolDef;onClick:()=>void}) {
  const tA = TOKENS[pool.tokenA as keyof typeof TOKENS];
  const tB = TOKENS[pool.tokenB as keyof typeof TOKENS];
  const noPair = !pool.pair;
  return (
    <button onClick={onClick} disabled={noPair} style={{width:"100%",background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 18px",cursor:noPair?"not-allowed":"pointer",textAlign:"left",transition:"border-color 0.2s",opacity:noPair?0.5:1}} onMouseEnter={e=>{if(!noPair)(e.currentTarget as HTMLButtonElement).style.borderColor="var(--cyan)"}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="var(--border)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{display:"flex"}}>
          <TokenIcon sym={pool.tokenA} size={28}/>
          <TokenIcon sym={pool.tokenB} size={28}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15}}>{pool.label}</div>
          <div style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",marginTop:2}}>Uniswap V2 · {pool.fee}{noPair?" · Pool chưa được tạo":""}</div>
        </div>
        {!noPair && <span style={{color:"var(--cyan)",fontSize:18}}>›</span>}
      </div>
    </button>
  );
}

// ─── Pool detail ──────────────────────────────────────────────────────────────
interface PoolInfo { resA:number; resB:number; totalSupply:number; userLp:number; sharePct:number; userA:number; userB:number; tvlUSD:number; apr:number|null; }

function PoolDetail({pool,wallet,openModal,refreshBalances,onBack}:{pool:PoolDef;wallet:any;openModal:()=>void;refreshBalances:()=>Promise<void>;onBack:()=>void}) {
  const tA = TOKENS[pool.tokenA as keyof typeof TOKENS];
  const tB = TOKENS[pool.tokenB as keyof typeof TOKENS];
  const [tab,setTab]       = useState<"add"|"remove">("add");
  const [info,setInfo]     = useState<PoolInfo|null>(null);
  const [loading,setLoad]  = useState(false);
  const [fetching,setFetch]= useState(false);
  const [status,setStat]   = useState("");
  const [aA,setAA]         = useState("");
  const [aB,setAB]         = useState("");
  const [pct,setPct]       = useState(50);
  const [slip,setSlip]     = useState(0.5);
  const [lastTx,setTx]     = useState<{hash:string;action:string}|null>(null);

  const balA = wallet.connected ? getBal(wallet.balances, pool.tokenA) : 0;
  const balB = wallet.connected ? getBal(wallet.balances, pool.tokenB) : 0;

  const loadInfo = useCallback(async()=>{
    if(!pool.pair) return;
    setFetch(true);
    try {
      const [resRaw,supRaw,lpRaw] = await Promise.all([
        rpc("eth_call",[{to:pool.pair,data:encodeGetReserves()},"latest"]),
        rpc("eth_call",[{to:pool.pair,data:encodeTotalSupply()},"latest"]),
        wallet.connected ? rpc("eth_call",[{to:pool.pair,data:encodeBalanceOfLP(wallet.address)},"latest"]) : Promise.resolve("0x0"),
      ]);
      const hex = (resRaw as string).replace("0x","");
      // sort: token with lower address = token0
      const aIsToken0 = tA.addr.toLowerCase() < tB.addr.toLowerCase();
      const raw0 = hex.length>=64 ? Number(BigInt("0x"+hex.slice(0,64)))/10**tA.decimals : 0;
      const raw1 = hex.length>=128 ? Number(BigInt("0x"+hex.slice(64,128)))/10**tB.decimals : 0;
      const resA = aIsToken0 ? raw0 : raw1;
      const resB = aIsToken0 ? raw1 : raw0;
      const totalSupply = supRaw&&supRaw!=="0x" ? Number(BigInt(supRaw as string))/1e18 : 0;
      const userLp = lpRaw&&lpRaw!=="0x"&&lpRaw!=="0x0" ? Number(BigInt(lpRaw as string))/1e18 : 0;
      const sharePct = totalSupply>0 ? userLp/totalSupply*100 : 0;
      // TVL = resA * 2 (assume tokenA ≈ USD, e.g. USDC/EURC both ~$1, cirBTC excluded)
      const tvlUSD = resA * 2;
      // Volume 24h từ Swap events
      const vol24h = await getVolume24h(pool.pair, tA.decimals);
      // APR = fee 0.3% × volume24h × 365 / TVL
      const apr = tvlUSD > 0 && vol24h > 0 ? (0.003 * vol24h * 365 / tvlUSD * 100) : null;
      setInfo({resA,resB,totalSupply,userLp,sharePct,userA:resA*(sharePct/100),userB:resB*(sharePct/100),tvlUSD,apr});
    } catch(e){console.error(e);}
    finally{setFetch(false);}
  },[pool.pair,wallet.connected,wallet.address]);

  useEffect(()=>{loadInfo();},[loadInfo]);

  function handleAAChange(v:string){
    setAA(v);
    if(info&&info.resA>0&&v) setAB((parseFloat(v)*info.resB/info.resA).toFixed(8));
  }
  function handleABChange(v:string){
    setAB(v);
    if(info&&info.resB>0&&v) setAA((parseFloat(v)*info.resA/info.resB).toFixed(8));
  }

  async function handleAdd(){
    if(!wallet.connected){openModal();return;}
    const amtA=parseFloat(aA)||0,amtB=parseFloat(aB)||0;
    if(!amtA||!amtB) return;
    setLoad(true);setStat("");setTx(null);
    const eth=(window as any).ethereum;
    try{
      await switchToArc();
      const rawA=toUnits(amtA,tA.decimals),rawB=toUnits(amtB,tB.decimals);
      const minA=toUnits(amtA*(1-slip/100),tA.decimals),minB=toUnits(amtB*(1-slip/100),tB.decimals);
      const deadline=BigInt(Math.floor(Date.now()/1000)+1200);

      // Approve A
      setStat(`Checking ${pool.tokenA} allowance…`);
      const allA:any=await rpc("eth_call",[{to:tA.addr,data:encodeAllowance(wallet.address,ROUTER)},"latest"]);
      if(!allA||BigInt(allA)<rawA){
        setStat(`Approve ${pool.tokenA}…`);
        const tx:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:tA.addr,data:encodeApprove(ROUTER,MAX_U256),gas:"0x186A0"}]});
        setStat("Waiting…");if(!await waitTx(tx))throw new Error("Approve A failed");
        await new Promise(r=>setTimeout(r,2000));
      }
      // Approve B
      setStat(`Checking ${pool.tokenB} allowance…`);
      const allB:any=await rpc("eth_call",[{to:tB.addr,data:encodeAllowance(wallet.address,ROUTER)},"latest"]);
      if(!allB||BigInt(allB)<rawB){
        setStat(`Approve ${pool.tokenB}…`);
        const tx:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:tB.addr,data:encodeApprove(ROUTER,MAX_U256),gas:"0x186A0"}]});
        setStat("Waiting…");if(!await waitTx(tx))throw new Error("Approve B failed");
        await new Promise(r=>setTimeout(r,2000));
      }
      // addLiquidity
      setStat("Adding liquidity…");
      const data=encodeAddLiquidity(tA.addr,tB.addr,rawA,rawB,minA,minB,wallet.address,deadline);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:ROUTER,data,gas:"0x493E0"}]});
      setStat("Confirming…");
      if(!await waitTx(txHash))throw new Error("addLiquidity reverted");
      setTx({hash:txHash,action:"Add Liquidity"});
      showToast(true,"Liquidity Added ✓",`${amtA} ${pool.tokenA} + ${amtB} ${pool.tokenB}`);
      setAA("");setAB("");await refreshBalances();await loadInfo();
    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg))showToast(false,"Cancelled","Rejected in wallet.");
      else showToast(false,"Failed",msg.slice(0,120));
    }finally{setLoad(false);setStat("");}
  }

  async function handleRemove(){
    if(!wallet.connected){openModal();return;}
    if(!info||info.userLp<=0){showToast(false,"No liquidity","You have no LP tokens.");return;}
    setLoad(true);setStat("");setTx(null);
    const eth=(window as any).ethereum;
    try{
      await switchToArc();
      const lpRaw=BigInt(Math.floor(info.userLp*(pct/100)*1e18));
      const minA=toUnits(info.userA*(pct/100)*(1-slip/100),tA.decimals);
      const minB=toUnits(info.userB*(pct/100)*(1-slip/100),tB.decimals);
      const deadline=BigInt(Math.floor(Date.now()/1000)+1200);
      // Approve LP
      setStat("Approving LP token…");
      const allLP:any=await rpc("eth_call",[{to:pool.pair,data:encodeAllowance(wallet.address,ROUTER)},"latest"]);
      if(!allLP||BigInt(allLP)<lpRaw){
        const tx:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:pool.pair,data:encodeApprove(ROUTER,MAX_U256),gas:"0x186A0"}]});
        setStat("Waiting LP approve…");if(!await waitTx(tx))throw new Error("LP approve failed");
        await new Promise(r=>setTimeout(r,2000));
      }
      setStat(`Removing ${pct}% liquidity…`);
      const data=encodeRemoveLiquidity(tA.addr,tB.addr,lpRaw,minA,minB,wallet.address,deadline);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:ROUTER,data,gas:"0x493E0"}]});
      setStat("Confirming…");
      if(!await waitTx(txHash))throw new Error("removeLiquidity reverted");
      setTx({hash:txHash,action:`Remove ${pct}%`});
      showToast(true,`Removed ${pct}% ✓`,`~${(info.userA*pct/100).toFixed(4)} ${pool.tokenA} returned`);
      await refreshBalances();await loadInfo();
    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg))showToast(false,"Cancelled","Rejected in wallet.");
      else showToast(false,"Failed",msg.slice(0,120));
    }finally{setLoad(false);setStat("");}
  }

  const rate = info&&info.resA>0 ? info.resB/info.resA : null;

  return (
    <div className="fade-in">
      {/* Back */}
      <button onClick={onBack} style={{background:"none",border:"none",color:"var(--cyan)",cursor:"pointer",fontSize:13,fontFamily:"var(--mono)",padding:"0 0 16px",display:"flex",alignItems:"center",gap:6}}>
        ← All Pools
      </button>

      {/* Pool header */}
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{display:"flex"}}><TokenIcon sym={pool.tokenA} size={30}/><TokenIcon sym={pool.tokenB} size={30}/></div>
          <h1 style={{fontSize:22,fontWeight:800,margin:0}}>{pool.label}</h1>
        </div>
        <p style={{fontSize:12,color:"var(--text2)",margin:0,fontFamily:"var(--mono)"}}>Uniswap V2 · {pool.fee} · Arc Testnet</p>
      </div>

      {/* Stats */}
      <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.5px"}}>Pool Reserves</span>
          <button onClick={loadInfo} disabled={fetching} style={{background:"none",border:"none",color:"var(--cyan)",cursor:"pointer",fontSize:16,animation:fetching?"spin .7s linear infinite":"none"}}>↻</button>
        </div>
        {fetching ? (
          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:13,color:"var(--text2)",fontFamily:"var(--mono)"}}><span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>Loading…</div>
        ) : info ? (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              <div style={{background:"var(--bg2)",borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:"var(--text2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:4}}>{pool.tokenA}</div>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"var(--mono)"}}>{info.resA.toLocaleString(undefined,{maximumFractionDigits:tA.decimals})}</div>
              </div>
              <div style={{background:"var(--bg2)",borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:"var(--text2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:4}}>{pool.tokenB}</div>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"var(--mono)"}}>{info.resB.toLocaleString(undefined,{maximumFractionDigits:tB.decimals})}</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginTop:2}}>
              {rate && <div style={{fontSize:12,color:"var(--text2)",fontFamily:"var(--mono)"}}>1 {pool.tokenA} ≈ <strong style={{color:"var(--text1)"}}>{rate.toFixed(6)}</strong> {pool.tokenB}</div>}
              <div style={{display:"flex",gap:12}}>
                {info.tvlUSD > 0 && <div style={{fontSize:12,fontFamily:"var(--mono)",color:"var(--text2)"}}>TVL: <strong style={{color:"var(--text1)"}}>${info.tvlUSD.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>}
                {info.apr !== null
                  ? <div style={{fontSize:12,fontFamily:"var(--mono)",color:"var(--text2)"}}>APR: <strong style={{color:"var(--green)"}}>{info.apr.toFixed(2)}%</strong></div>
                  : <div style={{fontSize:12,fontFamily:"var(--mono)",color:"var(--text2)"}}>APR: <strong style={{color:"var(--text2)"}}>—</strong> <span style={{fontSize:10,color:"var(--text2)"}}>no volume yet</span></div>
                }
              </div>
            </div>
          </>
        ) : <div style={{fontSize:13,color:"var(--text2)"}}>Could not load pool data.</div>}
      </div>

      {/* Your position */}
      {wallet.connected && info && info.userLp > 0 && (
        <div className="fade-in" style={{background:"rgba(0,200,150,0.06)",border:"1px solid rgba(0,200,150,0.2)",borderRadius:12,padding:"12px 16px",marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:"0.6px",fontFamily:"var(--mono)",marginBottom:8}}>Your Position</div>
          <IR k="Pool Share" v={`${info.sharePct.toFixed(4)}%`} mono/>
          <IR k={pool.tokenA} v={`${info.userA.toFixed(6)}`} green mono/>
          <IR k={pool.tokenB} v={`${info.userB.toFixed(8)}`} green mono/>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",marginBottom:16}}>
        {(["add","remove"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 0",border:"none",borderRadius:0,background:"transparent",color:tab===t?"var(--text0)":"var(--text2)",fontFamily:"var(--mono)",fontSize:13,fontWeight:700,cursor:"pointer",borderBottom:tab===t?"2px solid var(--cyan)":"2px solid transparent"}}>
            {t==="add"?"Add Liquidity":"Remove"}
          </button>
        ))}
      </div>

      {/* Add tab */}
      {tab==="add" && (
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:14,padding:"18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <span style={{fontSize:13,fontWeight:700}}>Deposit amounts</span>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>Slippage:</span>
              {[0.1,0.5,1.0].map(s=>(
                <button key={s} onClick={()=>setSlip(s)} style={{padding:"3px 7px",borderRadius:6,border:"1px solid",borderColor:slip===s?"var(--cyan)":"var(--border)",background:slip===s?"rgba(0,229,255,0.1)":"var(--bg2)",color:slip===s?"var(--cyan)":"var(--text2)",fontSize:10,cursor:"pointer",fontFamily:"var(--mono)",fontWeight:700}}>{s}%</button>
              ))}
            </div>
          </div>

          {/* Token A */}
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}><TokenIcon sym={pool.tokenA} size={20}/><span style={{fontWeight:700,fontSize:14}}>{pool.tokenA}</span></div>
              {wallet.connected && <span style={{fontSize:12,color:"var(--cyan)",cursor:"pointer",fontFamily:"var(--mono)"}} onClick={()=>handleAAChange(balA.toFixed(tA.decimals))}>Balance: <strong>{balA.toFixed(4)}</strong></span>}
            </div>
            <input type="number" placeholder="0.0" value={aA} onChange={e=>handleAAChange(e.target.value)}
              style={{width:"100%",background:"none",border:"none",outline:"none",fontSize:26,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)"}}/>
          </div>

          <div style={{textAlign:"center",fontSize:16,color:"var(--text2)",margin:"4px 0"}}>+</div>

          {/* Token B */}
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}><TokenIcon sym={pool.tokenB} size={20}/><span style={{fontWeight:700,fontSize:14}}>{pool.tokenB}</span></div>
              {wallet.connected && <span style={{fontSize:12,color:"var(--cyan)",cursor:"pointer",fontFamily:"var(--mono)"}} onClick={()=>handleABChange(balB.toFixed(tB.decimals))}>Balance: <strong>{balB.toFixed(8)}</strong></span>}
            </div>
            <input type="number" placeholder="0.0" value={aB} onChange={e=>handleABChange(e.target.value)}
              style={{width:"100%",background:"none",border:"none",outline:"none",fontSize:26,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)"}}/>
          </div>

          {loading && status && (
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",background:"var(--bg2)",borderRadius:10,padding:"8px 12px",marginBottom:12}}>
              <span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>{status}
            </div>
          )}

          {!wallet.connected
            ? <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button onClick={handleAdd} disabled={loading||!parseFloat(aA)||!parseFloat(aB)} className={loading||!parseFloat(aA)||!parseFloat(aB)?"swap-btn disabled-state":"swap-btn ready"} style={{margin:0}}>
                {loading && <span className="spinner"/>}{loading?"Adding…":"Add Liquidity"}
              </button>
          }
        </div>
      )}

      {/* Remove tab */}
      {tab==="remove" && (
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:14,padding:"18px"}}>
          {!wallet.connected ? (
            <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
          ) : !info||info.userLp<=0 ? (
            <div style={{textAlign:"center",padding:"24px 0"}}>
              <div style={{fontSize:32,marginBottom:10}}>💧</div>
              <div style={{fontSize:14,color:"var(--text2)",marginBottom:6}}>No liquidity position</div>
              <button onClick={()=>setTab("add")} style={{marginTop:14,padding:"8px 20px",borderRadius:10,border:"1px solid rgba(0,229,255,0.3)",background:"rgba(0,229,255,0.08)",color:"var(--cyan)",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--mono)"}}>+ Add Liquidity</button>
            </div>
          ) : (
            <>
              <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:13,color:"var(--text2)"}}>Amount to remove</span>
                  <span style={{fontSize:26,fontWeight:800,color:"var(--red)",fontFamily:"var(--mono)"}}>{pct}%</span>
                </div>
                <input type="range" min={1} max={100} value={pct} onChange={e=>setPct(Number(e.target.value))} style={{width:"100%",accentColor:"var(--red)",marginBottom:10}}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                  {[25,50,75,100].map(v=>(
                    <button key={v} onClick={()=>setPct(v)} style={{padding:"7px 0",borderRadius:8,border:"1px solid",borderColor:pct===v?"var(--red)":"var(--border)",background:pct===v?"rgba(224,65,90,0.12)":"var(--bg3)",color:pct===v?"var(--red)":"var(--text2)",fontFamily:"var(--mono)",fontSize:13,fontWeight:700,cursor:"pointer"}}>{v}%</button>
                  ))}
                </div>
              </div>

              <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
                <div style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:8}}>You will receive</div>
                <IR k={pool.tokenA} v={`~${(info.userA*pct/100).toFixed(6)}`} green mono/>
                <IR k={pool.tokenB} v={`~${(info.userB*pct/100).toFixed(8)}`} green mono/>
              </div>

              {loading && status && (
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",background:"var(--bg2)",borderRadius:10,padding:"8px 12px",marginBottom:12}}>
                  <span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>{status}
                </div>
              )}

              <button onClick={handleRemove} disabled={loading} style={{width:"100%",padding:14,borderRadius:12,border:"1px solid rgba(224,65,90,0.4)",background:loading?"var(--bg3)":"rgba(224,65,90,0.14)",color:loading?"var(--text2)":"var(--red)",fontFamily:"var(--mono)",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,margin:0}}>
                {loading&&<span className="spinner"/>}{loading?"Removing…":`Remove ${pct}%`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Last TX */}
      {lastTx && (
        <div className="fade-in" style={{marginTop:14,background:"var(--bg1)",border:"1px solid rgba(0,200,150,0.25)",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{lastTx.action} ✓</span>
          </div>
          <a href={`${ARC_EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",textDecoration:"none"}}>{lastTx.hash.slice(0,8)}…{lastTx.hash.slice(-6)} ↗</a>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PoolPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [selected,  setSelected]  = useState<PoolDef|null>(null);
  const [pools,     setPools]     = useState<PoolDef[]>([]);
  const [discovering, setDiscovering] = useState(true);

  // Dynamically discover pair addresses from Factory
  useEffect(()=>{
    async function discover() {
      setDiscovering(true);
      const results = await Promise.all(
        POOL_PAIRS.map(async p => {
          const tA = TOKENS[p.tokenA as keyof typeof TOKENS].addr;
          const tB = TOKENS[p.tokenB as keyof typeof TOKENS].addr;
          try {
            const raw = await rpc("eth_call", [{ to:FACTORY, data:encodeGetPair(tA, tB) }, "latest"]) as string;
            const addr = "0x" + raw.slice(-40);
            const exists = addr !== "0x0000000000000000000000000000000000000000";
            return { ...p, pair: exists ? addr : "", exists };
          } catch {
            return { ...p, pair: "", exists: false };
          }
        })
      );
      setPools(results);
      setDiscovering(false);
    }
    discover();
  }, []);

  if (selected) {
    return (
      <div className="fade-in" style={{padding:"20px 24px",maxWidth:560,margin:"0 auto"}}>
        <PoolDetail pool={selected} wallet={wallet} openModal={openModal} refreshBalances={refreshBalances} onBack={()=>setSelected(null)}/>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{padding:"20px 24px",maxWidth:560,margin:"0 auto"}}>
      <div style={{marginBottom:22}}>
        <h1 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,marginBottom:3}}>Liquidity Pools</h1>
        <p style={{fontSize:13,color:"var(--text2)"}}>Uniswap V2 · Arc Testnet · 0.3% fee</p>
      </div>
      {discovering ? (
        <div style={{display:"flex",gap:10,alignItems:"center",fontSize:13,color:"var(--text2)",fontFamily:"var(--mono)",padding:"20px 0"}}>
          <span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>Discovering pools from Factory…
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {pools.map(p=>(
            <PoolCard key={p.id} pool={p} onClick={()=>setSelected(p)}/>
          ))}
        </div>
      )}
    </div>
  );
}