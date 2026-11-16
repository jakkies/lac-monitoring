/**
 * LAC Monitoring – write API for the /input admin page.
 * Paste into the sheet's Extensions → Apps Script editor, run `setup` once, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * @OnlyCurrentDoc
 */
const TABS = { settings: 'Settings', cy: 'Counts CY', py: 'Counts PY', forecast: 'Forecast', calc: 'Calculations' };
const RISK = ['Low', 'Medium', 'High', '-'];
const BRAND = { forest: '#085C34', mint: '#ECF4EC', white: '#FFFFFF' };

/* ------------------------------------------------------------------ HTTP */
function doGet() {
  return json_({ ok: true, service: 'LAC input API', hasKey: !!props_().getProperty('ADMIN_KEY') });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  const p = props_(), stored = p.getProperty('ADMIN_KEY');

  if (req.action === 'status') return json_({ ok: true, hasKey: !!stored });
  if (req.action === 'setKey') {
    if (stored) return json_({ ok: false, error: 'A passcode has already been set.' });
    if (!req.newKey || String(req.newKey).length < 8) return json_({ ok: false, error: 'Use at least 8 characters.' });
    p.setProperty('ADMIN_KEY', hash_(req.newKey));
    return json_({ ok: true });
  }
  if (!stored || hash_(req.key || '') !== stored) { Utilities.sleep(700); return json_({ ok: false, auth: false, error: 'Wrong passcode.' }); }

  switch (req.action) {
    case 'verify': return json_({ ok: true });
    case 'changeKey':
      if (!req.newKey || String(req.newKey).length < 8) return json_({ ok: false, error: 'Use at least 8 characters.' });
      p.setProperty('ADMIN_KEY', hash_(req.newKey));
      return json_({ ok: true });
    case 'saveWeek': {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return json_(saveWeek_(req)); }
      catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
      finally { lock.releaseLock(); }
    }
  }
  return json_({ ok: false, error: 'Unknown action.' });
}

/* ------------------------------------------------------------------ save */
/**
 * req = { season: 'CY'|'PY', week: 47, setCurrent: true,
 *         counts: [{ trap: 2, pest: 'PTM', value: 264 | null }, ...],
 *         forecast: [{ date: '2026-11-24', early: 'Medium', late: '-', min: 14, max: 27 }, ...] }
 */
function saveWeek_(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const week = Number(req.week);
  if (!(week >= 1 && week <= 53 && Math.floor(week) === week)) throw new Error('Week must be a whole number from 1 to 53.');
  const sh = ss.getSheetByName(req.season === 'PY' ? TABS.py : TABS.cy);
  if (!sh) throw new Error('Counts sheet not found.');

  // 1. Trap counts → the "Week N" column
  const col = ensureWeekColumn_(sh, week);
  const last = sh.getLastRow();
  const keys = sh.getRange(2, 1, last - 1, 2).getValues();           // Trap No, Pest
  const column = sh.getRange(2, col, last - 1, 1).getValues();
  let written = 0;
  (req.counts || []).forEach(c => {
    const i = keys.findIndex(k => Number(k[0]) === Number(c.trap) && String(k[1]).trim() === c.pest);
    if (i < 0) return;
    const v = c.value;
    if (v !== null && v !== '' && v !== '*' && !(typeof v === 'number' && v >= 0 && v <= 100000)) throw new Error(`Trap ${c.trap}: count must be a number from 0 to 100 000.`);
    column[i][0] = v === null || v === '' ? '' : v === '*' ? '*' : Math.round(v);
    written++;
  });
  sh.getRange(2, col, last - 1, 1).setValues(column);

  // 2. Blight risk & temperature outlook for this week (current season only)
  if (req.season !== 'PY' && Array.isArray(req.forecast)) saveForecast_(ss, week, req.forecast);

  // 3. Optionally make this the report's current week
  if (req.setCurrent && req.season !== 'PY') setSetting_(ss, 'Current Week', week);

  buildCalculations_(ss);
  SpreadsheetApp.flush();
  return { ok: true, week, season: req.season || 'CY', traps: written, savedAt: new Date().toISOString() };
}

