const { db } = require('../db');

function normInv(name) {
  if (!name) return '';
  return name.toUpperCase().trim()
    .replace(/\b(PT\.?|TBK\.?|LTD\.?|LIMITED|INC\.?|CORP\.?|CO\.?|PTE\.?)\b/g, '')
    .replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim();
}

function parseDate(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'number') return new Date(new Date(1899, 11, 30).getTime() + d * 864e5).toISOString().split('T')[0];
  if (typeof d === 'string' && d.includes('T')) return d.split('T')[0];
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return String(d);
}

function parseTradeDate(d) {
  if (!d) return '';
  const months = {
    Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
    Jan:'01',Peb:'02',Met:'03',Apr:'04',Mei:'05',Jun:'06',Jul:'07',Agt:'08',Agu:'08',Sep:'09',Okt:'10',Nop:'11',Nov:'11',Des:'12'
  };
  const parts = String(d).trim().split(/\s+/);
  if (parts.length === 3 && months[parts[1]]) return parts[2] + '-' + months[parts[1]] + '-' + parts[0].padStart(2, '0');
  return String(d);
}

function detectHeaders(row) {
  const maps = db.prepare('SELECT source_header,target_field FROM header_mappings').all();
  const lookup = {};
  maps.forEach(m => { lookup[m.source_header.toUpperCase()] = m.target_field; });
  const result = {};
  for (const key of Object.keys(row)) {
    const u = key.toUpperCase().trim();
    if (lookup[u]) { result[key] = lookup[u]; continue; }
    for (const [src, tgt] of Object.entries(lookup)) {
      if (u.includes(src) || src.includes(u)) { result[key] = tgt; break; }
    }
  }
  return result;
}

function resolveInvestorGroup(name) {
  const norm = normInv(name);
  const ov = db.prepare("SELECT group_name FROM investor_overrides WHERE UPPER(investor_name)=?").get(norm);
  if (ov) return ov.group_name;
  const rules = db.prepare("SELECT keyword,match_type,group_name FROM investor_rules ORDER BY length(keyword) DESC").all();
  for (const r of rules) {
    const kw = r.keyword.toUpperCase();
    if (r.match_type === 'exact' && norm === kw) return r.group_name;
    if (r.match_type === 'startswith' && norm.startsWith(kw)) return r.group_name;
    if (norm.includes(kw)) return r.group_name;
  }
  return null;
}

function resolveTickerGroup(ticker) {
  return db.prepare("SELECT group_name,category FROM ticker_groups WHERE ticker=?").all(ticker.toUpperCase());
}

module.exports = { normInv, parseDate, parseTradeDate, detectHeaders, resolveInvestorGroup, resolveTickerGroup };