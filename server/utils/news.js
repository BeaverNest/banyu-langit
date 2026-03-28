const xml2js = require('xml2js');

function decodeHtml(s) {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

async function gNews(query) {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const p = await xml2js.parseStringPromise(await r.text(), { explicitArray: false });
    const items = p?.rss?.channel?.item;
    if (!items) return [];
    return (Array.isArray(items) ? items : [items]).slice(0, 30).map(i => ({
      headline: decodeHtml(i.title || ''),
      source: typeof (i.source?._ || i.source) === 'string' ? (i.source?._ || i.source) : '',
      url: i.link || '',
      datetime: i.pubDate ? Math.floor(new Date(i.pubDate).getTime() / 1000) : 0
    }));
  } catch { return []; }
}

module.exports = { gNews };
