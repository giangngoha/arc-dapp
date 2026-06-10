export const ARC_RPC       = "https://rpc.testnet.arc.network";
export const ARC_CHAIN_ID  = 5042002;
export const ARC_CHAIN_HEX = "0x4cef52";
export const ARC_EXPLORER  = "https://testnet.arcscan.app";
export const FAUCET_URL    = "https://faucet.circle.com/";

export const CONTRACTS = {
  USDC:     "0x3600000000000000000000000000000000000000",
  EURC:     "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  cirBTC:   "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
  FX_ESCROW:"0x867650F5eAe8df91445971f14d89fd84F0C9a9f8",
  PERMIT2:  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  MULTICALL:"0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

export const TOKEN_META: Record<string,{decimals:number;bg:string;name:string}> = {
  USDC:  { decimals:6, bg:"#2775CA", name:"USD Coin"       },
  EURC:  { decimals:6, bg:"#2B5EDD", name:"Euro Coin"      },
  cirBTC:{ decimals:8, bg:"#F7931A", name:"Circle Bitcoin" },
};

export function tokenAddress(sym:string):string { return (CONTRACTS as Record<string,string>)[sym]??""; }
export function tokenDecimals(sym:string):number { return TOKEN_META[sym]?.decimals??6; }
export function toUnits(amount:number,decimals=6):bigint { return BigInt(Math.floor(amount*10**decimals)); }
export function fromUnits(raw:bigint,decimals=6):number { return Number(raw)/10**decimals; }
export function encodeBalanceOf(addr:string):string { return "0x70a08231"+addr.toLowerCase().replace("0x","").padStart(64,"0"); }
export function encodeApprove(spender:string,amount:bigint):string { return "0x095ea7b3"+spender.toLowerCase().replace("0x","").padStart(64,"0")+amount.toString(16).padStart(64,"0"); }
export function encodeAllowance(owner:string,spender:string):string { return "0xdd62ed3e"+owner.toLowerCase().replace("0x","").padStart(64,"0")+spender.toLowerCase().replace("0x","").padStart(64,"0"); }
