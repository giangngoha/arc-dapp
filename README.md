# Matrix — DeFi on Arc Network Testnet

**Matrix** is a decentralized exchange (DEX) built on **Arc Network Testnet**, featuring token swaps, cross-chain bridging, liquidity pools, and token transfers — all powered by Circle's stablecoin infrastructure.

🔗 **Live:** https://matrix-dapp-neon.vercel.app/swap

---

## ✨ Features

### 🔄 Exchange (Swap)
Swap tokens directly on Arc Network using a custom-deployed **Uniswap V2 Router**.

- Supports: **USDC ↔ EURC ↔ cirBTC**
- Real-time price quotes via `getAmountsOut()`
- Price impact calculator
- Slippage tolerance: 0.1% / 0.5% / 1%
- Auto-approve + swap in one flow
- Transaction history (last 3 swaps)

### 🌉 Bridge (CCTP V2)
Cross-chain USDC transfer using **Circle's Cross-Chain Transfer Protocol V2**.

Supported routes:
| From | To |
|---|---|
| Arc Testnet | Ethereum Sepolia |
| Arc Testnet | Avalanche Fuji |
| Ethereum Sepolia | Arc Testnet |
| Avalanche Fuji | Arc Testnet |

Flow: Approve → Burn → Attestation → Mint (fully on-chain, no custodian)

### 💧 Liquidity Pools
Add and remove liquidity from Uniswap V2 pools deployed on Arc Testnet.

| Pool | Pair Contract |
|---|---|
| USDC / EURC | `0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb` |
| USDC / cirBTC | `0xa1d507a9662012bd43bf1ba5e03989d750a8c069` |
| EURC / cirBTC | `0x4404ec28d88768e3d36c3f8b981f662aba09d1c0` |

- View real-time reserves and exchange rate
- Auto-calculate token ratio based on current pool price
- View your LP position and pool share %
- Remove liquidity with percentage slider (25 / 50 / 75 / 100%)

### 📤 Send Tokens
Send any ERC-20 token to any address on Arc Network.

- Lookup token by contract address (auto-fetches symbol, decimals, balance)
- Supports USDC, EURC, cirBTC and any custom ERC-20
- Transaction confirmation with explorer link

---

## 🏗️ Smart Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| Uniswap V2 Factory | `0x8994A0b7E383bd62341319b22A198dEF7154ff9F` |
| Uniswap V2 Router | `0x29E0C2A0780196792dECc9183Dd5aA540c955BDf` |
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |

> Factory and Router were custom-deployed on Arc Testnet using **Foundry**.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, CSS Variables |
| Blockchain | Arc Network Testnet (Chain ID: 5042002) |
| DEX Protocol | Uniswap V2 (custom deployment) |
| Bridge Protocol | Circle CCTP V2 |
| Wallet | MetaMask (via `eth_sendTransaction`) |
| Deployment | Vercel |

> No external wallet SDK — all on-chain interactions use raw ABI encoding via `eth_call` and `eth_sendTransaction` for maximum compatibility with Arc Network.

---

## 🚀 Getting Started

### Prerequisites
- MetaMask wallet
- Arc Testnet added to MetaMask (auto-prompted on first connect)
- Testnet tokens from [faucet.circle.com](https://faucet.circle.com/)

### Arc Testnet
| Field | Value |
|---|---|
| Network Name | Arc Network Testnet |
| RPC URL | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| Currency Symbol | USDC |
| Explorer | https://testnet.arcscan.app |



## 🗺️ Roadmap

- [ ] USDC/cirBTC and EURC/cirBTC pools (contracts deployed, UI in progress)
- [ ] Multi-hop swap routing (e.g. EURC → USDC → cirBTC)
- [ ] Portfolio dashboard (balances + LP positions + PnL)
- [ ] AI Agent integration (Arc ERC-8004)

---

## 🙏 Built with

- [Arc Network](https://arc.io) — Layer 1 blockchain
- [Circle CCTP V2](https://developers.circle.com/cctp) — Cross-chain transfer protocol
- [Uniswap V2](https://docs.uniswap.org/contracts/v2/overview) — AMM protocol
- [Foundry](https://getfoundry.sh) — Smart contract deployment

---