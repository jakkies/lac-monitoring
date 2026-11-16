/* LAC admin input page – add a new week or edit an existing one, then save to the Google Sheet via Apps Script. */
(() => {
  "use strict";
  const D = window.LACData, { CFG, qs, isNum, val, weekStats, change } = D;
  const WRITE_URL = (qs.get("api") || CFG.WRITE_URL || "").trim();
  const KEY_STORE = "lac-admin-key";
  const PESTS = [["PTM", "Potato tuber moth", "var(--ptm)"], ["TA", "Tuta absoluta", "var(--ta)"]];
  const RISK = [["", "Select…"], ["Low", "Low"], ["Medium", "Medium"], ["High", "High"], ["-", "– None"]];
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = n => n == null || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en-ZA");
  const pct = n => n == null ? "–" : (n > 0 ? "+" : "") + (n * 100).toFixed(2).replace(".", ",") + "%";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let DATA = null, KEY = null, season = "CY", week = null, isNew = false, initial = "", saving = false;
  const store = { get: () => { try { return sessionStorage.getItem(KEY_STORE); } catch (e) { return null; } },
    set: v => { try { v ? sessionStorage.setItem(KEY_STORE, v) : sessionStorage.removeItem(KEY_STORE); } catch (e) {} } };

  /* ---------------- API ---------------- */
  async function api(action, body = {}) {
    const r = await fetch(WRITE_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, key: KEY, ...body }) });
    if (!r.ok) throw new Error("The save service returned HTTP " + r.status);
    return r.json();
  }

  /* ---------------- dates ---------------- */
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function isoMonday(year, w) { const jan4 = new Date(year, 0, 4); const mon = addDays(jan4, -((jan4.getDay() + 6) % 7)); return addDays(mon, (w - 1) * 7); }
  // Workbook rule: the outlook starts the day after the report is compiled (Monday after the calendar week) → Tuesday.
  const defaultStart = w => addDays(isoMonday(Number(DATA.settings["Season (CY)"]) || new Date().getFullYear(), w + 1), 1);

  /* ---------------- helpers ---------------- */
  const rows = () => DATA[season === "PY" ? "py" : "cy"];
  const threshold = p => Number(DATA.settings[`${p} Threshold`]) || 600;
  const weeksFor = () => {
    const s = new Set(D.weeksWithData(rows()));
    if (season === "CY") DATA.forecast.forEach(f => isNum(f.Week) && s.add(f.Week));
    return [...s].sort((a, b) => a - b);
  };
  const seasonLabel = s => String(DATA.settings[s === "PY" ? "Season (PY)" : "Season (CY)"] || s);

  /* ---------------- form state ---------------- */
  function readForm() {
    const counts = [...document.querySelectorAll(".trap input")].map(i => ({ trap: +i.dataset.trap, pest: i.dataset.pest, value: i.value.trim() === "" ? null : Number(i.value) }));
    const forecast = season === "CY" ? [...document.querySelectorAll(".fcin__row")].map(r => ({
      date: $(".fc-date input", r).value, early: $(".fc-early", r).value, late: $(".fc-late", r).value,
      min: $(".fc-min", r).value === "" ? null : Number($(".fc-min", r).value), max: $(".fc-max", r).value === "" ? null : Number($(".fc-max", r).value)
    })) : null;
    return { counts, forecast };
  }
  const snapshot = () => JSON.stringify(readForm());
  const dirty = () => snapshot() !== initial;

  /* ---------------- render ---------------- */
  function renderWeekPicker() {
    const ws = weeksFor(), cur = Number(DATA.settings["Current Week"]);
    $("#segCY").textContent = seasonLabel("CY"); $("#segPY").textContent = seasonLabel("PY");
    $("#weekSel").innerHTML = `<option value="new">＋ Add new week</option>` + ws.slice().reverse().map(w =>
      `<option value="${w}">Week ${w}${season === "CY" && w === cur ? " · current" : ""}</option>`).join("");
    if (!isNew && (week == null || !ws.includes(week))) { week = ws[ws.length - 1] ?? null; isNew = week == null; }
    $("#weekSel").value = isNew ? "new" : String(week);
    $("#newWeekWrap").hidden = !isNew;
    if (isNew) { if (week == null) week = Math.min(53, (ws[ws.length - 1] || 0) + 1); $("#newWeek").value = week; }
  }

  function renderTraps() {
    $("#trapsWeek").textContent = `· week ${week} · ${seasonLabel(season)}`;
    $("#trapGroups").innerHTML = PESTS.map(([p, long, color]) => {
      const list = rows().filter(r => r.Pest === p).sort((a, b) => a["Trap No"] - b["Trap No"]);
      return `<div class="card tgroup" data-pest="${p}">
        <div class="tgroup__head"><h3 class="card__title"><span class="swatch" style="background:${color}"></span>${p} <span class="muted small">${long}</span></h3><span class="tgroup__sum" data-sum="${p}"></span></div>
        <div class="traps">${list.map(r => {
          const v = isNew ? null : val(r, week), prev = val(r, week - 1), id = `t-${p}-${r["Trap No"]}`;
          return `<div class="trap" style="--pc:${color}">
            <span class="trap__no" aria-hidden="true">${r["Trap No"]}</span>
            <label class="trap__meta" for="${id}"><span class="trap__client">${esc(r.Client)}</span>
              <span class="trap__aux"><span>Trap ${r["Trap No"]}</span><span title="Week ${week - 1}">wk ${week - 1}: ${isNum(prev) ? fmt(prev) : "–"}</span><span data-share></span></span></label>
            <input id="${id}" type="number" inputmode="numeric" min="0" max="100000" step="1" placeholder="–" data-trap="${r["Trap No"]}" data-pest="${p}" data-orig="${isNum(v) ? v : ""}" value="${isNum(v) ? v : ""}" aria-label="Trap ${r["Trap No"]} ${p} count, ${esc(r.Client)}">
          </div>`;
        }).join("")}</div></div>`;
    }).join("");
  }

  function renderForecast() {
    $("#fcSection").hidden = season !== "CY";
    $("#setCurrent").closest(".check").hidden = season !== "CY";
    if (season !== "CY") { $("#fcRows").innerHTML = ""; return; }
    const have = isNew ? [] : DATA.forecast.filter(f => f.Week === week).sort((a, b) => a.Date < b.Date ? -1 : 1);
    const start = parseISO(have[0]?.Date) || defaultStart(week);
    const opt = sel => RISK.map(([v, t]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${t}</option>`).join("");
    $("#fcRows").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const f = have[i] || {}, d = addDays(start, i);
      const risk = v => (v === "-" || v === "–") ? "-" : (["Low", "Medium", "High"].find(x => x.toLowerCase() === String(v || "").toLowerCase()) || "");
      return `<div class="fcin__row" role="row">
        <label class="fc-date"><span class="fcin__day" data-dow>${d.toLocaleDateString("en-ZA", { weekday: "long" })}</span>
          <input type="date" value="${iso(d)}" ${i ? "readonly tabindex='-1'" : ""} aria-label="Day ${i + 1} date"></label>
        <label>Early blight<select class="fc-early">${opt(risk(f["Blight Early"]))}</select></label>
        <label>Late blight<select class="fc-late">${opt(risk(f["Blight Late"]))}</select></label>
        <label>Min °C<input class="fc-min" type="number" inputmode="numeric" step="1" min="-20" max="55" value="${isNum(f["Temp Min"]) ? f["Temp Min"] : ""}"></label>
        <label>Max °C<input class="fc-max" type="number" inputmode="numeric" step="1" min="-20" max="55" value="${isNum(f["Temp Max"]) ? f["Temp Max"] : ""}"></label>
      </div>`;
    }).join("");
    tintRisk();
  }
  const tintRisk = () => document.querySelectorAll(".fc-early,.fc-late").forEach(s => { s.className = s.className.replace(/\blvl-\w+/g, "").trim() + (s.value && s.value !== "-" ? " lvl-" + s.value.toLowerCase() : ""); });

  function renderSummary() {
    const form = readForm(), all = rows();
    const stats = {}, prevStats = {};
    PESTS.forEach(([p]) => {
      const nums = form.counts.filter(c => c.pest === p && isNum(c.value)).map(c => c.value);
      const total = nums.reduce((a, b) => a + b, 0);
      stats[p] = { total: nums.length ? total : null, n: nums.length, avg: nums.length ? Math.round(total / nums.length) : null, max: nums.length ? Math.max(...nums) : null, over: nums.filter(v => v >= threshold(p)).length };
      prevStats[p] = weekStats(all, p, week - 1);
      // per-trap share ("Perc." columns)
      document.querySelectorAll(`.trap input[data-pest="${p}"]`).forEach(i => {
        const v = i.value === "" ? null : Number(i.value), sh = i.closest(".trap").querySelector("[data-share]");
        sh.innerHTML = isNum(v) && total ? (v >= threshold(p) ? `<span class="over">≥ threshold</span>` : `${(v / total * 100).toFixed(1).replace(".", ",")}%`) : "";
        i.closest(".trap").classList.toggle("is-changed", i.value !== i.dataset.orig);
        i.setAttribute("aria-invalid", i.value !== "" && !(Number(i.value) >= 0 && Number.isInteger(Number(i.value))) ? "true" : "false");
      });
      $(`[data-sum="${p}"]`).textContent = `${stats[p].n}/${document.querySelectorAll(`.trap input[data-pest="${p}"]`).length} traps · total ${fmt(stats[p].total)}`;
    });
    const t = (stats.PTM.total || 0) + (stats.TA.total || 0), sp = t ? stats.PTM.total / t : 0;
    const block = (p, color) => {
      const s = stats[p], pr = prevStats[p], dAvg = change(pr.avg, s.avg), diff = isNum(s.total) && isNum(pr.total) ? s.total - pr.total : null;
      return `<div class="sum__pest"><h3><span class="swatch" style="background:${color}"></span>${p}</h3><div class="sum__grid">
        <div><span>Weekly avg.</span><b>${fmt(s.avg)}</b></div>
        <div><span>% movement</span><b>${pct(dAvg)}</b></div>
        <div><span>Total wk ${week - 1} → ${week}</span><b>${fmt(pr.total)} → ${fmt(s.total)}</b></div>
        <div><span>Movement</span><b>${diff == null ? "–" : (diff > 0 ? "▲ Up " : "▼ Down ") + pct(change(pr.total, s.total))}</b></div>
        <div><span>Highest trap</span><b>${fmt(s.max)}</b></div>
        <div><span>≥ ${fmt(threshold(p))}</span><b>${s.over}</b></div>
      </div></div>`;
    };
    $("#summary").innerHTML = `<h2>Live calculations</h2><p class="card__sub">Same formulas as the workbook · week ${week}</p>
      ${block("PTM", "var(--ptm)")}${block("TA", "var(--ta)")}
      <div class="sum__pest"><h3>PTM : TA</h3>
        <div class="sum__ratio" role="img" aria-label="PTM ${Math.round(sp * 100)}%, TA ${t ? 100 - Math.round(sp * 100) : 0}%"><i style="width:${sp * 100}%;background:var(--ptm)"></i><i style="width:${t ? 100 - sp * 100 : 0}%;background:var(--ta)"></i></div>
        <div class="sum__legend"><span>PTM ${t ? Math.round(sp * 100) : 0}%</span><span>${fmt(t)} moths</span><span>TA ${t ? 100 - Math.round(sp * 100) : 0}%</span></div></div>`;
    const st = $("#status");
    if (!saving) { st.className = "savebar__status" + (dirty() ? " is-dirty" : ""); st.textContent = dirty() ? "Unsaved changes" : isNew ? `New week ${week} – not saved yet` : "All changes saved"; }
    $("#modeTxt").innerHTML = isNew ? `Adding <b>week ${week}</b>` : `Editing <b>week ${week}</b>`;
  }

  function renderAll() {
    renderWeekPicker(); renderTraps(); renderForecast();
    initial = isNew ? "" : snapshot();
    renderSummary();
    $("#saveBtn").textContent = isNew ? `Add week ${week}` : `Save week ${week}`;
  }

  /* ---------------- validation & save ---------------- */
  function validate(form) {
    const errs = [];
    form.counts.forEach(c => { if (c.value !== null && !(Number.isInteger(c.value) && c.value >= 0 && c.value <= 100000)) errs.push(`${c.pest} trap ${c.trap}: enter a whole number`); });
    if (!form.counts.some(c => isNum(c.value))) errs.push("Enter at least one trap count");
    (form.forecast || []).forEach((f, i) => {
      const bad = v => v !== null && !(v >= -20 && v <= 55);
      if (bad(f.min) || bad(f.max)) errs.push(`Outlook day ${i + 1}: temperature out of range`);
      if (isNum(f.min) && isNum(f.max) && f.min > f.max) errs.push(`Outlook ${f.date}: min is higher than max`);
    });
    if (!(week >= 1 && week <= 53)) errs.push("Week must be 1–53");
    return errs;
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    const form = readForm(), errs = validate(form), st = $("#status");
    if (errs.length) { st.className = "savebar__status is-error"; st.textContent = errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ""); return; }
    if (!WRITE_URL) { toast("Saving isn't connected yet – see the notice at the top.", true); return; }
    saving = true; $("#saveBtn").disabled = true; st.className = "savebar__status"; st.textContent = "Saving…";
    const setCurrent = season === "CY" && $("#setCurrent").checked;
    try {
      const res = await api("saveWeek", { season, week, setCurrent, counts: form.counts, forecast: form.forecast?.map(f => ({ ...f, early: f.early || "-", late: f.late || "-" })) });
      if (res.auth === false) { saving = false; lock("Your session expired – enter the passcode again."); return; }
      if (!res.ok) throw new Error(res.error || "Save failed");
      // reflect locally so the page doesn't wait for Google's cache
      form.counts.forEach(c => { const r = rows().find(x => x.Pest === c.pest && x["Trap No"] === c.trap); if (r) r[`Week ${week}`] = c.value; });
      if (form.forecast) { DATA.forecast = DATA.forecast.filter(f => f.Week !== week).concat(form.forecast.map(f => ({ Week: week, Date: f.date, "Blight Early": f.early || "-", "Blight Late": f.late || "-", "Temp Min": f.min, "Temp Max": f.max }))); }
      if (setCurrent) DATA.settings["Current Week"] = week;
      isNew = false; saving = false; $("#saveBtn").disabled = false;
      renderAll();
      toast(`Week ${week} saved.`, false, `../?week=${week}`);
    } catch (err) {
      saving = false; $("#saveBtn").disabled = false;
      st.className = "savebar__status is-error"; st.textContent = "Not saved: " + err.message;
    }
  }

  let tt;
  function toast(msg, isErr, link) {
    const t = $("#toast"); t.className = "toast" + (isErr ? " is-error" : "");
    t.innerHTML = esc(msg) + (link ? `<a href="${link}">View report →</a>` : ""); t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 6000);
  }

  /* ---------------- gate ---------------- */
  let settingKey = false;
  function lock(msg) {
    KEY = null; store.set(null);
    $("#editor").hidden = true; $("#lockBtn").hidden = true; $("#gate").hidden = false;
    $("#gateMsg").textContent = msg || ""; $("#pass1").value = ""; $("#pass1").focus();
  }
  function showGate(hasKey) {
    settingKey = !hasKey;
    $("#gateTitle").textContent = hasKey ? "Unlock data input" : "Create an admin passcode";
    $("#gateSub").textContent = hasKey ? "Enter the admin passcode to add or edit weekly data." : "No passcode is set yet. Choose one (8+ characters). Share it only with people who capture data.";
    $("#pass2wrap").hidden = hasKey; $("#pass1").autocomplete = hasKey ? "current-password" : "new-password";
    $("#gateBtn").textContent = hasKey ? "Unlock" : "Set passcode";
    lock();
  }
  async function onGate(e) {
    e.preventDefault();
    const p1 = $("#pass1").value, msg = $("#gateMsg");
    if (p1.length < 8) { msg.textContent = "Use at least 8 characters."; return; }
    if (settingKey && p1 !== $("#pass2").value) { msg.textContent = "The passcodes don't match."; return; }
    $("#gateBtn").disabled = true; msg.textContent = "";
    try {
      if (settingKey) { const r = await api("setKey", { newKey: p1 }); if (!r.ok) throw new Error(r.error); }
      KEY = p1;
      const v = await api("verify");
      if (!v.ok) { KEY = null; throw new Error(v.error || "Wrong passcode."); }
      store.set(KEY); openEditor();
    } catch (err) { msg.textContent = err.message; }
    finally { $("#gateBtn").disabled = false; }
  }
  function openEditor() { $("#gate").hidden = true; $("#editor").hidden = false; $("#lockBtn").hidden = !WRITE_URL; renderAll(); }

  /* ---------------- events ---------------- */
  function bind() {
    $("#gateForm").addEventListener("submit", onGate);
    $("#lockBtn").addEventListener("click", () => showGate(true));
    $("#editor").addEventListener("submit", save);
    $("#editor").addEventListener("input", e => {
      if (e.target.matches(".fc-date input") && e.target.closest(".fcin__row") === $(".fcin__row")) {
        const d0 = parseISO(e.target.value);
        if (d0) document.querySelectorAll(".fcin__row").forEach((r, i) => { const d = addDays(d0, i); $(".fc-date input", r).value = iso(d); $("[data-dow]", r).textContent = d.toLocaleDateString("en-ZA", { weekday: "long" }); });
      }
      if (e.target.matches("select")) tintRisk();
      renderSummary();
    });
    $("#editor").addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.matches("input")) {
        e.preventDefault();
        const ins = [...document.querySelectorAll(".trap input, .fcin__row select, .fcin__row input:not([readonly])")];
        const i = ins.indexOf(e.target); (ins[i + 1] || $("#saveBtn")).focus();
      }
    });
    const guard = (apply, revert) => { if (dirty()) { revert(); const st = $("#status"); st.className = "savebar__status is-error"; st.textContent = "Save or discard your changes first."; return; } apply(); renderAll(); };
    $("#weekSel").addEventListener("change", e => {
      const v = e.target.value, prev = isNew ? "new" : String(week);
      guard(() => { if (v === "new") { isNew = true; week = null; } else { isNew = false; week = +v; } }, () => { e.target.value = prev; });
      if (v === "new") $("#newWeek").focus();
    });
    $("#newWeek").addEventListener("change", e => {
      const n = Math.round(Number(e.target.value));
      if (!(n >= 1 && n <= 53)) { e.target.setAttribute("aria-invalid", "true"); return; }
      e.target.setAttribute("aria-invalid", "false");
      if (weeksFor().includes(n)) { isNew = false; week = n; renderAll(); toast(`Week ${n} already has data – opened it for editing.`); return; }
      week = n; renderAll();
    });
    document.querySelectorAll('input[name="season"]').forEach(r => r.addEventListener("change", e => {
      const prev = season;
      guard(() => { season = e.target.value; week = null; isNew = false; }, () => { document.querySelector(`input[name="season"][value="${prev}"]`).checked = true; });
    }));
    $("#resetBtn").addEventListener("click", () => { if (isNew) { isNew = false; week = null; } renderAll(); });
    addEventListener("beforeunload", e => { if (!$("#editor").hidden && dirty()) { e.preventDefault(); e.returnValue = ""; } });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    bind();
    try { DATA = D.SHEET_ID ? await D.loadLive() : structuredClone(window.LAC_SNAPSHOT); }
    catch (err) { $("#notice").hidden = false; $("#notice").textContent = "Couldn't read the Google Sheet (" + err.message + "). Check that it is shared as 'Anyone with the link – Viewer'."; return; }
    DATA.forecast = DATA.forecast || [];
    // sheets created before the Week column existed: the outlook belongs to the current week
    if (!DATA.forecast.some(f => isNum(f.Week))) DATA.forecast.forEach(f => f.Week = Number(DATA.settings["Current Week"]));
    $("#who").textContent = [DATA.settings.Region, DATA.settings.Representative].filter(Boolean).join(" · ");
    if (!WRITE_URL) {
      $("#notice").hidden = false;
      $("#notice").innerHTML = "Preview mode: saving isn't connected yet. Deploy the Apps Script in <code>apps-script/Code.gs</code> and put its web-app URL in <code>config.js → WRITE_URL</code>.";
      openEditor(); $("#saveBtn").disabled = true; return;
    }
    KEY = store.get();
    try {
      if (KEY) { const v = await api("verify"); if (v.ok) return openEditor(); KEY = null; store.set(null); }
      const s = await api("status"); showGate(!!s.hasKey);
    } catch (err) { $("#notice").hidden = false; $("#notice").textContent = "Couldn't reach the save service: " + err.message; showGate(true); }
  }
  boot();
})();
