# 🤖 Multi-Chain AI Scalping Telegram Bot

Bot scalping otomatis berbasis kecerdasan buatan (Dual AI Engine via OpenRouter / OpenAI-Compatible) untuk dua chain EVM independen:
1. **Base (Chain ID: 8453)**: Eksekusi swap via Uniswap V2, Aerodrome, dan Uniswap V3 dengan proteksi anti-sandwich MEV Blocker.
2. **Robinhood Chain (Chain ID: 4663)**: Arbitrum Orbit L2 dengan native ETH gas token, mendukung Uniswap V4 (PoolManager/Universal Router) & Uniswap V3.

---

## 🌟 Fitur Utama & Superpower AI

- **⚔️ Multi-Agent Debate Engine (Dual-Agent Consensus)**:
  - Memanfaatkan 2 API Key AI secara kolaboratif:
    - **Agent 1 (Bullish Momentum Hunter)**: Mencari sinyal breakout, akselerasi volume, dan potensi explosive.
    - **Agent 2 (Bearish Risk Auditor)**: Mengaudit jebakan rugpull, dev sell pressure, dan fake liquidity.
    - **Konsensus Ketat**: Transaksi hanya dibuka jika kedua AI sepakat dengan skor konsensus ≥ 78-80%!
- **🧠 Self-Reflective Episodic Memory**:
  - Bot memiliki "ingatan" belajar sendiri. Setiap kali trade selesai (TP maupun SL), bot mencatat *Trade Post-Mortem* (alasan keberhasilan/kegagalan).
  - Pada analisis berikutnya, AI disuplai catatan pelajaran masa lalu agar **tidak pernah mengulangi kesalahan yang sama**!
- **🌐 Macro-Market Sentinel (ETH Flash Crash Guard)**:
  - Memantau kondisi makro ETH secara real-time. Jika ETH mengalami penurunan mendadak (≥ -2% dalam 5 menit), bot otomatis beralih ke **Defensive Mode** (jeda auto-buy) untuk mencegah kerugian akibat terseret crash pasar umum.
- **🐋 Smart Money Radar**:
  - Melacak aktivitas dompet trader papan atas (*smart money/whale*). Jika wallet ber-winrate tinggi mengakumulasi token target, skor keyakinan AI otomatis mendapatkan *boost*.
- **Pre-Computed Math**: Formula kuantitatif (Volume Delta, Buy Pressure Ratio, Volatilitas) dihitung otomatis oleh TypeScript sebelum prompt dikirim ke AI agar AI tidak salah hitung matematika.
- **Smart Auto-Blacklist & Whitelist**:
  - Token yang **gagal pre-screening** (likuiditas buruk, tax tinggi, honeypot, anti-dump) atau **ditolak AI (AVOID)** langsung di-blacklist permanen sehingga tidak akan pernah di-scan atau dianalisis ulang, menghemat kuota AI dan waktu!
  - Kelola manual via Telegram: `/blacklist <CA>` dan `/whitelist <CA>`.
- **🪜 Partial Take-Profit Laddering (Scaling Out)**:
  - Saat profit menyentuh **+15%**: Jual **50% alokasi** untuk mengunci profit awal.
  - **Auto-Breakeven**: Stop loss otomatis dinaikkan ke **+1% (Breakeven)**.
  - Sisa 50% posisi dibiarkan berjalan tanpa risiko rugi (*risk-free*) hingga target maksimal **+30%** atau terkena **Trailing Stop**.
- **🛡️ Sistem Anti-Dump, True Anti-Honeypot & MEV Protection**:
  - *On-Chain Sell Simulation (`eth_call`)*: Bot melakukan simulasi static call `getAmountsOut` buy & sell sebelum mengeksekusi pembelian riil untuk mendeteksi honeypot terselubung (whitelist-only, transfer block, atau 100% hidden sell tax).
  - *Flash Dump Guard*: Jika harga posisi terbuka anjlok mendadak ≥ 5% dalam 1 tick, bot seketika memicu `ANTI_DUMP` emergency exit.
  - *MEV Protection*: Transaksi swap Base dialihkan melalui Private RPC (`https://base.mevblocker.io`) untuk mencegah *sandwich attack*.
- **🌐 RPC Failover & Self-Healing Resilience**:
  - *Fallback Transport*: Viem dikonfigurasi dengan multi-transport fallback dan automatic retry backoff saat RPC utama rate-limited.
  - *On-Chain Position Reconciliation*: Saat bot startup atau restart, sistem mencocokkan posisi aktif dengan saldo token ERC-20 riil di wallet. Posisi yang sudah terjual manual di luar bot otomatis ditutup (*auto-reconciled*).
