# 🚀 Arc DApp — Hướng dẫn đầy đủ (Send · Bridge · Swap)

DApp demo tích hợp **Circle App Kit** trên **Arc Network** với các tính năng Send, Bridge, Swap.  
Xây dựng với **Next.js 15 + TypeScript + Tailwind CSS**, chạy trên Codespace và deploy lên Vercel.

---

## 📋 Mục lục

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Chuẩn bị trước khi bắt đầu](#2-chuẩn-bị-trước-khi-bắt-đầu)
3. [Chạy trên GitHub Codespace](#3-chạy-trên-github-codespace)
4. [Cấu hình môi trường](#4-cấu-hình-môi-trường)
5. [Tính năng Send](#5-tính-năng-send)
6. [Tính năng Bridge](#6-tính-năng-bridge)
7. [Tính năng Swap](#7-tính-năng-swap)
8. [Deploy lên Vercel](#8-deploy-lên-vercel)
9. [Xử lý lỗi thường gặp](#9-xử-lý-lỗi-thường-gặp)

---

## 1. Kiến trúc tổng quan

```
arc-dapp/
├── app/
│   ├── layout.tsx          # Root layout + Nav
│   ├── page.tsx            # Trang chủ
│   ├── globals.css         # Tailwind + theme
│   ├── send/
│   │   ├── actions.ts      # Server Action: kit.send()
│   │   └── page.tsx        # UI trang Send
│   ├── bridge/
│   │   ├── actions.ts      # Server Action: kit.bridge()
│   │   └── page.tsx        # UI trang Bridge
│   └── swap/
│       ├── actions.ts      # Server Action: kit.swap()
│       └── page.tsx        # UI trang Swap
├── components/
│   ├── Nav.tsx             # Navigation bar
│   └── ResultBox.tsx       # Hiển thị kết quả / lỗi
├── lib/
│   └── arc.ts              # Khởi tạo AppKit + adapter
├── .env.example            # Mẫu biến môi trường
└── README.md               # File này
```

### Luồng dữ liệu

```
Browser (Client Component)
    ↓  Form submit
Server Action (Next.js)        ← Private key an toàn ở đây
    ↓  gọi SDK
Circle App Kit (@circle-fin/app-kit)
    ↓  gửi transaction
Arc / EVM Blockchain
    ↓  trả về txHash + explorerUrl
Browser hiển thị kết quả
```

> **Bảo mật:** Private key chỉ tồn tại trên server (Server Actions). 
> Client không bao giờ nhìn thấy private key.

---

## 2. Chuẩn bị trước khi bắt đầu

### 2.1 Tài khoản & Ví cần có

| Thứ cần | Cách lấy |
|---------|----------|
| **EVM Wallet** (MetaMask) | [metamask.io](https://metamask.io) |
| **Private Key** của ví | MetaMask → Account Details → Export Private Key |
| **Testnet USDC** | [faucet.circle.com](https://faucet.circle.com) |
| **Arc Testnet ETH** (gas) | [console.circle.com/faucet](https://console.circle.com/faucet) |
| **Sepolia ETH** (gas cho bridge) | [alchemy.com/faucets](https://www.alchemy.com/faucets/ethereum-sepolia) |
| **Kit Key** (cho Swap) | [console.circle.com](https://console.circle.com) → miễn phí |

### 2.2 Thêm Arc Testnet vào MetaMask

1. Mở MetaMask → Settings → Networks → Add Network
2. Điền thông tin:
   - **Network Name:** Arc Testnet
   - **RPC URL:** `https://rpc.testnet.arc.network`
   - **Chain ID:** `2911`
   - **Symbol:** ETH
   - **Explorer:** `https://testnet.arcscan.app`

### 2.3 Node.js yêu cầu

```bash
node --version   # Cần >= v22
npm --version    # Cần >= v10
```

---

## 3. Chạy trên GitHub Codespace

### Bước 1: Tạo repo và mở Codespace

```bash
# Tạo repo mới trên GitHub, rồi mở Codespace
# hoặc clone repo này về Codespace
git clone https://github.com/YOUR_USERNAME/arc-dapp.git
cd arc-dapp
```

### Bước 2: Cài dependencies

```bash
npm install
```

Lệnh này sẽ cài:
- `@circle-fin/app-kit` — SDK chính
- `@circle-fin/adapter-viem-v2` — Adapter cho EVM với Viem
- `viem` — Thư viện EVM client
- `next`, `react`, `react-dom` — Next.js framework
- `tailwindcss` — Styling

### Bước 3: Cấu hình biến môi trường

```bash
cp .env.example .env.local
# Sau đó mở .env.local và điền giá trị thật (xem Mục 4)
```

> ⚠️ **KHÔNG dùng terminal để echo private key** — mở file bằng editor để tránh lộ ra shell history.

### Bước 4: Chạy development server

```bash
npm run dev
```

Codespace sẽ tự động **forward port 3000**. Nhấn vào URL hiển thị trong tab Ports để mở DApp.

---

## 4. Cấu hình môi trường

Mở file `.env.local` và điền:

```env
# Private key của EVM wallet (MetaMask)
# Format: 0x + 64 ký tự hex
PRIVATE_KEY=0xYOUR_64_CHAR_HEX_PRIVATE_KEY

# Kit Key từ Circle Console — bắt buộc cho Swap
# Đăng nhập tại https://console.circle.com → API Keys → Create Kit Key
KIT_KEY=KIT_KEY:your_key_id:your_key_secret

# (Tuỳ chọn) Alchemy cho RPC nhanh hơn
ALCHEMY_KEY=your_alchemy_api_key
```

### Cách lấy Kit Key

1. Vào [console.circle.com](https://console.circle.com)
2. Đăng ký / đăng nhập (miễn phí)
3. Vào **API Keys** → **Create Kit Key**
4. Copy giá trị có dạng `KIT_KEY:xxx:yyy`

---

## 5. Tính năng Send

**Gửi USDC/EURC tới một địa chỉ trên cùng blockchain.**

### Cách dùng trong app

1. Vào trang `/send`
2. Chọn blockchain (Arc Testnet)
3. Chọn token (USDC hoặc EURC)
4. Nhập địa chỉ nhận (0x...)
5. Nhập số lượng
6. Nhấn **Gửi Token**

### Code cốt lõi

```typescript
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY as string,
});

// Ước tính phí gas trước
const estimate = await kit.estimateSend({
  from: { adapter, chain: "Arc_Testnet" },
  to: "0xRECIPIENT",
  amount: "1.00",
  token: "USDC",
});

// Thực hiện gửi
const result = await kit.send({
  from: { adapter, chain: "Arc_Testnet" },
  to: "0xRECIPIENT",
  amount: "1.00",
  token: "USDC",
});

console.log(result.txHash);      // Hash giao dịch
console.log(result.explorerUrl); // Link xem trên explorer
```

### Kết quả trả về

```json
{
  "name": "transfer",
  "state": "success",
  "txHash": "0x1234...abcd",
  "explorerUrl": "https://testnet.arcscan.app/tx/0x1234..."
}
```

---

## 6. Tính năng Bridge

**Chuyển USDC giữa các EVM blockchain qua Circle CCTP.**

### Các chain hỗ trợ (Testnet)

| Chain | ID trong SDK |
|-------|-------------|
| Arc Testnet | `Arc_Testnet` |
| Ethereum Sepolia | `Ethereum_Sepolia` |
| Avalanche Fuji | `Avalanche_Fuji` |
| Base Sepolia | `Base_Sepolia` |

### Cách dùng trong app

1. Vào trang `/bridge`
2. Chọn chain nguồn và chain đích
3. Nhấn **💰 Ước tính phí** để xem trước chi phí
4. Nhập số lượng USDC
5. Nhấn **Bridge**

### Code cốt lõi

```typescript
// Ước tính phí bridge
const estimate = await kit.estimateBridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet" },
  amount: "1.00",
});
// estimate chứa: gasFee, providerFee, totalFee

// Bridge USDC
const result = await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet" },
  amount: "1.00",
});
```

### Kết quả — mảng steps

```json
{
  "steps": [
    {
      "name": "approve",
      "state": "success",
      "txHash": "0xabc...",
      "explorerUrl": "https://sepolia.etherscan.io/tx/0xabc..."
    },
    {
      "name": "burn",
      "state": "success",
      "txHash": "0xdef...",
      "explorerUrl": "https://sepolia.etherscan.io/tx/0xdef..."
    },
    {
      "name": "mint",
      "state": "success",
      "txHash": "0xghi...",
      "explorerUrl": "https://testnet.arcscan.app/tx/0xghi..."
    }
  ]
}
```

### Cấu hình nâng cao Bridge

```typescript
// Chỉ định người nhận khác
await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { 
    adapter,
    chain: "Arc_Testnet",
    recipientAddress: "0xOTHER_WALLET", // tuỳ chọn
  },
  amount: "1.00",
});

// Thu phí từ dApp
await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet" },
  amount: "1.00",
  fee: {
    recipient: "0xFEE_COLLECTOR_ADDRESS",
    amount: "0.10", // 0.10 USDC phí app
  },
});

// Cấu hình tốc độ (fast / standard)
await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet" },
  amount: "1.00",
  transferSpeed: "fast", // hoặc "standard"
});
```

---

## 7. Tính năng Swap

**Đổi USDC ↔ EURC trên cùng một blockchain.**

> ⚠️ **Yêu cầu:** Cần `KIT_KEY` từ Circle Console. Đây là tính năng duy nhất cần Kit Key.

### Cách dùng trong app

1. Vào trang `/swap`
2. Chọn blockchain (Arc Testnet)
3. Chọn Token In và Token Out
4. Nhấn **📊 Xem tỷ giá** để ước tính
5. Nhập số lượng
6. Nhấn **Swap**

### Code cốt lõi

```typescript
// Ước tính tỷ giá
const estimate = await kit.estimateSwap({
  from: { adapter, chain: "Arc_Testnet" },
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "1.00",
  config: { kitKey: process.env.KIT_KEY as string },
});
// estimate.amountOut — số EURC nhận được
// estimate.fees — các loại phí

// Thực hiện swap
const result = await kit.swap({
  from: { adapter, chain: "Arc_Testnet" },
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "1.00",
  config: { kitKey: process.env.KIT_KEY as string },
});
```

### Kết quả swap

```json
{
  "tokenIn": "USDC",
  "tokenOut": "EURC",
  "amountIn": "1.00",
  "amountOut": "0.93",
  "txHash": "0x789...xyz",
  "explorerUrl": "https://testnet.arcscan.app/tx/0x789...",
  "fees": [
    { "token": "USDC", "amount": "0.001", "type": "provider" }
  ]
}
```

### Cấu hình nâng cao Swap

```typescript
// Slippage tolerance (mặc định 0.5%)
await kit.swap({
  ...params,
  config: {
    kitKey: process.env.KIT_KEY as string,
    slippageTolerance: 1.0, // 1%
  },
});

// Thu phí từ dApp
await kit.swap({
  ...params,
  config: {
    kitKey: process.env.KIT_KEY as string,
    fee: {
      recipient: "0xFEE_COLLECTOR",
      basisPoints: 50, // 0.5% phí app
    },
  },
});
```

---

## 8. Deploy lên Vercel

### Cách 1: Qua Vercel CLI (nhanh nhất)

```bash
# 1. Cài Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy từ thư mục dự án
vercel

# 4. Làm theo hướng dẫn:
#    - Link to existing project? N
#    - Project name: arc-dapp (hoặc tên bạn muốn)
#    - Directory: ./
#    - Build command: để mặc định
```

### Cách 2: Qua GitHub (khuyến nghị cho production)

1. Push code lên GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: Arc DApp initial setup"
   git remote add origin https://github.com/YOUR_USERNAME/arc-dapp.git
   git push -u origin main
   ```

2. Vào [vercel.com](https://vercel.com) → **Add New Project**

3. Import repo GitHub vừa tạo

4. **⚠️ Bước quan trọng — Thêm Environment Variables:**
   - Trong Vercel dashboard → Settings → Environment Variables
   - Thêm từng biến:
     ```
     PRIVATE_KEY  = 0xYOUR_PRIVATE_KEY
     KIT_KEY      = KIT_KEY:xxx:yyy
     ALCHEMY_KEY  = your_alchemy_key   (nếu có)
     ```
   - Chọn Environment: **Production**, **Preview**, **Development**

5. Nhấn **Deploy** → Đợi build xong

6. Vercel tự cấp domain: `https://arc-dapp-xxx.vercel.app`

### Sau khi deploy — kiểm tra

```bash
# Kiểm tra build locally trước khi deploy
npm run build
npm run start
```

### Biến môi trường trên Vercel

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `PRIVATE_KEY` | ✅ | Private key EVM wallet (bắt đầu bằng 0x) |
| `KIT_KEY` | ✅ cho Swap | Kit Key từ Circle Console |
| `ALCHEMY_KEY` | ❌ tuỳ chọn | Cho RPC nhanh hơn trong production |

---

## 9. Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `PRIVATE_KEY chưa được cấu hình` | Thiếu biến môi trường | Kiểm tra `.env.local` hoặc Vercel env vars |
| `KIT_KEY chưa được cấu hình` | Thiếu Kit Key | Lấy miễn phí tại console.circle.com |
| `Insufficient funds` | Ví không đủ token | Nạp testnet USDC từ faucet.circle.com |
| `Gas estimation failed` | Không đủ native token | Nạp ETH testnet cho gas |
| `Chain nguồn và đích trùng nhau` | Lỗi validation | Chọn 2 chain khác nhau khi bridge |
| `No wallet provider found` | Thiếu window.ethereum | Dùng private key adapter thay vì browser wallet |
| Build lỗi `Cannot find module` | Dependencies chưa cài | Chạy `npm install` |

### Debug tips

```bash
# Xem logs chi tiết khi dev
npm run dev

# Test một tính năng cụ thể với script độc lập
npx tsx --env-file=.env.local test-send.ts
```

---

## 📚 Tài liệu tham khảo

- [Arc App Kit Overview](https://docs.arc.network/app-kit)
- [Installation](https://docs.arc.network/app-kit/tutorials/installation)
- [Supported Blockchains](https://docs.arc.network/app-kit/references/supported-blockchains)
- [Adapter Setups](https://docs.arc.network/app-kit/tutorials/adapter-setups)
- [Send Quickstart](https://docs.arc.network/app-kit/quickstarts/send-tokens-same-chain)
- [Bridge EVM Quickstart](https://docs.arc.network/app-kit/quickstarts/bridge-between-evm-chains)
- [Swap Quickstart](https://docs.arc.network/app-kit/quickstarts/swap-tokens-same-chain)
- [Bridge Error Recovery](https://docs.arc.network/app-kit/references/bridge-error-recovery)
- [Circle Console](https://console.circle.com)
- [Circle Faucet](https://faucet.circle.com)
- [Arc Testnet Explorer](https://testnet.arcscan.app)
