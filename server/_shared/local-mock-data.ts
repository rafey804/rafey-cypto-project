/**
 * Rich, premium, dynamic mock data for local development mode.
 * Provides fully-populated, auto-updating data for Gold Intelligence, Crypto,
 * Stocks, Commodities, Earnings Calendar, Liquidity Shifts, and more.
 */

export function getLocalMockDataForKey(key: string): unknown | null {
  const now = Date.now();
  const jitter1 = (now % 10000) / 1000;
  const jitter2 = (now % 50000) / 100;
  const jitter3 = (now % 1000) / 100;

  if (key.includes('market:commodities-bootstrap:v1')) {
    return {
      quotes: [
        { symbol: 'GC=F', name: 'Gold Spot XAUUSD', price: 4063.78 + jitter1, change: 2.09 + jitter3, changePercent: 0.05 + (jitter3 / 100), volume: 154200, lastUpdate: now },
        { symbol: 'SI=F', name: 'Silver Futures', price: 34.25 + jitter3, change: 0.45, changePercent: 1.33, volume: 82100, lastUpdate: now },
        { symbol: 'CL=F', name: 'Crude Oil WTI', price: 71.85 + jitter3, change: -0.35, changePercent: -0.48, volume: 210400, lastUpdate: now },
        { symbol: 'BZ=F', name: 'Brent Crude Oil', price: 75.40 + jitter3, change: -0.25, changePercent: -0.33, volume: 185300, lastUpdate: now },
        { symbol: 'HG=F', name: 'Copper Futures', price: 4.35 + (jitter3 / 10), change: 0.05, changePercent: 1.16, volume: 45200, lastUpdate: now }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('market:stocks-bootstrap:v1')) {
    return {
      quotes: [
        { symbol: '^GSPC', name: 'S&P 500', price: 5864.20 + jitter1, change: 24.50, changePercent: 0.42, volume: 2450000000, lastUpdate: now },
        { symbol: '^DJI', name: 'Dow Jones Industrial Average', price: 43275.50 + jitter2, change: 152.30, changePercent: 0.35, volume: 321000000, lastUpdate: now },
        { symbol: '^IXIC', name: 'NASDAQ Composite', price: 18540.80 + jitter2, change: 112.40, changePercent: 0.61, volume: 4120000000, lastUpdate: now },
        { symbol: 'AAPL', name: 'Apple Inc.', price: 235.10 + jitter3, change: 3.40, changePercent: 1.47, volume: 52100000, lastUpdate: now },
        { symbol: 'MSFT', name: 'Microsoft Corporation', price: 428.15 + jitter3, change: 5.20, changePercent: 1.23, volume: 28400000, lastUpdate: now },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 142.50 + jitter3, change: 4.10, changePercent: 2.96, volume: 89500000, lastUpdate: now }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('market:crypto:v1')) {
    return {
      quotes: [
        { symbol: 'BTC-USD', name: 'Bitcoin USD', price: 68450.20 + jitter2, change: 1250.40 + jitter1, changePercent: 1.86 + (jitter3 / 10), volume: 38500000000, lastUpdate: now },
        { symbol: 'ETH-USD', name: 'Ethereum USD', price: 2745.80 + jitter1, change: 68.20 + jitter3, changePercent: 2.55 + (jitter3 / 10), volume: 18400000000, lastUpdate: now },
        { symbol: 'SOL-USD', name: 'Solana USD', price: 175.40 + jitter3, change: 8.50, changePercent: 5.12, volume: 4500000000, lastUpdate: now },
        { symbol: 'BNB-USD', name: 'BNB USD', price: 595.20 + jitter3, change: 14.20, changePercent: 2.44, volume: 1200000000, lastUpdate: now },
        { symbol: 'XRP-USD', name: 'XRP USD', price: 0.585 + (jitter3 / 100), change: 0.015, changePercent: 2.63, volume: 950000000, lastUpdate: now }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('market:cot:v1')) {
    return {
      cot: {
        gold: { netPositions: 245100 + Math.floor(now % 1000), changeWeekly: 12400, sentiment: 'Highly Bullish', lastUpdate: now },
        silver: { netPositions: 58400, changeWeekly: 3200, sentiment: 'Bullish', lastUpdate: now },
        bitcoin: { netPositions: 18500, changeWeekly: 2100, sentiment: 'Bullish', lastUpdate: now }
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:gold-extended:v1')) {
    return {
      extended: {
        technicals: { rsi14: 64.2 + (now % 10) / 10, macd: 'Bullish Crossover', support: 2720, resistance: 2780, trend: 'Strong Bullish' },
        fundamentals: { realRateHeadwind: 'Diminishing', centralBankDemand: 'Very Strong', geopoliticalPremium: 'High', physicalDemand: 'Robust in Asia' }
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:gold-etf-flows:v1')) {
    return {
      etfFlows: {
        gld: { flowWeeklyInflowMillion: 420.5 + (now % 100) / 10, totalHoldingTonnes: 885.2, monthToDateMillion: 1250.8, sentiment: 'Strong Inflows' },
        iau: { flowWeeklyInflowMillion: 185.2, totalHoldingTonnes: 412.5, monthToDateMillion: 450.4, sentiment: 'Moderate Inflows' }
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:gold-cb-reserves:v1')) {
    return {
      cbReserves: {
        topBuyers: [
          { country: 'China (PBoC)', tonnes: 18.5, change: 'Steady Accumulation' },
          { country: 'Poland (NBP)', tonnes: 14.2, change: 'Strategic Increase' },
          { country: 'Turkey (CBRT)', tonnes: 11.0, change: 'Reserves Addition' },
          { country: 'India (RBI)', tonnes: 9.5, change: 'Consistent Buying' }
        ],
        totalQuarterlyTonnes: 285.4,
        notes: 'Central bank gold buying remains historically elevated as institutions diversify away from US dollar reserves.'
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:earnings-calendar:v1')) {
    return {
      earnings: [
        { symbol: 'NVDA', name: 'NVIDIA Corporation', date: '2026-06-29', epsEstimate: 0.65, revenueEstimate: 28500000000, quarter: 'Q2 2026', status: 'Confirmed', surpriseHistory: 'Strong Beat' },
        { symbol: 'AAPL', name: 'Apple Inc.', date: '2026-07-02', epsEstimate: 1.35, revenueEstimate: 84500000000, quarter: 'Q3 2026', status: 'Confirmed', surpriseHistory: 'Consistent Beat' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', date: '2026-07-08', epsEstimate: 2.70, revenueEstimate: 64200000000, quarter: 'Q4 2026', status: 'Confirmed', surpriseHistory: 'Strong Beat' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.', date: '2026-07-15', epsEstimate: 1.15, revenueEstimate: 148500000000, quarter: 'Q2 2026', status: 'Confirmed', surpriseHistory: 'Beat' },
        { symbol: 'TSLA', name: 'Tesla Inc.', date: '2026-07-22', epsEstimate: 0.62, revenueEstimate: 24800000000, quarter: 'Q2 2026', status: 'Confirmed', surpriseHistory: 'Mixed' }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('market:fear-greed:v1')) {
    return {
      index: {
        value: 72 + Math.floor(now % 5),
        rating: 'Greed',
        historical: { previousClose: 71, oneWeekAgo: 65, oneMonthAgo: 55, oneYearAgo: 45 },
        components: {
          marketMomentum: 'Greed',
          stockPriceStrength: 'Extreme Greed',
          stockPriceBreadth: 'Greed',
          putCallRatio: 'Neutral',
          marketVolatility: 'Greed',
          safeHavenDemand: 'Fear',
          junkBondDemand: 'Extreme Greed'
        }
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:hyperliquid:flow:v1')) {
    return {
      flow: {
        totalVolume24h: 1850000000 + (now % 10000000),
        netInflow24h: 142500000 + (now % 1000000),
        topPairs: [
          { pair: 'BTC-USD', volume24h: 850000000, fundingRate: 0.0125, openInterest: 420000000 },
          { pair: 'ETH-USD', volume24h: 420000000, fundingRate: 0.0085, openInterest: 185000000 },
          { pair: 'SOL-USD', volume24h: 210000000, fundingRate: 0.0150, openInterest: 95000000 }
        ],
        regime: 'Bullish Liquidity Expansion',
        analysis: 'Institutional capital continues to rotate into large-cap perps with strong positive funding rates.'
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:stablecoins:v1')) {
    return {
      stablecoins: {
        totalMarketCap: 168500000000 + (now % 100000000),
        inflow24h: 850000000 + (now % 1000000),
        breakdown: [
          { symbol: 'USDT', name: 'Tether', marketCap: 118500000000, pegStatus: 1.000, volume24h: 45000000000 },
          { symbol: 'USDC', name: 'USD Coin', marketCap: 35400000000, pegStatus: 1.000, volume24h: 28000000000 },
          { symbol: 'DAI', name: 'Dai', marketCap: 5200000000, pegStatus: 1.000, volume24h: 1200000000 }
        ],
        liquidityShift: 'Significant Inflow',
        commentary: 'Tether and USDC minting activity indicates fresh fiat capital deployment into crypto markets.'
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:etf-flows:v1')) {
    return {
      etfFlows: {
        totalNetInflowMillion: 385.4 + (now % 50) / 10,
        topInflows: [
          { ticker: 'IBIT', name: 'iShares Bitcoin Trust', inflowMillion: 185.2, totalAssetsMillion: 22450 },
          { ticker: 'FBTC', name: 'Fidelity Wise Origin Bitcoin', inflowMillion: 95.4, totalAssetsMillion: 14210 },
          { ticker: 'ARKB', name: 'ARK 21Shares Bitcoin ETF', inflowMillion: 45.8, totalAssetsMillion: 3850 },
          { ticker: 'BITB', name: 'Bitwise Bitcoin ETF', inflowMillion: 32.5, totalAssetsMillion: 2940 }
        ],
        btcRegime: 'Institutional Accumulation',
        lastUpdated: now
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:sectors:v2')) {
    return {
      sectors: [
        { name: 'Information Technology', changePercent: 1.85, weight: 29.5, topMover: { symbol: 'NVDA', changePercent: 2.96 } },
        { name: 'Financials', changePercent: 0.85, weight: 13.2, topMover: { symbol: 'JPM', changePercent: 1.42 } },
        { name: 'Health Care', changePercent: -0.25, weight: 12.1, topMover: { symbol: 'UNH', changePercent: -0.85 } },
        { name: 'Consumer Discretionary', changePercent: 1.12, weight: 10.5, topMover: { symbol: 'AMZN', changePercent: 1.45 } },
        { name: 'Communication Services', changePercent: 1.45, weight: 8.9, topMover: { symbol: 'GOOGL', changePercent: 1.68 } },
        { name: 'Energy', changePercent: -0.45, weight: 3.8, topMover: { symbol: 'XOM', changePercent: -0.65 } }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('economic:macro-signals:v1')) {
    return {
      signals: {
        globalRecessionProbability: 18.5,
        inflationTrend: 'Moderating',
        monetaryPolicyStance: 'Easing',
        financialStressIndex: 'Low',
        geopoliticalRiskIndex: 'Elevated',
        summary: 'Global economic growth remains resilient with major central banks continuing their gradual easing cycles.'
      },
      lastUpdated: now
    };
  }

  if (key.includes('market:gulf-quotes:v1')) {
    return {
      quotes: [
        { symbol: 'TASI.SR', name: 'Tadawul All Share', price: 12150.40 + jitter1, change: 45.20, changePercent: 0.37, volume: 185000000, lastUpdate: now },
        { symbol: 'DFMGI.AE', name: 'DFM General Index', price: 4420.10 + jitter3, change: 12.40, changePercent: 0.28, volume: 92000000, lastUpdate: now }
      ],
      lastUpdated: now
    };
  }

  if (key.includes('market:defi-tokens:v1') || key.includes('market:ai-tokens:v1') || key.includes('market:other-tokens:v1')) {
    return {
      tokens: [
        { symbol: 'UNI-USD', name: 'Uniswap', price: 8.45 + jitter3, changePercent: 4.12, volume24h: 185000000 },
        { symbol: 'AAVE-USD', name: 'Aave', price: 142.50 + jitter1, changePercent: 3.85, volume24h: 95000000 },
        { symbol: 'FET-USD', name: 'Fetch.ai', price: 1.45 + (jitter3 / 10), changePercent: 6.45, volume24h: 125000000 }
      ],
      lastUpdated: now
    };
  }

  // Generic rich fallback for any other key so nothing ever fails or shows unavailable
  return {
    available: true,
    unavailable: false,
    dataAvailable: true,
    lastUpdated: now,
    status: 'Active',
    quotes: [
      { symbol: 'BTC-USD', name: 'Bitcoin USD', price: 68450.20 + jitter2, change: 1250.40, changePercent: 1.86, volume: 38500000000, lastUpdate: now },
      { symbol: 'GC=F', name: 'Gold Futures', price: 2754.30 + jitter1, change: 14.50, changePercent: 0.53, volume: 154200, lastUpdate: now }
    ],
    summary: 'Data feed active and auto-updating in real-time.',
    data: { active: true, timestamp: now },
    items: []
  };
}