function ensureWeekColumn_(sh, week) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  let idx = head.indexOf('Week ' + week);
  if (idx >= 0) return idx + 1;
  const col = sh.getLastColumn() + 1;
  sh.getRange(1, col).setValue('Week ' + week);
  sh.getRange(1, col - 1).copyFormatToRange(sh, col, col, 1, 1);
  return col;
}

function saveForecast_(ss, week, rows) {
  const sh = ensureForecastWeekColumn_(ss);
  const clean = rows.map((r, i) => {
    const d = parseDate_(r.date) ? String(r.date) : null;
    if (!d) throw new Error(`Outlook day ${i + 1}: date is missing.`);
    const early = RISK.includes(r.early) ? r.early : '-', late = RISK.includes(r.late) ? r.late : '-';
    const min = num_(r.min), max = num_(r.max);
    if (min !== '' && max !== '' && min > max) throw new Error(`Outlook ${r.date}: min is higher than max.`);
    return [week, d, early, late, min, max];
  }).sort((a, b) => (a[1] < b[1] ? -1 : 1));

  // remove this week's existing rows (bottom-up), then append the new ones
  const last = sh.getLastRow();
  if (last > 1) {
    const weeks = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = weeks.length - 1; i >= 0; i--) if (Number(weeks[i][0]) === week) sh.deleteRow(i + 2);
  }
  if (clean.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, clean.length, 6).setValues(clean);
    sh.getRange(start, 1, clean.length, 1).setNumberFormat('0');
    sh.getRange(start, 2, clean.length, 1).setNumberFormat('yyyy-mm-dd');
  }
  // keep the tab sorted by week, then date
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 6).sort([{ column: 1, ascending: true }, { column: 2, ascending: true }]);
}

function ensureForecastWeekColumn_(ss) {
  const sh = ss.getSheetByName(TABS.forecast);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (head[0] === 'Week') return sh;
  sh.insertColumnBefore(1);
  sh.getRange(1, 2).copyFormatToRange(sh, 1, 1, 1, 1);
  sh.getRange(1, 1).setValue('Week');
  const cur = getSetting_(ss, 'Current Week');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).setValue(cur);
  return sh;
}

