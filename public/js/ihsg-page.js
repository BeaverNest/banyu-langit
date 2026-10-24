// ═══════════════════════════════════════════════════════════════════════════
// IHSG PAGE — menu "IHSG" (permintaan owner 24 Okt 2026).
//
// Halaman ini menjawab satu pertanyaan: "IHSG sedang di mana, dan seberapa sehat
// kenaikannya?" Karena itu isinya tiga lapis, bukan satu grafik harga:
//   1. LEVEL  — harga + MA + jarak dari high/low 52 minggu.
//   2. BREADTH — % emiten di atas MA20/50/200. Level bisa naik oleh 5 saham besar
//                sementara 900 saham lain turun; breadth yang membongkar itu.
//   3. ARUS   — foreign net per sesi, nilai vs MA20, adv/dec, ARA/ARB.
//
// Aturan tampilan: angka null WAJIB tampil "—", tidak boleh jadi 0,00%. 0,00% berarti
// "datar" dan itu klaim yang berbeda dari "tidak ada data".
// ═══════════════════════════════════════════════════════════════════════════

var ihgData = null;
var ihgLoading = false;
var ihgCharts = [];        // chart LWC halaman ini; dibuang saat render ulang

function ihgNum(v, d) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
}
function ihgPct(v) {
  if (v == null || isNaN(v)) return '—';
  return (Number(v) > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
}
function ihgColor(v) {
  if (v == null || isNaN(v)) return 'var(--t3)';
  if (Number(v) > 0) return 'var(--up)';
  if (Number(v) < 0) return 'var(--dn)';
  return 'var(--t2)';
}
function ihgRp(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + ' T';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' M';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' jt';
  return n.toLocaleString('en-US');
}
function ihgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ═══ Sub-tab IHSG ═══
// Empat panel dalam satu menu: ringkasan IHSG, Sector Performance, Sector/Industry Flow,
// Stock List. Tiga yang terakhir dipindah dari Market Intel (owner, 24 Okt 2026).
// Catatan: Sector Performance dan Flow memakai kontainer yang SAMA (#sector-content) dan
// dibedakan oleh variabel global `secIntView` milik sector-intelligence.js.
var ihgTabActive = 'overview';

function ihsgTab(tab, btn) {
  ihgTabActive = tab;
  // Tandai tombol aktif. `btn` bisa null kalau dipanggil programatik (mis. dari tautan sektor).
  var bar = document.querySelectorAll('#t-ihsg .wt-b');
  bar.forEach(function (b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  else {
    var map = { overview: 'IHSG', sector: 'Sector Performance', flow: 'Sector/Industry Flow', stocklist: 'Stock List', stockdetail: 'Stock Information' };
    bar.forEach(function (b) { if (b.textContent.trim() === map[tab]) b.classList.add('on'); });
  }

  document.querySelectorAll('#t-ihsg .wp').forEach(function (p) { p.classList.remove('on'); });

  if (tab === 'overview') {
    var ov = document.getElementById('ihsg-overview');
    if (ov) ov.classList.add('on');
    if (typeof loadIhsgPage === 'function') loadIhsgPage();
    return;
  }
  if (tab === 'sector' || tab === 'flow') {
    var sc = document.getElementById('ihsg-sector');
    if (sc) sc.classList.add('on');
    // Reset drill-down supaya selalu mulai dari level teratas.
    if (tab === 'sector') {
      if (typeof sectorDrillSector !== 'undefined') sectorDrillSector = '';
      if (typeof sectorDrillIndustry !== 'undefined') sectorDrillIndustry = '';
      if (typeof secIntView !== 'undefined') secIntView = 'rotation';
    } else {
      if (typeof secIntView !== 'undefined') secIntView = 'timeline';
    }
    if (typeof secIntEmbedded !== 'undefined') secIntEmbedded = true;
    var body = document.getElementById('sector-content');
    if (body && !document.getElementById('sec-int-body')) body.innerHTML = '<div class="ne">Loading...</div>';
    if (typeof loadSectorView === 'function') loadSectorView();
    return;
  }
  if (tab === 'stocklist') {
    var sl = document.getElementById('ihsg-stocklist');
    if (sl) sl.classList.add('on');
    if (typeof idxView !== 'undefined') idxView = 'rankings';
    if (typeof idxEmbedded !== 'undefined') idxEmbedded = true;
    // idx-daily-v2 menyimpan shell; paksa render ulang supaya tabel muncul saat pertama dibuka.
    if (typeof idxShellRendered !== 'undefined') idxShellRendered = false;
    if (typeof loadIdxDaily === 'function') loadIdxDaily();
    return;
  }
  if (tab === 'stockdetail') {
    var sd = document.getElementById('ihsg-stockdetail');
    if (sd) sd.classList.add('on');
    // Stock Information butuh kode saham. Kalau belum ada yang dipilih (mis. user membuka
    // tab ini langsung dari sidebar), jangan panggil loadStockDetail() dengan kode kosong —
    // itu memicu request 404 dan panel kosong tanpa penjelasan. Tampilkan panduan singkat.
    if (typeof sdCode !== 'undefined' && sdCode) {
      if (typeof loadStockDetail === 'function') loadStockDetail();
    } else if (typeof loadStockDetail === 'function') {
      loadStockDetail();   // skrip sendiri menampilkan state "Enter ticker"
    }
    return;
  }
}

function loadIhsgPage() {
  const el = document.getElementById('ihsg-content');
  if (!el) return;
  if (ihgData) { ihgRender(el); return; }
  if (ihgLoading) return;
  ihgLoading = true;
  el.innerHTML = '<div class="ne" style="padding:40px">Loading IHSG...</div>';
  fetch('/api/idx/ihsg-page')
    .then((r) => r.json())
    .then((d) => {
      ihgLoading = false;
      if (!d.available) { el.innerHTML = '<div class="ne" style="padding:24px">Data IHSG tidak tersedia: ' + ihgEsc(d.reason || d.error || 'tidak diketahui') + '</div>'; return; }
      ihgData = d;
      ihgRender(el);
    })
    .catch((e) => { ihgLoading = false; el.innerHTML = '<div class="ne" style="padding:24px">Error: ' + ihgEsc(e.message) + '</div>'; });
}

function ihgDispose() {
  ihgCharts.forEach((c) => { try { if (c.__ro) c.__ro.disconnect(); c.remove(); } catch (e) {} });
  ihgCharts = [];
}

function ihgRender(el) {
  const d = ihgData, L = d.level, B = d.breadth, F = d.flow;
  ihgDispose();

  const CARD = (label, value, sub, color) =>
    '<div style="flex:1 1 150px;min-width:140px;border:1px solid var(--b1);border-radius:5px;padding:7px 9px;background:var(--bg1)">'
    + '<div style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--t3);margin-bottom:3px">' + ihgEsc(label) + '</div>'
    + '<div style="font-size:17px;font-weight:700;color:' + (color || 'var(--t1)') + ';line-height:1.15">' + value + '</div>'
    + (sub ? '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + sub + '</div>' : '')
    + '</div>';

  let h = '';
  h += '<div style="padding:10px 12px 4px">';
  h += '<div style="font-size:11px;color:var(--t3);margin-bottom:8px">'
     + 'Indeks Harga Saham Gabungan · data per <b style="color:var(--t2)">' + ihgEsc(d.as_of) + '</b>'
     + ' · ' + L.sessions + ' sesi tersedia sejak ' + ihgEsc(L.from_date)
     + '</div>';

  // ── Kartu ringkas ──
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
  h += CARD('IHSG', ihgNum(L.close), 'prev ' + ihgNum(L.prev) + ' · ' + ihgPct(L.chg_pct), ihgColor(L.chg_pct));
  h += CARD('1D / 5D', ihgPct(L.chg_pct) + ' / ' + ihgPct(L.chg_5d), '20D ' + ihgPct(L.chg_20d) + ' · 60D ' + ihgPct(L.chg_60d));
  h += CARD('YTD', ihgPct(L.chg_ytd), '120 sesi ' + ihgPct(L.chg_120d), ihgColor(L.chg_ytd));
  h += CARD('Dari puncak 52 mg', ihgPct(L.pct_from_high), 'high ' + ihgNum(L.high_52w) + ' · low ' + ihgNum(L.low_52w), ihgColor(L.pct_from_high));
  h += CARD('Di atas MA20', ihgPct(L.vs_ma20), 'MA20 ' + ihgNum(L.ma20) + ' · MA50 ' + ihgNum(L.ma50), ihgColor(L.vs_ma20));
  h += CARD('Di atas MA200', ihgPct(L.vs_ma200), 'MA200 ' + ihgNum(L.ma200), ihgColor(L.vs_ma200));
  h += '</div>';

  // ── Chart harga ──
  h += '<div style="border:1px solid var(--b1);border-radius:5px;background:var(--bg1);margin-bottom:8px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 8px;border-bottom:1px solid var(--b1)">'
     + '<span style="font-size:10px;font-weight:700">IHSG — ' + (d.series.length) + ' sesi</span>'
     + '<span style="font-size:9px;color:var(--t3)">' + (d.ohlc_from ? 'candle sejak ' + ihgEsc(d.ohlc_from) + ', sebelumnya garis' : 'garis') + '</span></div>';
  // Legenda manual: LWC hanya menaruh label harga di sumbu kanan, tanpa nama seri, sehingga
  // orange/purple tidak bisa dibedakan pembaca. Warna di sini HARUS sama dengan ihgTheme().
  const lg = (col, txt) => '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px">'
    + '<span style="width:12px;height:2px;background:' + col + ';display:inline-block"></span>'
    + '<span style="font-size:9px;color:var(--t3)">' + txt + '</span></span>';
  h += '<div style="padding:4px 8px 0">'
     + lg(ihgTheme().line, 'IHSG (garis sebelum ' + ihgEsc(d.ohlc_from || '—') + ')')
     + lg(ihgTheme().ma20, 'MA20 ' + ihgNum(L.ma20))
     + lg(ihgTheme().ma50, 'MA50 ' + ihgNum(L.ma50))
     + '<span style="font-size:9px;color:var(--t3)">candle ' + ihgEsc(d.ohlc_from || '—') + ' → ' + ihgEsc(d.as_of) + '</span>'
     + '</div>';
  h += '<div id="ihg-price" style="height:clamp(300px,38vh,460px)"></div></div>';

  // ── Breadth + arus ──
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px;margin-bottom:8px">';
  h += '<div style="border:1px solid var(--b1);border-radius:5px;background:var(--bg1)">'
     + '<div style="padding:5px 8px;border-bottom:1px solid var(--b1);font-size:10px;font-weight:700">Breadth — % emiten di atas MA20</div>'
     + '<div id="ihg-breadth" style="height:clamp(180px,22vh,260px)"></div>'
     + '<div style="padding:5px 8px;border-top:1px solid var(--b1);font-size:9px;color:var(--t3)">'
     + B.pct_above_ma20 + '% di atas MA20 · ' + B.pct_above_ma50 + '% MA50 · ' + B.pct_above_ma200 + '% MA200 · '
     + 'new high ' + B.new_high + ' / new low ' + B.new_low + ' dari ' + B.total + ' emiten</div></div>';
  h += '<div style="border:1px solid var(--b1);border-radius:5px;background:var(--bg1)">'
     + '<div style="padding:5px 8px;border-bottom:1px solid var(--b1);font-size:10px;font-weight:700">Foreign net per sesi</div>'
     + '<div id="ihg-flow" style="height:clamp(180px,22vh,260px)"></div>'
     + '<div style="padding:5px 8px;border-top:1px solid var(--b1);font-size:9px;color:var(--t3)">'
     + 'Hari ini ' + ihgRp(F.net_today) + ' · 5D ' + ihgRp(F.net_5d) + ' · 20D ' + ihgRp(F.net_20d) + '</div></div>';
  h += '</div>';

  // ── Tabel sesi terakhir + tape ──
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px">';
  h += '<div style="border:1px solid var(--b1);border-radius:5px;background:var(--bg1)">'
     + '<div style="padding:5px 8px;border-bottom:1px solid var(--b1);font-size:10px;font-weight:700">Sesi terakhir</div><table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  const rows = [
    ['Pembukaan (prev)', L.ohlc ? ihgNum(L.ohlc.open) : '—'],
    ['Tertinggi', L.ohlc ? ihgNum(L.ohlc.high) : '—'],
    ['Terendah', L.ohlc ? ihgNum(L.ohlc.low) : '—'],
    ['Nilai transaksi', F.value_today ? ihgRp(F.value_today) : '—'],
    ['vs MA20 nilai', F.value_ratio ? F.value_ratio.toFixed(2) + '×' : '—'],
    // Satuan volume ditulis "miliar lbr", bukan "M lbr": di halaman ini "M" sudah dipakai
    // untuk rupiah miliar di ihgRp(), dan 43,2 M bisa dibaca 43,2 miliar rupiah.
    ['Volume', L.ohlc ? (L.ohlc.volume / 1e9).toFixed(1) + ' miliar lbr' : '—'],
    ['Frekuensi', L.ohlc ? Number(L.ohlc.frequency).toLocaleString('en-US') : '—'],
  ];
  rows.forEach((r) => {
    h += '<tr style="border-top:1px solid var(--b1)"><td style="padding:3px 8px;color:var(--t3)">' + r[0] + '</td>'
       + '<td style="padding:3px 8px;text-align:right">' + r[1] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div style="border:1px solid var(--b1);border-radius:5px;background:var(--bg1)">'
     + '<div style="padding:5px 8px;border-bottom:1px solid var(--b1);font-size:10px;font-weight:700">Partisipasi sesi terakhir</div><table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  const rows2 = [
    ['Naik', String(F.advancers), 'var(--up)'],
    ['Turun', String(F.decliners), 'var(--dn)'],
    ['ARA', String(F.ara), 'var(--up)'],
    ['ARB', String(F.arb), 'var(--dn)'],
    ['Emiten ditransaksikan', String(F.members), 'var(--t2)'],
    ['Di atas MA20', B.pct_above_ma20 + '%', 'var(--t2)'],
    ['Di atas MA200', B.pct_above_ma200 + '%', 'var(--t2)'],
  ];
  rows2.forEach((r) => {
    h += '<tr style="border-top:1px solid var(--b1)"><td style="padding:3px 8px;color:var(--t3)">' + r[0] + '</td>'
       + '<td style="padding:3px 8px;text-align:right;color:' + r[2] + '">' + r[1] + '</td></tr>';
  });
  h += '</table></div></div>';

  // ── Catatan metode ──
  h += '<div style="font-size:9px;color:var(--t3);margin-top:8px;line-height:1.5;padding-bottom:16px">'
     + 'Level IHSG dari rail indeks resmi (index_chart, ' + L.sessions + ' sesi). MA dihitung dari level indeks, bukan rata-rata return saham. '
     + 'Breadth memakai harga terkoreksi aksi korporasi (ca_adj) dan hanya menghitung emiten yang bertransaksi pada sesi itu. '
     + 'New high/low = harga menyamai/melewati titik tertinggi/terendah 250 sesi, dan hanya untuk nama yang rentangnya bergerak >5%. '
     + 'Foreign net = (beli − jual) asing × close per saham — arus per saham, bukan arus dana bersih lintas broker. '
     + 'Nilai transaksi memakai angka resmi bursa; penjumlahan per saham hanya 86–96% dari angka ini karena tidak semua transaksi punya baris per emiten.'
     + '</div>';
  h += '</div>';

  el.innerHTML = h;
  ihgDraw(d);
}

function ihgDraw(d) {
  if (typeof LightweightCharts === 'undefined') return;
  const th = ihgTheme();
  const base = {
    layout: { background: { color: 'transparent' }, textColor: th.text, fontSize: 10 },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.grid, scaleMargins: { top: 0.12, bottom: 0.12 } },
    timeScale: { borderColor: th.grid, timeVisible: false, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
  const mk = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const c = LightweightCharts.createChart(el, Object.assign({}, base, { width: el.clientWidth, height: el.clientHeight }));
    ihgCharts.push(c);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (c.__disposed) return;
        try { c.applyOptions({ width: el.clientWidth, height: el.clientHeight }); } catch (e) {}
      });
      ro.observe(el); c.__ro = ro;
    }
    return c;
  };

  // ── Harga: line + candle bertumpuk? Tidak — satu seri, mode ditentukan ketersediaan OHLC.
  const cp = mk('ihg-price');
  if (cp) {
    const lineData = d.series.map((x) => ({ time: x.date, value: x.close }));
    const line = cp.addSeries(LightweightCharts.LineSeries, {
      color: th.line, lineWidth: 1.6,
      priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    line.setData(lineData);
    // OHLC rail hanya 40 sesi; candle ditaruh di atas garis untuk rentang itu saja.
    // Menggambar candle dengan high=low=close untuk sesi lama akan tampil seperti garis
    // gepeng dan terbaca sebagai data rusak, jadi bagian itu sengaja dibiarkan sebagai garis.
    const candles = d.series.filter((x) => x.high != null && x.low != null && x.open != null)
      .map((x) => ({ time: x.date, open: x.open, high: x.high, low: x.low, close: x.close }));
    if (candles.length > 1) {
      const cs = cp.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: th.up, downColor: th.dn, borderUpColor: th.up, borderDownColor: th.dn,
        wickUpColor: th.up, wickDownColor: th.dn, priceLineVisible: false, lastValueVisible: false,
      });
      cs.setData(candles);
    }
    // MA20/MA50 dari level: menggambar garis MA membuat "harga di atas/bawah MA" terbaca
    // visual, bukan hanya angka di kartu.
    const maSeries = (key, color, label) => {
      const pts = [];
      const vals = d.series.map((x) => x.close);
      for (let i = 0; i < d.series.length; i++) {
        if (i + 1 < key) continue;
        let s = 0;
        for (let k = i - key + 1; k <= i; k++) s += vals[k];
        pts.push({ time: d.series[i].date, value: s / key });
      }
      if (!pts.length) return;
      const s2 = cp.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: label });
      s2.setData(pts);
    };
    maSeries(20, th.ma20, 'MA20');
    maSeries(50, th.ma50, 'MA50');
    cp.timeScale().fitContent();
  }

  // ── Breadth: % di atas MA20, garis + level 50% sebagai acuan ──
  const cb = mk('ihg-breadth');
  if (cb && d.breadth && d.breadth.series.length) {
    const s = cb.addSeries(LightweightCharts.AreaSeries, {
      lineColor: th.line, topColor: th.fillTop, bottomColor: th.fillBot, lineWidth: 1.4,
      priceLineVisible: false, priceFormat: { type: 'custom', formatter: (v) => v.toFixed(0) + '%' },
    });
    s.setData(d.breadth.series.map((x) => ({ time: x.date, value: x.pct_above_ma20 })));
    s.createPriceLine({ price: 50, color: th.grid, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '50%' });
    cb.timeScale().fitContent();
  }

  // ── Arus: bar per sesi, hijau/merah ──
  const cf = mk('ihg-flow');
  if (cf && d.flow && d.flow.series.length) {
    const s = cf.addSeries(LightweightCharts.HistogramSeries, {
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v) => (v / 1e12).toFixed(1) + ' T' },
    });
    s.setData(d.flow.series.map((x) => ({
      time: x.date, value: x.net,
      color: x.net >= 0 ? th.up : th.dn,
    })));
    cf.timeScale().fitContent();
  }
}

function ihgTheme() {
  const dark = document.body.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
  return dark
    ? { text: '#9aa4b2', grid: '#232a35', line: '#4f9dff', ma20: '#e0a33e', ma50: '#a06ee0', up: '#2ecc71', dn: '#e74c3c', fillTop: 'rgba(79,157,255,.28)', fillBot: 'rgba(79,157,255,.02)' }
    : { text: '#5b6472', grid: '#e6e9ee', line: '#1f6fd0', ma20: '#b8791a', ma50: '#7b4fc0', up: '#1a9e57', dn: '#c0392b', fillTop: 'rgba(31,111,208,.22)', fillBot: 'rgba(31,111,208,.02)' };
}