- **⏱️ Dynamic Sizing, Stale Trade Exit & Streak Breaker**:
  - *Dynamic Position Sizing*: Ukuran order dibatasi maksimal 1.5% dari total pool liquidity untuk mencegah *self-price-impact* pada pool tipis.
  - *Stale Trade Time-Based Exit*: Posisi scalping yang berjalan ≥ 45 menit dengan pergerakan harga stagnan (-2% s/d +2%) otomatis ditutup (`TIME_EXPIRATION`) agar modal tidak tertahan.
  - *Streak Circuit Breaker*: Cooldown 30 menit otomatis jika terjadi 3x Stop Loss berturut-turut.
  - *Blacklist TTL*: Token yang gagal pre-screener karena likuiditas awal rendah diberikan masa tunggu 6 jam (TTL) alih-alih diblacklist permanen.
- **Sniper Engine**:
  - *Auto-Snipe*: Mendengarkan event on-chain pembentukan pair pool baru.
  - *Manual Instant Snipe*: Cukup kirimkan alamat Contract Address (CA) token ke chat Telegram untuk membeli instan.
- **Risk Management & Circuit Breakers**:
  - *Clamped Stop-Loss*: Batas maksimal kerugian per trade terkunci di max **10.0%**.
  - *Max Take-Profit*: Target profit dikunci di max **30.0%**.
  - *Daily Drawdown Breaker*: Jika akumulasi kerugian 24 jam mencapai batas (default: `-0.1 ETH`), bot otomatis menghentikan pembelian baru.
- **Hybrid Execution Engine**:
  - **Paper Trading (Default)**: Simulasi scalping dengan saldo virtual dan slippage realistis tanpa resiko modal riil.
  - **Live On-Chain Trading**: Eksekusi swap on-chain nyata menggunakan private key wallet EVM via Viem.
- **Antarmuka Telegram Interaktif (GrammY)**:
  - Dashboard lengkap dengan kontrol engine, toggle Paper/Live, active positions, dan tombol *Panic Sell All*.
  - Command `/report` untuk melihat ringkasan harian performa, Win Rate (%), Total Net PnL, serta Best/Worst Trade.

---

> [!CAUTION]
> **PERINGATAN RISIKO & KEAMANAN DANA (SECURITY DISCLAIMER):**
> 1. **Gunakan Hot Wallet Khusus**: JANGAN PERNAH menggunakan private key wallet utama yang menyimpan aset bernilai besar. Selalu gunakan dompet baru khusus bot dengan saldo ETH secukupnya.
> 2. **Risiko Likuiditas Tipis**: Token baru di DEX memiliki volatilitas ekstrem. Walaupun bot dilengkapi proteksi honeypot on-chain dan anti-dump, slippage riil saat terjadi rugpull kilat di pool tipis bisa melebihi batas stop-loss teoritis.
> 3. **Paper Trading Pertama**: Selalu jalankan mode `paper` terlebih dahulu untuk memvalidasi pola pergerakan pasar dan performa AI sebelum beralih ke mode `live`.

---

## 📁 Struktur Proyek

```
scalping-bot/
├── src/
│   ├── config/             # Chain config (Base 8453, Robinhood 4663) & Zod env parser
│   ├── core/
│   │   ├── ai/             # Dual OpenRouter AI engine & crypto scalping knowledge base
│   │   ├── scanner/        # DexScreener API scanner & kalkulator mikrostruktur
│   │   ├── screener/       # Anti-honeypot, tax checker, anti-dump & Smart BlacklistManager
│   │   ├── sniper/         # On-chain pool listener & instant CA swap pipeline
│   │   ├── risk/           # Hard stop-loss (10%), max TP (30%), daily drawdown circuit breaker
│   │   ├── positions/      # Pelacak posisi, trailing stop, partial TP laddering & real-time ticker
│   │   └── execution/      # Paper trader simulator & Viem DEX router (Base V2/V3/Aerodrome, RH V4/V3)
│   ├── storage/            # Local atomic JSON storage (tanpa dependensi native C++)
│   ├── bot/                # GrammY Telegram bot, inline menus & formatters (/report, /blacklist)
│   └── index.ts            # Main application bootstrap
├── test/                   # Suite pengujian Vitest (11 file test, 32 skenario)
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
Pastikan seluruh 43 unit & integration tests lulus:
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

## 📱 Perintah di Telegram

- `/start` atau `/menu`: Buka kontrol panel dashboard utama.
- `/report`: Tampilkan laporan performa trading harian, Win Rate, PnL bersih, trade terbaik dan terburuk.
- `/blacklist <CA>`: Masukkan alamat token ke daftar hitam agar tidak di-scan oleh AI.
- `/whitelist <CA>`: Hapus alamat token dari daftar hitam.
- `/panic`: Jual seketika seluruh posisi terbuka di harga pasar (*Panic Sell All*).
- `/help`: Panduan ringkas penggunaan bot.
- **Instant Snipe**: Cukup kirim alamat token (CA) ke chat, bot akan menampilkan tombol cepat untuk mengeksekusi pembelian instan!