/* ------------------------------------------------------- calculations tab */
/** Rebuilds the "Calculations" tab: the workbook's Data-sheet formulas, one column per week. */
function buildCalculations_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TABS.calc);
  if (!sh) sh = ss.insertSheet(TABS.calc, ss.getSheets().length - 1);
  sh.clear();

  const cy = ss.getSheetByName(TABS.cy), py = ss.getSheetByName(TABS.py);
  const cyHead = cy.getRange(1, 1, 1, cy.getLastColumn()).getValues()[0].map(String);
  const weeks = cyHead.map((h, i) => ({ h, i })).filter(x => /^Week \d+$/.test(x.h));
  const thr = name => { const c = settingCol_(ss, name); return c ? `Settings!$${colA1_(c)}$2` : '600'; };
  const q = n => `'${n}'`;

  const rows = [];   // [label, (colLetterOfCalc, weekColLetterInCounts, isFirst) => formula, format]
  const block = (sheetName, head, pest, tag) => {
    const S = q(sheetName);
    const colOf = h => { const i = head.indexOf(h); return i < 0 ? null : colA1_(i + 1); };
    const base = rows.length + 2;  // sheet row of the first metric in this block
    const r = { total: base, n: base + 1, avg: base + 2, mov: base + 3, diff: base + 4, dir: base + 5, diffp: base + 6, over: base + 7 };
    const L = (h) => colOf(h);
    rows.push([`${pest} Total (${tag})`, (c, h) => L(h) ? `=IF(COUNTIFS(${S}!$B$2:$B,"${pest}",${S}!${L(h)}$2:${L(h)},">=0")=0,"",SUMIFS(${S}!${L(h)}$2:${L(h)},${S}!$B$2:$B,"${pest}"))` : '', '#,##0']);
    rows.push([`${pest} Traps read (${tag})`, (c, h) => L(h) ? `=COUNTIFS(${S}!$B$2:$B,"${pest}",${S}!${L(h)}$2:${L(h)},">=0")` : '', '0']);
    rows.push([`${pest} Weekly Avg. Count (${tag})`, (c, h) => L(h) ? `=IFERROR(ROUND(AVERAGEIFS(${S}!${L(h)}$2:${L(h)},${S}!$B$2:$B,"${pest}"),0),"")` : '', '#,##0']);
    rows.push([`${pest} Weekly % Movement (${tag})`, (c, h, p) => p ? `=IFERROR((${c}${r.avg}-${p}${r.avg})/${p}${r.avg},"")` : '', '0.00%']);
    rows.push([`${pest} Total Diff. vs prev. week (${tag})`, (c, h, p) => p ? `=IF(OR(${c}${r.total}="",${p}${r.total}=""),"",${c}${r.total}-${p}${r.total})` : '', '#,##0']);
    rows.push([`${pest} Movement (${tag})`, (c, h, p) => p ? `=IF(${c}${r.diff}="","",IF(${c}${r.diff}>0,"Up","Down"))` : '', '@']);
    rows.push([`${pest} Diff. % (${tag})`, (c, h, p) => p ? `=IFERROR(${c}${r.diff}/${p}${r.total},"")` : '', '0.00%']);
    rows.push([`${pest} Traps ≥ threshold (${tag})`, (c, h) => L(h) ? `=COUNTIFS(${S}!$B$2:$B,"${pest}",${S}!${L(h)}$2:${L(h)},">="&${thr(pest + ' Threshold')})` : '', '0']);
    return r;
  };
  const pyHead = py.getRange(1, 1, 1, py.getLastColumn()).getValues()[0].map(String);
  const ptm = block(TABS.cy, cyHead, 'PTM', 'CY');
  const ta = block(TABS.cy, cyHead, 'TA', 'CY');
  rows.push(['PTM share of catch (PTM:TA)', c => `=IFERROR(${c}${ptm.total}/(${c}${ptm.total}+${c}${ta.total}),"")`, '0%']);
  rows.push(['TA share of catch (PTM:TA)', c => `=IFERROR(${c}${ta.total}/(${c}${ptm.total}+${c}${ta.total}),"")`, '0%']);
  block(TABS.py, pyHead, 'PTM', 'PY');
  block(TABS.py, pyHead, 'TA', 'PY');

  // Per-trap share of the weekly total (the workbook's "Perc." columns)
  const traps = cy.getRange(2, 1, cy.getLastRow() - 1, 3).getValues();
  traps.forEach((t, k) => {
    const rr = k + 2;
    rows.push([`Perc. Trap ${t[0]} ${t[1]} – ${t[2]}`, (c, h) => {
      const i = cyHead.indexOf(h); if (i < 0) return '';
      const L = colA1_(i + 1), S = q(TABS.cy);
      return `=IFERROR(IF(${S}!${L}${rr}="","",${S}!${L}${rr}/SUMIFS(${S}!${L}$2:${L},${S}!$B$2:$B,"${t[1]}")),"")`;
    }, '0.0%']);
  });

  const out = [['Metric'].concat(weeks.map(w => w.h))];
  rows.forEach(([label, f]) => {
    out.push([label].concat(weeks.map((w, j) => f(colA1_(j + 2), w.h, j ? colA1_(j + 1) : null))));
  });
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  rows.forEach(([, , fmt], k) => sh.getRange(k + 2, 2, 1, weeks.length).setNumberFormat(fmt));
  sh.getRange(1, 1, 1, out[0].length).setBackground(BRAND.forest).setFontColor(BRAND.white).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, rows.length, 1).setFontWeight('bold');
  sh.setFrozenRows(1); sh.setFrozenColumns(1); sh.setColumnWidth(1, 300);
  sh.getRange('A1').setNote('Rebuilt automatically after every save from the input page. Do not edit – change the Counts tabs instead.');
  return rows.length;
}

