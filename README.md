# 🤖 Multi-Chain AI Scalping Telegram Bot

Bot scalping otomatis berbasis kecerdasan buatan (*Dual AI Engine* via OpenRouter / OpenAI-Compatible) untuk dua chain EVM independen:
1. **Base (Chain ID: 8453)**: Eksekusi swap via Uniswap V2, Aerodrome, dan Uniswap V3 dengan proteksi anti-sandwich MEV Blocker.
2. **Robinhood Chain (Chain ID: 4663)**: Arbitrum Orbit L2 dengan native ETH gas token, mendukung Uniswap V4 (PoolManager & Universal Router) serta Uniswap V3.

---

## 🌟 Fitur Utama & Superpower

### 1. ⚔️ Multi-Agent Debate Engine & Konsensus AI
- **Agent 1 (Bullish Momentum Hunter)**: Menganalisis momentum breakout, akselerasi volume, dan tekanan beli (*order flow*).
- **Agent 2 (Bearish Risk Auditor)**: Mengaudit jebakan rugpull, dev sell pressure, honeypot tersembunyi, dan likuiditas palsu.
- **Konsensus Ketat**: Transaksi hanya dieksekusi jika kedua agen mencapai konsensus skor keyakinan tinggi (≥ 78-80%).

### 2. 🎯 New Token Auto-Sniper (2-Stage AI Defense)
- **Real-Time Pool Listener**: Mendeteksi pembentukan pool likuiditas baru langsung dari event blockchain.
- **Stage 1 (Pre-Snipe AI Veto & Trap Filter)**:
  - Validasi cadangan likuiditas riil (menolak *phantom liquidity trap* dengan cadangan riil < $1.500 meskipun FDV tampak tinggi).
  - Veto instan jika AI Auditor mendeteksi pola distribusi abnormal atau honeypot.
- **Stage 2 (Post-Snipe Active Order Flow Sentinel)**: Pemantauan intensif di menit-menit awal setelah snipe untuk keluar kilat jika dev mulai dump.

### 3. 👛 Multi-Chain Wallet & Deposit Notifier
- **Rincian Saldo Multi-Chain**: Dashboard `/wallet` menampilkan saldo terpisah untuk **Base Chain** dan **Robinhood Chain**, serta total akumulasi aset.
- **Kurs Real-Time**: Konversi otomatis ke USD dan IDR (Rupiah) menggunakan harga live ETH dari CoinGecko dengan fallback teruji.
- **🔔 Deposit Watcher Otomatis**: Background listener memantau wallet setiap 20 detik dan mengirimkan notifikasi instan ke Telegram jika ada saldo ETH baru masuk (`> 0.0001 ETH`) di chain mana pun.
- **Interactive Deposit & Withdraw**:
  - `/deposit`: QR Code otomatis dan instruksi penyetoran ke alamat EVM Anda.
  - `/withdraw <alamat> <jumlah>`: Penarikan saldo ETH langsung dari bot ke wallet eksternal.

### 4. 📈 Dual-Source Live Price Tracker (DexScreener + GeckoTerminal)
- Pemantauan harga live setiap tick menggunakan DexScreener.
- **Fallback GeckoTerminal Otomatis**: Jika token baru belum terindeks di DexScreener (misalnya token baru di Robinhood Chain), bot otomatis mengambil harga dan data likuiditas dari GeckoTerminal On-Chain API tanpa gagal.

### 5. 🛡️ Risk Management & Exit Protection
- **🎯 Individual Market Sell**: Penutupan posisi per token secara spesifik melalui tombol interaktif di Telegram tanpa mengganggu posisi lain.
- **🪜 Partial Take-Profit Laddering**:
  - TP 1 (+15%): Jual 50% alokasi untuk mengamankan profit.
  - Auto-Breakeven: Stop Loss otomatis digeser ke +1% (bebas risiko rugi).
  - Sisa 50% dibiarkan berlari dengan Trailing Stop hingga target maksimal +30%.
- **🛑 Flash Dump & Honeypot Guard**:
  - Simulasi `eth_call` static sell sebelum beli untuk mendeteksi token anti-transfer / 100% sell tax.
  - Emergency exit kilat jika harga dump ≥ 5% dalam 1 tick.
- **⚡ Circuit Breakers**:
  - Max Loss per Trade terkunci (default max 7-10%).
  - Daily Drawdown Breaker: Menghentikan auto-buy jika akumulasi kerugian harian menyentuh batas aman.
  - Stale Trade Exit: Posisi stagnan yang berjalan ≥ 45 menit otomatis ditutup (`TIME_EXPIRATION`).

### 6. 🧠 Episodic Memory & Macro Sentinel
- **Trade Post-Mortem**: Bot mencatat pelajaran dari setiap transaksi yang selesai dan menggunakannya sebagai konteks di prompt berikutnya agar tidak mengulangi kesalahan yang sama.
- **ETH Flash Crash Guard**: Menunda pembukaan posisi jika ETH mengalami penurunan mendadak (≥ -2% dalam 5 menit).

---

## 📁 Struktur Proyek

```
scalping-bot/
├── src/
│   ├── config/             # Konfigurasi chain (Base 8453, Robinhood 4663) & Zod env validation
│   ├── core/
│   │   ├── ai/             # Dual OpenRouter AI client, prompt builder & crypto knowledge base
│   │   ├── scanner/        # DexScreener & GeckoTerminal scanners
│   │   ├── screener/       # On-chain honeypot checks, security score & Smart BlacklistManager
│   │   ├── sniper/         # Real-time pool listener & instant CA swap pipeline
│   │   ├── risk/           # Stop loss, take profit laddering, daily drawdown & streak breaker
│   │   ├── positions/      # Active position manager, trailing stop, & PnL tracker
│   │   ├── services/       # Live price service, multi-chain walletService, & rateService (IDR)
│   │   └── execution/      # Paper simulator & Viem routers (Base V2/V3/Aerodrome, RH V4/V3)
│   ├── storage/            # Atomic JSON persistent storage
│   ├── bot/                # GrammY Telegram bot handlers, keyboards & card formatters
│   └── index.ts            # Entry point aplikasi & background watcher bootstrap
├── test/                   # 23 test suites (84 unit & integration tests)
├── .env.example            # Template konfigurasi environment variables
├── package.json
└── tsconfig.json
```

