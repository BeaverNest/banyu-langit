// ═══ INIT — Bloomberg Terminal ═══
// Lazy load: only load diary + market on startup. Other tabs load on first click.
lEnt();
lNews('');
loadN();
loadMktOverview();
tabLoaded.mkt=true;
tabLoaded.diary=true;
setInterval(chkAl,60000);
setTimeout(chkAl,5000);