/* ------------------------------------------------------------------ setup */
/** Run once from the editor: adds the Week column to Forecast, dropdowns, validation and the Calculations tab. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fc = ensureForecastWeekColumn_(ss);
  fc.getRange('A2:A1000').setNumberFormat('0');
  const riskRule = SpreadsheetApp.newDataValidation().requireValueInList(RISK, true).setAllowInvalid(false).build();
  fc.getRange('C2:D1000').setDataValidation(riskRule);
  fc.getRange('B2:B1000').setNumberFormat('yyyy-mm-dd');
  const numRule = SpreadsheetApp.newDataValidation().requireFormulaSatisfied('=OR(D2="",D2="*",AND(ISNUMBER(D2),D2>=0,D2<=100000))').setAllowInvalid(false)
    .setHelpText('Trap count: a whole number, * if the trap was not read, or leave blank.').build();
  [TABS.cy, TABS.py].forEach(n => {
    const sh = ss.getSheetByName(n);
    sh.getRange(2, 4, sh.getLastRow() - 1, sh.getLastColumn() - 3).setDataValidation(numRule);
    sh.setFrozenRows(1); sh.setFrozenColumns(3);
  });
  fc.setFrozenRows(1);
  ss.getSheetByName(TABS.settings).setFrozenRows(1);
  const n = buildCalculations_(ss);
  Logger.log('Setup complete. Calculations rows: ' + n);
}

/** Editor test: re-saves week 46 exactly as it is and checks nothing changed. */
function testRoundTrip() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), week = Number(getSetting_(ss, 'Current Week'));
  const cy = ss.getSheetByName(TABS.cy), head = cy.getRange(1, 1, 1, cy.getLastColumn()).getValues()[0].map(String);
  const col = head.indexOf('Week ' + week) + 1, data = cy.getRange(2, 1, cy.getLastRow() - 1, col).getValues();
  const before = data.map(r => r[col - 1]).join(',');
  const counts = data.map(r => ({ trap: r[0], pest: r[1], value: typeof r[col - 1] === 'number' || r[col - 1] === '*' ? r[col - 1] : null }));
  const fc = ss.getSheetByName(TABS.forecast).getDataRange().getValues().slice(1).filter(r => Number(r[0]) === week)
    .map(r => ({ date: Utilities.formatDate(new Date(r[1]), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'), early: r[2], late: r[3], min: r[4], max: r[5] }));
  const res = saveWeek_({ season: 'CY', week, counts, forecast: fc, setCurrent: false });
  const after = cy.getRange(2, col, cy.getLastRow() - 1, 1).getValues().map(r => r[0]).join(',');
  Logger.log(JSON.stringify(res) + (before === after ? '  ✔ counts unchanged' : '  ✘ counts differ: ' + before + ' → ' + after));
}

/* --------------------------------------------------------------- helpers */
function props_() { return PropertiesService.getScriptProperties(); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hash_(s) {
  const p = props_(); let salt = p.getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); p.setProperty('SALT', salt); }
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + s, Utilities.Charset.UTF_8));
}
function num_(v) { if (v === null || v === undefined || v === '') return ''; const n = Number(v); if (!isFinite(n)) throw new Error('Temperature must be a number.'); return n; }
function parseDate_(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function colA1_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function settingCol_(ss, name) { const h = ss.getSheetByName(TABS.settings).getRange(1, 1, 1, 30).getValues()[0].map(String); const i = h.indexOf(name); return i < 0 ? 0 : i + 1; }
function getSetting_(ss, name) { const c = settingCol_(ss, name); return c ? ss.getSheetByName(TABS.settings).getRange(2, c).getValue() : null; }
function setSetting_(ss, name, v) { const c = settingCol_(ss, name); if (c) ss.getSheetByName(TABS.settings).getRange(2, c).setValue(v); }