---

## ⚙️ Persyaratan Sistem

- **Node.js**: Versi `>= 20.0.0`
- **npm** atau **pnpm**
- Akun Telegram (untuk bot token via `@BotFather`)
- API Key AI (OpenRouter atau provider OpenAI-compatible lainnya)

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Kloning Repositori & Instal Dependensi
```bash
git clone https://github.com/username/scalping-bot.git
cd scalping-bot
npm install
```

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Buka `.env` dan lengkapi konfigurasi utama:
```env
# Telegram
TELEGRAM_BOT_TOKEN="8809809935:AAG2Jj2TjX..."
TELEGRAM_ALLOWED_USER_IDS="5390732859"

# AI Configuration (OpenRouter / OpenAI-Compatible)
OPENROUTER_BASE_URL="https://smartsproxy.cloud/v1"
OPENROUTER_API_KEY_BASE="sk-..."
OPENROUTER_API_KEY_ROBINHOOD="sk-..."
AI_MODEL_BASE="rp/gemini-3.8-flash"
AI_MODEL_ROBINHOOD="rp/gemini-3.8-flash"

# EVM Wallet & RPC Providers
WALLET_PRIVATE_KEY="0x..." # Kosongkan jika hanya ingin mode Paper Trading
BASE_RPC_URL="https://mainnet.base.org"
BASE_RPC_FALLBACK="https://base.llamarpc.com"
ROBINHOOD_RPC_URL="https://rpc.mainnet.chain.robinhood.com"
ROBINHOOD_RPC_FALLBACK="https://robinhood-rpc.publicnode.com"

# Trading Mode: "paper" (simulasi aman) atau "live" (swap on-chain)
DEFAULT_TRADING_MODE="paper"
```

### 3. Jalankan Pengujian (Testing)
Verifikasi bahwa seluruh 84 unit & integration test berjalan sempurna:
```bash
npm test
```

### 4. Menjalankan Bot
**Mode Pengembangan (dengan auto-reload):**
```bash
npm run dev
```

**Mode Produksi:**
```bash
npm run build
npm start
```

---

## 🔄 Menjalankan Bot 24/7 di Background (Tanpa Perlu Membuka Terminal)

Agar bot tetap berjalan di server/VPS atau komputer Anda tanpa jendela terminal harus terus terbuka, gunakan **PM2 Process Manager**:

### 1. Instal PM2 Secara Global
```bash
npm install -g pm2
```

### 2. Build & Jalankan Bot dengan PM2
```bash
npm run build
pm2 start dist/index.js --name "scalping-bot"
```

### 3. Perintah Berguna PM2
- **Melihat status bot**: `pm2 status`
- **Melihat log real-time**: `pm2 logs scalping-bot`
- **Merestart bot**: `pm2 restart scalping-bot`
- **Menghentikan bot**: `pm2 stop scalping-bot`
- **Auto-start saat komputer/server reboot**:
  ```bash
  pm2 save
  pm2 startup
  ```

---

## 📱 Daftar Perintah Telegram

| Perintah | Deskripsi |
| :--- | :--- |
| `/start` atau `/menu` | Buka Control Panel Dashboard interaktif utama |
| `/wallet` | Tampilkan saldo multi-chain (Base & Robinhood) + estimasi nilai IDR & USD |
| `/deposit` | Tampilkan alamat deposit EVM dan QR Code otomatis |
| `/withdraw <addr> <amt>` | Tarik saldo ETH dari bot ke dompet tujuan |
| `/positions` | Daftar posisi trading aktif beserta status PnL real-time |
| `/report` | Ringkasan harian performa, Win Rate (%), Total Net PnL, dan trade terbaik/terburuk |
| `/blacklist <CA>` | Masukkan token ke blacklist permanen agar tidak di-scan oleh AI |
| `/whitelist <CA>` | Hapus token dari blacklist |
| `/panic` | Jual seketika seluruh posisi terbuka di harga pasar (*Panic Sell All*) |
| `/settings` | Tinjau parameter risiko (SL, TP, Max Drawdown, Slippage) |
| `/help` | Panduan ringkas penggunaan bot |
| **Kirim CA Token** | Cukup kirim alamat Contract Address token ke obrolan untuk opsi **Instant Snipe**! |

---

## ⚠️ Peringatan Risiko & Keamanan (Disclaimer)

1. **Hot Wallet Khusus**: JANGAN PERNAH menggunakan private key dari wallet utama yang menyimpan aset bernilai besar. Selalu gunakan dompet baru yang khusus dialokasikan untuk bot dengan saldo secukupnya.
2. **Volatilitas DEX & Likuiditas Tipis**: Token baru memiliki volatilitas harga yang sangat ekstrem. Meskipun bot dilengkapi proteksi honeypot on-chain dan anti-dump, slippage riil saat terjadi rugpull kilat di pool tipis dapat melampaui stop-loss teoritis.
3. **Validasi Paper Trading**: Sangat disarankan untuk menjalankan bot dalam mode `paper` terlebih dahulu selama beberapa hari untuk mengamati performa sinyal AI sebelum beralih ke mode `live`.
