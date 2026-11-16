/* LAC shared data layer – used by the report (app.js) and the admin input page (input/admin.js).
 * Reads the Google Sheet through the public gviz CSV endpoint and mirrors the workbook's calculations. */
(() => {
  "use strict";
  const CFG = window.LAC_CONFIG || {};
  const TABS = Object.assign({ settings: "Settings", cy: "Counts CY", py: "Counts PY", forecast: "Forecast" }, CFG.TABS || {});
  const qs = new URLSearchParams(location.search);
  const SHEET_ID = (qs.get("sheet") || CFG.SHEET_ID || (qs.get("csv") ? "local-test" : "")).trim();

  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.filter(r => r.some(v => v.trim() !== "")).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }
  const norm = v => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    if (s === "") return null;
    const n = Number(s.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, "."));
    return Number.isFinite(n) ? n : s;
  };
  async function fetchTab(tab) {
    const base = qs.get("csv");
    const url = base ? `${base}/${encodeURIComponent(tab)}.csv`
      : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${tab}: HTTP ${r.status}`);
    const t = await r.text();
    if (/^\s*</.test(t)) throw new Error(`${tab}: sheet is not shared publicly`);
    return parseCSV(t);
  }
  const shapeRows = rows => rows.map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = k === "Client" || k === "Pest" ? String(v).trim() : norm(v);
    return o;
  }).filter(r => r["Trap No"] != null && r.Pest);
  const shapeForecast = rows => rows.map(r => ({
    Week: norm(r.Week), Date: String(r.Date || "").trim(),
    "Blight Early": String(r["Blight Early"] ?? "").trim(), "Blight Late": String(r["Blight Late"] ?? "").trim(),
    "Temp Min": norm(r["Temp Min"]), "Temp Max": norm(r["Temp Max"])
  })).filter(r => r.Date);

  async function loadLive() {
    const [s, cy, py, fc] = await Promise.all([TABS.settings, TABS.cy, TABS.py, TABS.forecast].map(fetchTab));
    const settings = {};
    if (s.length && "Setting" in s[0]) s.forEach(r => settings[r.Setting.trim()] = norm(r.Value));
    else Object.entries(s[0] || {}).forEach(([k, v]) => settings[k.trim()] = norm(v));
    return { settings, cy: shapeRows(cy), py: shapeRows(py), forecast: shapeForecast(fc) };
  }

  /* ---- calculations: same definitions as the workbook ---- */
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const val = (row, w) => row ? row[`Week ${w}`] ?? null : null;
  // Total = SUM(column); Weekly avg = ROUND(AVERAGE(column), 0) – blanks are ignored, like Excel.
  function weekStats(rows, pest, w) {
    const nums = rows.filter(r => r.Pest === pest).map(r => val(r, w)).filter(isNum);
    if (!nums.length) return { total: null, avg: null, n: 0, max: null };
    const total = nums.reduce((a, b) => a + b, 0);
    return { total, avg: Math.round(total / nums.length), n: nums.length, max: Math.max(...nums) };
  }
  // % Movement = (this − previous) / previous
  const change = (a, b) => (isNum(a) && isNum(b) && a !== 0) ? (b - a) / a : null;
  const weeksWithData = rows => {
    const s = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => { const m = /^Week (\d+)$/.exec(k); if (m && isNum(r[k])) s.add(+m[1]); }));
    return [...s].sort((a, b) => a - b);
  };

  window.LACData = { CFG, TABS, SHEET_ID, qs, parseCSV, norm, fetchTab, loadLive, isNum, val, weekStats, change, weeksWithData };
})();
