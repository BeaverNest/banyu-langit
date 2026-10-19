'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Normalisasi tanggal teks → ISO 'YYYY-MM-DD'.
//
// Kenapa ada: beberapa kolom menyimpan tanggal sebagai teks DD-MMM-YYYY
// (KSEI "master_securities" Listing Date → issued_history.issue_date; XLS BEI).
// Urutan leksikografis teks itu mengurutkan HARI dulu, baru BULAN, baru TAHUN,
// jadi MIN()/MAX()/BETWEEN/ORDER BY di atasnya salah TANPA error apa pun.
// Terukur pada kolom campuran (kanban t_b00757f3): MIN(issue_date) =
// '01-APR-2024' sementara MAX(issue_date) = '31-OCT-2023' — min > max.
//
// Aturan: fungsi ini HANYA mengembalikan tanggal yang bisa divalidasi sebagai
// kalender nyata; bentuk tak dikenal → '' (pemanggil memutuskan fallback-nya,
// tidak pernah menebak).
// ═══════════════════════════════════════════════════════════════════════════

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DD_MON_Y_RE = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/;
const D_SLASH_M_Y_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Singkatan bulan Inggris + Indonesia (BEI/KSEI memakai keduanya).
const MONTHS = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  PEB: '02', MET: '03', MEI: '05', AGT: '08', AGU: '08', OKT: '10', NOP: '11', DES: '12', SEPT: '09',
  JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04', JUNE: '06', JULY: '07',
  AUGUST: '08', SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12',
};

function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * @param {*} v nilai apa pun (string/number/Date)
 * @returns {string} 'YYYY-MM-DD' bila bisa divalidasi, '' bila tidak.
 */
function toIsoDate(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel/Sheets serial date (1899-12-30 epoch). Hanya rentang yang masuk akal.
    if (v > 20000 && v < 90000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
    return '';
  }
  let s = String(v).trim();
  if (!s) return '';
  // Buang komponen waktu HANYA pada bentuk tanggal ISO ("2026-09-30T00:00:00Z").
  // JANGAN pakai s.includes('T') global: nama bulan 'OCT'/'SEPT' mengandung huruf T,
  // jadi pemotongan buta mengubah '01-OCT-1993' menjadi '01-OC' dan 67 baris
  // issued_history gagal dinormalisasi (bug nyata pada percobaan pertama, t_b00757f3).
  const isoHead = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoHead) s = isoHead[1];
  if (isIsoDate(s)) return s;

  let m = s.match(DD_MON_Y_RE);
  if (m) {
    const mm = MONTHS[m[2].toUpperCase()];
    if (mm) {
      const iso = `${m[3]}-${mm}-${pad2(m[1])}`;
      if (isIsoDate(iso)) return iso;
    }
    return '';
  }
  // DD/MM/YYYY (hari dulu — konsisten dengan parseBeiDate/parseTradeDate di repo ini).
  m = s.match(D_SLASH_M_Y_RE);
  if (m) {
    const iso = `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    if (isIsoDate(iso)) return iso;
  }
  return '';
}

module.exports = { toIsoDate, isIsoDate, ISO_RE, MONTHS };
