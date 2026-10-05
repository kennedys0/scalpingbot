import axios from 'axios';

export async function fetchLiveTokenPrices(tokenAddresses: string[]): Promise<Record<string, number>> {
  if (!tokenAddresses || tokenAddresses.length === 0) return {};
  const priceMap: Record<string, number> = {};
  const uniqueAddresses = [...new Set(tokenAddresses.filter((a) => a && a.startsWith('0x')))];

  if (uniqueAddresses.length === 0) return {};

  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${uniqueAddresses.join(',')}`,
      { timeout: 4500 }
    );
    const pairs = res.data?.pairs;
    if (Array.isArray(pairs)) {
      for (const pair of pairs) {
        const addr = pair.baseToken?.address;
        const priceStr = pair.priceUsd;
        const price = parseFloat(priceStr);
        if (addr && !isNaN(price) && price > 0) {
          const lower = addr.toLowerCase();
          // Keep the highest liquidity pair if multiple pairs exist
          if (!priceMap[lower] || (pair.liquidity?.usd ?? 0) > 1000) {
            priceMap[addr] = price;
            priceMap[lower] = price;
          }
        }
      }
    }
  } catch (err) {
    // Graceful degradation on network timeout or DexScreener outage
  }

  // Fallback to GeckoTerminal for new launchpad/bonding curve tokens not yet indexed on DexScreener
  const missing = uniqueAddresses.filter((a) => !priceMap[a.toLowerCase()]);
  if (missing.length > 0) {
    for (const net of ['robinhood', 'base']) {
      try {
        const geckoRes = await axios.get(
          `https://api.geckoterminal.com/api/v2/networks/${net}/tokens/multi/${missing.join(',')}`,
          { timeout: 4000, headers: { 'Accept': 'application/json' } }
        );
        const tokens = geckoRes.data?.data;
        if (Array.isArray(tokens)) {
          for (const t of tokens) {
            const addr = t.attributes?.address;
            const price = parseFloat(t.attributes?.price_usd || '0');
            if (addr && !isNaN(price) && price > 0) {
              const lower = addr.toLowerCase();
              priceMap[addr] = price;
              priceMap[lower] = price;
            }
          }
        }
      } catch {
        // Fallback gracefully if rate limited
      }
    }
  }

  return priceMap;
}
