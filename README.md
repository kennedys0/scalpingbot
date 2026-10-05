# 🤖 Multi-Chain AI Scalping Telegram Bot

Bot scalping otomatis berbasis kecerdasan buatan (Dual AI Engine via OpenRouter / OpenAI-Compatible) untuk dua chain EVM independen:
1. **Base (Chain ID: 8453)**: Eksekusi swap via Aerodrome & Uniswap V3.
2. **Robinhood Chain (Chain ID: 4663)**: Arbitrum Orbit L2 dengan native ETH gas token, mendukung Uniswap V4 (PoolManager/Universal Router) & Uniswap V3.

---

## 🌟 Fitur Utama

- **Dual AI Scalping Brain (OpenRouter)**: Menggunakan 2 API key terpisah untuk masing-masing chain dengan kuota & model independen (misal: DeepSeek di Base, Claude 3.5 Sonnet di Robinhood).
- **Embedded Crypto Domain Knowledge**: Dilengkapi pengetahuan mendalam tentang mikrostruktur pasar DEX:
  - *Order Flow & Cumulative Volume Delta (CVD)*
  - *Buy Pressure Ratio (Market Buys vs Sells)*
  - *Liquidity Depth vs FDV (Slippage Impact)*
  - *Karakteristik memecoin Base vs token RWA Robinhood*
- **Pre-Computed Math**: Formula kuantitatif (Volume Delta, Buy Pressure Ratio, Volatilitas) dihitung otomatis oleh TypeScript sebelum prompt dikirim ke AI agar AI tidak salah hitung matematika.
- **Safety Pre-Screener (Hemat Kuota AI & Anti-Rug)**: Memfilter token dengan likuiditas rendah (< $5,000), honeypot, dan buy/sell tax tinggi sebelum memanggil AI.
- **Sniper Engine**:
  - *Auto-Snipe*: Mendengarkan event on-chain pembentukan pair pool baru.
  - *Manual Instant Snipe*: Cukup kirimkan alamat Contract Address (CA) token ke chat Telegram untuk membeli instan.
- **Risk Management & Circuit Breakers**:
  - *Clamped Stop-Loss*: Batas maksimal kerugian per trade terkunci (default: max 7%).
  - *Daily Drawdown Breaker*: Jika akumulasi kerugian 24 jam mencapai batas (default: `-0.1 ETH`), bot otomatis menghentikan pembelian baru.
- **Hybrid Execution Engine**:
  - **Paper Trading (Default)**: Simulasi scalping dengan saldo virtual dan slippage realistis tanpa resiko modal riil.
  - **Live On-Chain Trading**: Eksekusi swap on-chain nyata menggunakan private key wallet EVM via Viem.
- **Antarmuka Telegram Interaktif (GrammY)**: Kontrol panel dashboard lengkap dengan tombol inline, notifikasi sinyal scalping dengan ulasan alasan AI, dan tombol darurat *Panic Sell All*.

---

## 📁 Struktur Proyek

```
scalping-bot/
├── src/
│   ├── config/             # Chain config (Base 8453, Robinhood 4663) & Zod env parser
│   ├── core/
│   │   ├── ai/             # Dual OpenRouter AI engine & crypto scalping knowledge base
│   │   ├── scanner/        # DexScreener API scanner & kalkulator mikrostruktur
│   │   ├── screener/       # Anti-honeypot, tax checker & liquidity filter
│   │   ├── sniper/         # On-chain pool listener & instant CA swap pipeline
│   │   ├── risk/           # Hard stop-loss & 24h daily drawdown circuit breaker
│   │   ├── positions/      # Pelacak posisi aktif & real-time TP/SL ticker
│   │   └── execution/      # Paper trader simulator & Viem live DEX router executor
│   ├── storage/            # Local atomic JSON storage (tanpa dependensi native C++)
│   ├── bot/                # GrammY Telegram bot, inline menus & formatters
│   └── index.ts            # Main application bootstrap
├── test/                   # Suite pengujian Vitest (10 file test, 25 skenario)
├── .env.example            # Template environment variables
├── package.json
└── tsconfig.json
```

---

## 🚀 Panduan Memulai

### 1. Salin File Konfigurasi
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```

### 2. Isi Variabel di `.env`
Buka file `.env` dan masukkan:
- `TELEGRAM_BOT_TOKEN`: Token bot Anda dari `@BotFather`.
- `TELEGRAM_ALLOWED_USER_IDS`: ID Telegram Anda (dapat dicek via `@userinfobot`).
- `OPENROUTER_API_KEY_BASE`: API key AI untuk Base chain.
- `OPENROUTER_API_KEY_ROBINHOOD`: API key AI untuk Robinhood chain.
- `WALLET_PRIVATE_KEY`: *(Opsional)* Private key wallet EVM jika ingin Live Trading. Kosongkan jika ingin Paper Trading saja.

### 3. Jalankan Pengujian (Testing)
Pastikan seluruh 25 unit & integration tests lulus:
```bash
npm test
```

### 4. Jalankan Bot
Mode pengembangan (dengan auto-reload):
```bash
npm run dev
```

Atau build dan jalankan mode produksi:
```bash
npm run build
npm start
```

---

## 📱 Penggunaan di Telegram

1. Buka chat bot di Telegram lalu ketik `/start` atau `/menu`.
2. Anda akan melihat **Dashboard Utama**:
   - `[🟢 Start Engine]` / `[🔴 Stop Engine]`: Mulai atau jeda pemindaian otomatis.
   - `[📝 Switch to Paper]` / `[⚡ Switch to Live]`: Beralih antara simulasi dan trading nyata.
   - `[📊 Active Positions]`: Melihat daftar posisi yang sedang berjalan beserta status profit.
   - `[🚨 PANIC SELL ALL]`: Menjual seluruh posisi terbuka seketika di harga pasar.
3. **Instant Snipe**: Cukup *paste* atau kirim alamat Contract Address token (misal: `0x532f27101965dd16442e59d40670faf5ebb142e4`) ke chat bot, bot akan menampilkan tombol cepat untuk mengeksekusi pembelian instan.
