export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMC Pro Terminal | Institutional Command Center</title>
  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Alpine.js -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            bgDark: '#0a0a0f',
            panelDark: '#12121a',
            accent: '#00ffcc',
            neonRed: '#ff3366'
          },
          fontFamily: {
            mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #0a0a0f; color: #e2e8f0; font-family: 'Inter', sans-serif; }
    .glass-panel {
      background: rgba(18, 18, 26, 0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
    }
    .neon-text-green { text-shadow: 0 0 10px rgba(0, 255, 204, 0.5); }
    .neon-text-red { text-shadow: 0 0 10px rgba(255, 51, 102, 0.5); }
    .scanline {
      width: 100%; height: 100px; z-index: 9999; position: absolute; pointer-events: none;
      background: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,255,204,0.1) 50%, rgba(0,0,0,0) 100%);
      opacity: 0.1;
      animation: scanline 8s linear infinite;
    }
    @keyframes scanline {
      0% { top: -100px; }
      100% { top: 100%; }
    }
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
  </style>
</head>
<body class="overflow-x-hidden min-h-screen bg-bgDark relative" x-data="sniperTerminal()">
  <div class="scanline"></div>

  <!-- AUTH GATEWAY -->
  <div x-show="!authenticated" class="fixed inset-0 z-50 flex items-center justify-center bg-bgDark" x-transition.opacity>
    <div class="glass-panel p-8 rounded-2xl w-full max-w-md text-center border-t border-accent/20">
      <i data-lucide="shield-alert" class="w-16 h-16 text-accent mx-auto mb-4 animate-pulse"></i>
      <h2 class="text-2xl font-bold font-mono tracking-widest text-white mb-2">RESTRICTED AREA</h2>
      <p class="text-slate-400 text-sm mb-6 font-mono">Enter authorization key to access live SMC data.</p>
      
      <form @submit.prevent="login">
        <input x-model="password" type="password" placeholder="••••••••" 
               class="w-full bg-black/50 border border-slate-700 text-center text-accent tracking-widest font-mono p-3 rounded-lg focus:outline-none focus:border-accent transition mb-4">
        <button type="submit" class="w-full bg-accent/10 hover:bg-accent/20 text-accent border border-accent/50 font-mono py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(0,255,204,0.1)] hover:shadow-[0_0_20px_rgba(0,255,204,0.3)]">
          INITIALIZE TERMINAL
        </button>
      </form>
      <p x-show="authError" class="text-neonRed text-xs mt-3 font-mono" x-cloak>Access Denied. Invalid Key.</p>
    </div>
  </div>

  <!-- DASHBOARD -->
  <div x-show="authenticated" class="p-4 md:p-6 max-w-[1600px] mx-auto flex flex-col gap-6" style="display: none;">
    
    <!-- Header -->
    <header class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-4">
      <div>
        <h1 class="text-3xl font-bold text-white flex items-center gap-3">
          <i data-lucide="radar" class="text-accent"></i>
          SMC PRO TERMINAL
        </h1>
        <div class="flex items-center gap-4 mt-2 text-sm font-mono text-slate-400">
          <span class="flex items-center gap-2">
            <span class="relative flex h-3 w-3">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3 w-3 bg-accent"></span>
            </span>
            SYSTEM ACTIVE
          </span>
          <span>|</span>
          <span>Updated: <span x-text="lastUpdate" class="text-accent"></span></span>
        </div>
      </div>
      
      <!-- Breaking News Ticker -->
      <div class="glass-panel p-3 rounded-lg flex items-center gap-3 w-full md:w-auto min-w-[300px]">
        <i data-lucide="radio" class="text-neonRed animate-pulse"></i>
        <div class="flex-1 overflow-hidden whitespace-nowrap">
          <div class="text-xs font-bold text-slate-400 mb-0.5">LATEST MACRO FEED</div>
          <div class="text-sm text-white font-mono truncate" x-text="newsHeadline">Awaiting feed...</div>
        </div>
      </div>
    </header>

    <!-- Main Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      <!-- LEFT COLUMN: Prices & Matrix -->
      <div class="lg:col-span-3 flex flex-col gap-6">
        
        <!-- Live Prices -->
        <div class="glass-panel rounded-xl p-5 border-l-4 border-l-accent">
          <h3 class="text-xs font-bold text-slate-400 mb-4 tracking-wider flex items-center gap-2">
            <i data-lucide="activity" class="w-4 h-4"></i> LIVE QUOTES
          </h3>
          <div class="space-y-4">
            <div>
              <div class="text-sm text-slate-500 font-mono mb-1">BTCUSDT (Binance)</div>
              <div class="text-3xl font-mono font-bold text-white tracking-tight" x-text="formatPrice(btcPrice)">--</div>
            </div>
            <div class="h-px bg-white/5 w-full"></div>
            <div>
              <div class="text-sm text-slate-500 font-mono mb-1">XAUUSD (COMEX Futures)</div>
              <div class="text-3xl font-mono font-bold text-white tracking-tight" x-text="formatPrice(goldPrice)">--</div>
              <div class="text-xs mt-1" :class="goldOpen ? 'text-accent' : 'text-neonRed'" x-text="goldOpen ? 'Market Open' : 'Market Closed'"></div>
            </div>
          </div>
        </div>

        <!-- Trend Matrix -->
        <div class="glass-panel rounded-xl p-5">
          <h3 class="text-xs font-bold text-slate-400 mb-4 tracking-wider flex items-center gap-2">
            <i data-lucide="grid" class="w-4 h-4"></i> TREND MATRIX
          </h3>
          <div class="space-y-3 font-mono text-sm">
            <template x-for="tf in matrixTfs" :key="tf.label">
              <div class="flex justify-between items-center p-2 rounded bg-black/40 border border-white/5">
                <span class="text-slate-300" x-text="tf.label"></span>
                <span :class="tf.color" class="font-bold flex items-center gap-1">
                  <i :data-lucide="tf.icon" class="w-3 h-3"></i>
                  <span x-text="tf.trend"></span>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- MIDDLE COLUMN: Order Flow Scanner -->
      <div class="lg:col-span-6 flex flex-col gap-6">
        <div class="glass-panel rounded-xl p-5 flex-1 relative overflow-hidden">
          <div class="absolute top-0 right-0 p-4 opacity-10">
            <i data-lucide="crosshair" class="w-32 h-32"></i>
          </div>
          
          <h3 class="text-xs font-bold text-slate-400 mb-6 tracking-wider flex items-center gap-2 relative z-10">
            <i data-lucide="search" class="w-4 h-4"></i> INSTITUTIONAL ORDER FLOW SCANNER
          </h3>

          <div class="space-y-6 relative z-10">
            <!-- Asset Toggle -->
            <div class="flex bg-black/50 p-1 rounded-lg w-fit">
              <button @click="scannerAsset = 'BTC'" :class="scannerAsset === 'BTC' ? 'bg-panelDark text-white shadow-md' : 'text-slate-500'" class="px-4 py-1.5 rounded-md text-sm font-bold transition">BTCUSDT</button>
              <button @click="scannerAsset = 'GOLD'" :class="scannerAsset === 'GOLD' ? 'bg-panelDark text-white shadow-md' : 'text-slate-500'" class="px-4 py-1.5 rounded-md text-sm font-bold transition">XAUUSD</button>
            </div>

            <!-- Scanner Data -->
            <div class="grid grid-cols-2 gap-4">
              <!-- Resistance/Supply -->
              <div class="bg-red-950/20 border border-red-900/30 p-4 rounded-xl">
                <div class="text-red-400/70 text-xs mb-1 font-mono">SUPPLY (Sell-Side)</div>
                <div class="text-xl font-mono text-neonRed mb-3" x-text="formatPrice(activeScanner.resistance)"></div>
                
                <div class="space-y-2 mt-4 text-sm font-mono">
                  <div class="flex justify-between items-center text-red-300/80">
                    <span>Bearish OB</span>
                    <span x-text="activeScanner.bearOb ? formatPrice(activeScanner.bearOb) : 'None'"></span>
                  </div>
                  <div class="flex justify-between items-center text-red-300/80">
                    <span>Bearish FVG</span>
                    <span x-text="activeScanner.bearFvg ? formatPrice(activeScanner.bearFvg) : 'None'"></span>
                  </div>
                </div>
              </div>

              <!-- Support/Demand -->
              <div class="bg-teal-950/20 border border-teal-900/30 p-4 rounded-xl">
                <div class="text-accent/70 text-xs mb-1 font-mono">DEMAND (Buy-Side)</div>
                <div class="text-xl font-mono text-accent mb-3" x-text="formatPrice(activeScanner.support)"></div>
                
                <div class="space-y-2 mt-4 text-sm font-mono">
                  <div class="flex justify-between items-center text-teal-300/80">
                    <span>Bullish OB</span>
                    <span x-text="activeScanner.bullOb ? formatPrice(activeScanner.bullOb) : 'None'"></span>
                  </div>
                  <div class="flex justify-between items-center text-teal-300/80">
                    <span>Bullish FVG</span>
                    <span x-text="activeScanner.bullFvg ? formatPrice(activeScanner.bullFvg) : 'None'"></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Liquidity Log -->
            <div class="mt-6 border-t border-white/5 pt-4">
              <div class="text-xs font-mono text-slate-500 mb-2">RECENT LIQUIDITY SWEEPS</div>
              <div class="bg-black/40 border border-white/5 rounded p-3 h-24 overflow-y-auto font-mono text-sm space-y-2 scrollbar-hide">
                <template x-if="activeScanner.sweeps.length === 0">
                  <div class="text-slate-600 italic">No sweeps detected in active window.</div>
                </template>
                <template x-for="sweep in activeScanner.sweeps" :key="sweep">
                  <div class="flex items-center gap-2 text-yellow-500/90">
                    <i data-lucide="zap" class="w-3 h-3"></i>
                    <span x-text="sweep"></span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN: Confluence Meter & Best Setup -->
      <div class="lg:col-span-3 flex flex-col gap-6">
        
        <!-- Confluence Meter -->
        <div class="glass-panel rounded-xl p-5 text-center flex flex-col items-center justify-center">
          <h3 class="text-xs font-bold text-slate-400 mb-4 tracking-wider flex items-center justify-center gap-2 w-full">
            <i data-lucide="gauge" class="w-4 h-4"></i> AI CONFLUENCE METER
          </h3>
          
          <div class="relative w-40 h-40 flex items-center justify-center rounded-full border-4 shadow-[0_0_30px_rgba(0,0,0,0.5)] transition-all duration-1000"
               :class="getConfluenceColorClass(bestScore)">
            <div class="text-5xl font-mono font-bold" x-text="bestScore"></div>
            <div class="absolute bottom-4 text-xs font-mono opacity-60">/ 10</div>
          </div>
          
          <div class="mt-4 text-sm font-bold tracking-widest" :class="getConfluenceTextColorClass(bestScore)">
            <span x-show="bestScore >= 7.5">TRADE AUTHORIZED</span>
            <span x-show="bestScore < 7.5">STANDBY MODE</span>
          </div>
        </div>

        <!-- Best Setup Card -->
        <div class="glass-panel rounded-xl p-5 flex-1">
          <h3 class="text-xs font-bold text-slate-400 mb-4 tracking-wider flex items-center gap-2">
            <i data-lucide="target" class="w-4 h-4"></i> BEST ACTIVE SETUP
          </h3>
          
          <template x-if="bestSignal">
            <div class="space-y-4">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-bold text-white" x-text="bestSignal.label"></div>
                  <div class="text-xs text-slate-400 font-mono mt-1" x-text="bestSignal.trend"></div>
                </div>
                <div class="px-2 py-1 rounded text-xs font-bold" 
                     :class="bestSignal.direction === 'LONG' ? 'bg-accent/20 text-accent' : 'bg-neonRed/20 text-neonRed'"
                     x-text="bestSignal.direction">
                </div>
              </div>
              
              <div class="grid grid-cols-2 gap-2 font-mono text-sm">
                <div class="bg-black/30 p-2 rounded border border-white/5 text-center">
                  <div class="text-xs text-slate-500 mb-1">ENTRY</div>
                  <div class="text-white" x-text="formatPrice(bestSignal.entry)"></div>
                </div>
                <div class="bg-black/30 p-2 rounded border border-white/5 text-center">
                  <div class="text-xs text-slate-500 mb-1">R:R</div>
                  <div class="text-white" x-text="'1:' + bestSignal.rr"></div>
                </div>
                <div class="bg-red-950/20 p-2 rounded border border-red-900/30 text-center">
                  <div class="text-xs text-red-500/70 mb-1">STOP LOSS</div>
                  <div class="text-neonRed" x-text="formatPrice(bestSignal.sl)"></div>
                </div>
                <div class="bg-teal-950/20 p-2 rounded border border-teal-900/30 text-center">
                  <div class="text-xs text-teal-500/70 mb-1">TARGET</div>
                  <div class="text-accent" x-text="formatPrice(bestSignal.tp)"></div>
                </div>
              </div>
            </div>
          </template>

          <template x-if="!bestSignal">
            <div class="h-full flex flex-col items-center justify-center text-slate-500 py-6">
              <i data-lucide="loader" class="w-8 h-8 animate-spin mb-3 opacity-20"></i>
              <div class="text-sm font-mono">No High-Probability Setups</div>
              <div class="text-xs opacity-60 mt-1">Scanning market structure...</div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <script>
    document.addEventListener('alpine:init', () => {
      Alpine.data('sniperTerminal', () => ({
        authenticated: false,
        password: '',
        authError: false,
        
        lastUpdate: '--:--:--',
        btcPrice: 0,
        goldPrice: 0,
        goldOpen: true,
        newsHeadline: 'Scanning global feeds...',
        bestScore: 0.0,
        bestSignal: null,
        
        scannerAsset: 'BTC',
        scannerData: { BTC: {}, GOLD: {} },
        matrixTfs: [
          { label: 'BTC 1M', trend: 'SCANNING', color: 'text-slate-500', icon: 'loader' },
          { label: 'BTC 1H', trend: 'SCANNING', color: 'text-slate-500', icon: 'loader' },
          { label: 'BTC 4H', trend: 'SCANNING', color: 'text-slate-500', icon: 'loader' },
          { label: 'XAU 15M', trend: 'SCANNING', color: 'text-slate-500', icon: 'loader' },
          { label: 'XAU 1H', trend: 'SCANNING', color: 'text-slate-500', icon: 'loader' }
        ],

        get activeScanner() {
          return this.scannerData[this.scannerAsset] || {
            support: 0, resistance: 0, bullOb: 0, bearOb: 0, bullFvg: 0, bearFvg: 0, sweeps: []
          };
        },

        init() {
          // Re-init lucide icons when alpine updates
          this.$watch('scannerAsset', () => setTimeout(() => lucide.createIcons(), 50));
          this.$watch('authenticated', (val) => {
            if (val) {
              setTimeout(() => lucide.createIcons(), 50);
              this.startPolling();
            }
          });
          
          const savedKey = localStorage.getItem('sniper_key');
          if (savedKey) {
            this.password = savedKey;
            this.login();
          }
        },

        async login() {
          this.authError = false;
          try {
            const r = await fetch('/api/news-monitor?key=' + encodeURIComponent(this.password));
            if (r.ok) {
              localStorage.setItem('sniper_key', this.password);
              this.authenticated = true;
              this.processData(await r.json());
            } else {
              this.authError = true;
              localStorage.removeItem('sniper_key');
            }
          } catch {
            this.authError = true;
          }
        },

        startPolling() {
          setInterval(async () => {
            if (!this.authenticated) return;
            try {
              const r = await fetch('/api/news-monitor?key=' + encodeURIComponent(this.password));
              if (r.ok) this.processData(await r.json());
              else if (r.status === 401) { this.authenticated = false; localStorage.removeItem('sniper_key'); }
            } catch (e) { console.error('Poll failed', e); }
          }, 10000); // Poll every 10 seconds
        },

        processData(d) {
          const now = new Date();
          this.lastUpdate = now.toLocaleTimeString();
          
          this.btcPrice = d.btcPrice;
          this.goldPrice = d.goldPrice;
          this.goldOpen = d.goldOpen;
          
          if (d.news) {
            this.newsHeadline = d.news.headline;
          }

          if (d.bestSignal) {
            this.bestSignal = d.bestSignal;
            this.bestScore = d.bestSignal.confluenceScore;
          } else {
            this.bestSignal = null;
            // Find highest score among all
            let hs = 0;
            if (d.allTfs) d.allTfs.forEach(s => { if(s.confluenceScore > hs) hs = s.confluenceScore; });
            this.bestScore = hs;
          }

          // Process Matrix & Scanner
          if (d.allTfs) {
            this.matrixTfs = d.allTfs.map(s => {
              const isBull = s.trend.toLowerCase().includes('bull') || s.direction === 'LONG' || s.smc?.direction === 'long';
              const isBear = s.trend.toLowerCase().includes('bear') || s.direction === 'SHORT' || s.smc?.direction === 'short';
              let trendStr = 'NEUTRAL', color = 'text-slate-500', icon = 'minus';
              
              if (isBull) { trendStr = 'BULLISH'; color = 'text-accent'; icon = 'arrow-up-right'; }
              else if (isBear) { trendStr = 'BEARISH'; color = 'text-neonRed'; icon = 'arrow-down-right'; }

              return { label: s.label.replace(/[^a-zA-Z0-9 ]/g, '').trim(), trend: trendStr, color, icon };
            });

            // Extract Scanner data (use 1H BTC and 1H XAU as base)
            const btc1h = d.allTfs.find(s => s.tf === '1h' && s.label.includes('BTC'));
            const xau1h = d.allTfs.find(s => s.tf === '1h' && s.label.includes('XAU')); 

            if (btc1h?.smc) this.scannerData.BTC = this.extractScannerData(btc1h.smc);
            if (xau1h?.smc) this.scannerData.GOLD = this.extractScannerData(xau1h.smc);
          }
          
          setTimeout(() => lucide.createIcons(), 50);
        },

        extractScannerData(smc) {
          const sweeps = [];
          smc.reasons.forEach(r => {
            if (r.toLowerCase().includes('sweep')) sweeps.push(r);
          });
          return {
            support: smc.nearestSupport,
            resistance: smc.nearestResistance,
            bullOb: (smc.hasOb && smc.reasons.some(r=>r.includes('Bullish OB'))) ? smc.obLevel : 0,
            bearOb: (smc.hasOb && smc.reasons.some(r=>r.includes('Bearish OB'))) ? smc.obLevel : 0,
            bullFvg: (smc.hasFvg && smc.reasons.some(r=>r.includes('Bullish FVG'))) ? smc.fvgLow : 0,
            bearFvg: (smc.hasFvg && smc.reasons.some(r=>r.includes('Bearish FVG'))) ? smc.fvgHigh : 0,
            sweeps
          };
        },

        formatPrice(p) {
          if (!p) return '0.00';
          return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p);
        },

        getConfluenceColorClass(score) {
          if (score >= 7.5) return 'border-accent text-accent';
          if (score >= 5.0) return 'border-yellow-500 text-yellow-500';
          return 'border-slate-700 text-slate-500';
        },
        
        getConfluenceTextColorClass(score) {
          if (score >= 7.5) return 'text-accent';
          if (score >= 5.0) return 'text-yellow-500';
          return 'text-slate-500';
        }
      }));
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
