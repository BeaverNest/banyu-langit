// ═══ INIT — Bloomberg Terminal ═══
// Lazy load: only load diary + market on startup. Other tabs load on first click.
lEnt();
lNews('');
loadN();
// Market tab mendarat di sub-tab Commodities (Overview dihapus 21 Okt 2026).
if(typeof loadCommodities==='function')loadCommodities();
tabLoaded.mkt=true;
tabLoaded.diary=true;
setInterval(chkAl,60000);
setTimeout(chkAl,5000);
