/* LAC Monitoring Report – renders the weekly report from Google Sheets (or the bundled snapshot). */
(() => {
  "use strict";
  const { CFG, SHEET_ID, qs, loadLive, isNum, val, weekStats, change } = window.LACData;
  const PESTS = {
    PTM: { name: "PTM", long: "Potato tuber moth", color: "var(--ptm)", soft: "var(--ptm-soft)" },
    TA: { name: "TA", long: "Tuta absoluta", color: "var(--ta)", soft: "var(--ta-soft)" }
  };
  const $ = (s, el = document) => el.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const fmt = n => n == null || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en-ZA");
  const pct = n => (n > 0 ? "+" : "") + (n * 100).toFixed(2).replace(".", ",") + "%";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let DATA = null, WEEK = null, SOURCE = "snapshot", showPY = { PTM: false, TA: false }, showTable = { PTM: false, TA: false };

  /* ---------- calculations (mirror the workbook) ---------- */
  function traps(pest, w) {
    const py = DATA.py.filter(r => r.Pest === pest);
    return DATA.cy.filter(r => r.Pest === pest).sort((a, b) => a["Trap No"] - b["Trap No"]).map(r => ({
      trap: r["Trap No"], client: r.Client, cy: val(r, w), py: val(py.find(p => p["Trap No"] === r["Trap No"]), w)
    }));
  }
  const weeksWithData = () => window.LACData.weeksWithData(DATA.cy);
  const threshold = pest => Number(DATA.settings[`${pest} Threshold`]) || 600;
  function linreg(pts) {
    const p = pts.filter(q => isNum(q.y)); if (p.length < 2) return null;
    const n = p.length, sx = p.reduce((a, q) => a + q.x, 0), sy = p.reduce((a, q) => a + q.y, 0);
    const sxx = p.reduce((a, q) => a + q.x * q.x, 0), sxy = p.reduce((a, q) => a + q.x * q.y, 0);
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx); return { m, b: (sy - m * sx) / n };
  }
  function niceMax(v, ticks = 4) {
    const raw = v / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    return Math.ceil(v / step) * step;
  }

  /* ---------- svg helpers ---------- */
  function el(name, attrs = {}, parent) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  const txt = (parent, x, y, s, attrs = {}) => { const t = el("text", { x, y, ...attrs }, parent); t.textContent = s; return t; };
  const roundTopRect = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  const legendItem = (label, kind, color) => {
    const sw = kind === "bar" ? `<svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" rx="3" fill="${color}"/></svg>`
      : kind === "dot" ? `<svg width="22" height="12" aria-hidden="true"><path d="M1 6H21" stroke="${color}" stroke-width="2"/><circle cx="11" cy="6" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5"/></svg>`
      : `<svg width="22" height="12" aria-hidden="true"><path d="M1 6H21" stroke="${color}" stroke-width="2" stroke-dasharray="${kind === "dot2" ? "1.5 3" : "5 3"}" stroke-linecap="round"/></svg>`;
    return `<li>${sw}${esc(label)}</li>`;
  };

  /* ---------- tooltip ---------- */
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), pad = 12;
    let x = ev.clientX + 14, y = ev.clientY - r.height - 12;
    if (x + r.width > innerWidth - pad) x = ev.clientX - r.width - 14;
    if (x < pad) x = pad;
    if (y < pad) y = ev.clientY + 18;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".chart")) hideTip(); });
  const tipRow = (k, v) => `<div class="row"><span class="k">${k}</span><b>${v}</b></div>`;

  /* ---------- trap bar chart ---------- */
  function renderTrapCard(pest) {
    const card = $(`#card-${pest}`), P = PESTS[pest], rows = traps(pest, WEEK), thr = threshold(pest);
    const st = weekStats(DATA.cy, pest, WEEK);
    const nums = rows.map(r => r.cy).filter(isNum);
    const chartAvg = st.avg;
    const over = nums.filter(v => v >= thr).length;
    card.innerHTML = `
      <div class="card__head">
        <div><h3 class="card__title"><span class="swatch" style="background:${P.color}"></span>${P.name}</h3>
        <p class="card__sub">${P.long} · ${rows.length} traps · week ${WEEK}</p></div>
        <div class="card__tools"><button class="toggle" type="button" aria-pressed="${showTable[pest]}" data-table="${pest}">Table</button></div>
      </div>
      <div class="stats">
        <div class="stat"><span>Average</span><b>${fmt(chartAvg)}</b></div>
        <div class="stat"><span>Highest</span><b>${fmt(st.max)}</b></div>
        <div class="stat"><span>Over limit</span><b>${over}<small class="muted"> / ${nums.length}</small></b></div>
      </div>
      <div class="chart" role="img" aria-label="${P.long} trap counts for week ${WEEK}: average ${fmt(chartAvg)}, highest ${fmt(st.max)}, threshold ${thr}."></div>
      <ul class="legend">${legendItem("Count CY", "bar", P.color)}${legendItem("Count PY", "dot", pest === "PTM" ? "var(--ta)" : "var(--ptm)")}${legendItem("Avg.", "dash", "var(--avg)")}${legendItem("Threshold", "dash", "var(--thr)")}</ul>
      <div class="tablewrap" ${showTable[pest] ? "" : "hidden"}><table>
        <thead><tr><th>Trap</th><th>Client</th><th>CY</th><th>PY</th><th>Δ</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.trap}</td><td>${esc(r.client)}</td><td class="${isNum(r.cy) && r.cy >= thr ? "over" : ""}">${isNum(r.cy) ? fmt(r.cy) : r.cy === "*" ? "*" : "–"}</td><td>${isNum(r.py) ? fmt(r.py) : "–"}</td><td>${isNum(r.cy) && isNum(r.py) ? (r.cy - r.py > 0 ? "+" : "") + fmt(r.cy - r.py) : "–"}</td></tr>`).join("")}</tbody>
      </table></div>`;
    $(".toggle", card).onclick = e => { showTable[pest] = !showTable[pest]; e.currentTarget.setAttribute("aria-pressed", showTable[pest]); $(".tablewrap", card).hidden = !showTable[pest]; };
    drawBars($(".chart", card), rows, { color: P.color, pyColor: pest === "PTM" ? "var(--ta)" : "var(--ptm)", avg: chartAvg, thr, pest });
  }

  function drawBars(host, rows, o) {
    host.innerHTML = "";
    const W = Math.max(280, host.clientWidth), H = W < 520 ? 230 : 280;
    const m = { l: 34, r: 8, t: 14, b: 26 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" }, host);
    const vmax = Math.max(o.thr, ...rows.map(r => isNum(r.cy) ? r.cy : 0), ...rows.map(r => isNum(r.py) ? r.py : 0));
    const ymax = niceMax(vmax * 1.06), y = v => m.t + ph - (v / ymax) * ph;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (ymax / ticks) * i, yy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "axis" }, svg);
      txt(svg, m.l - 6, yy + 4, fmt(v), { "text-anchor": "end" });
    }
    const band = pw / rows.length, bw = Math.max(6, Math.min(40, band * 0.66)), showLabels = band >= 26;
    const cx = i => m.l + band * i + band / 2;
    // bars
    rows.forEach((r, i) => {
      if (isNum(r.cy) && r.cy > 0) {
        const top = y(r.cy), h = m.t + ph - top;
        el("path", { d: roundTopRect(cx(i) - bw / 2, top, bw, h, 4), fill: o.color }, svg);
        if (showLabels) {
          const inside = h > 22;
          txt(svg, cx(i), inside ? top + 14 : top - 5, fmt(r.cy), { "text-anchor": "middle", class: inside ? "val val--in" : "val", ...(inside && o.pest === "TA" ? { style: "fill:var(--surface)" } : {}) });
        }
      } else {
        txt(svg, cx(i), m.t + ph - 5, r.cy === "*" ? "*" : "–", { "text-anchor": "middle", class: "val" });
      }
      if (band >= 14 || i % 2 === 0) txt(svg, cx(i), H - 8, r.trap, { "text-anchor": "middle" });
    });
    // avg + threshold
    const hline = (v, color, dash, label) => {
      if (!isNum(v)) return;
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: color, "stroke-width": 2, "stroke-dasharray": dash, "stroke-linecap": "round" }, svg);
      const t = txt(svg, W - m.r - 2, y(v) - 5, label, { "text-anchor": "end", style: `fill:${color};font-weight:800` });
      const bb = t.getBBox();
      el("rect", { x: bb.x - 4, y: bb.y - 1, width: bb.width + 8, height: bb.height + 2, rx: 4, fill: "var(--surface)", opacity: .85 }, svg).after(t);
      svg.appendChild(t);
    };
    // PY line
    const pyPts = rows.map((r, i) => isNum(r.py) ? [cx(i), y(r.py)] : null);
    let d = "", pen = false;
    pyPts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); pen = true; });
    el("path", { d, fill: "none", stroke: o.pyColor, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    pyPts.forEach(p => p && el("circle", { cx: p[0], cy: p[1], r: band >= 20 ? 3.5 : 2.5, fill: o.pyColor, stroke: "var(--surface)", "stroke-width": 1.5 }, svg));
    hline(o.avg, "var(--avg)", "5 4", `Avg ${fmt(o.avg)}`);
    hline(o.thr, "var(--thr)", "2 4", `Threshold ${fmt(o.thr)}`);
    // hover layer
    rows.forEach((r, i) => {
      const hit = el("rect", { x: m.l + band * i, y: m.t, width: band, height: ph + m.b, class: "hit" }, svg);
      const hl = el("rect", { x: m.l + band * i + 1, y: m.t, width: band - 2, height: ph, class: "hl", rx: 4, opacity: 0, style: "fill:var(--ink);opacity:0" }, svg);
      svg.insertBefore(hl, svg.firstChild.nextSibling);
      const html = () => `<b>Trap ${r.trap}</b> · ${esc(r.client)}` +
        tipRow("Count CY", isNum(r.cy) ? fmt(r.cy) : r.cy === "*" ? "not read (*)" : "no count") +
        tipRow("Count PY", isNum(r.py) ? fmt(r.py) : "–") +
        (isNum(r.cy) && isNum(r.py) ? tipRow("vs PY", (r.cy - r.py > 0 ? "+" : "") + fmt(r.cy - r.py)) : "") +
        (isNum(r.cy) && r.cy >= o.thr ? `<div style="margin-top:4px;color:#ffb4a8;font-weight:800">Above threshold</div>` : "");
      const on = e => { hl.style.opacity = .06; showTip(html(), e); };
      hit.addEventListener("pointermove", on);
      hit.addEventListener("pointerdown", on);
      hit.addEventListener("pointerleave", () => { hl.style.opacity = 0; hideTip(); });
    });
  }

  /* ---------- weekly trend ---------- */
  function renderTrend(pest) {
    const card = $(`#trend-${pest}`), P = PESTS[pest];
    const n = Number(DATA.settings["Weeks in Trend"]) || 8;
    const weeks = Array.from({ length: n }, (_, i) => WEEK - n + 1 + i).filter(w => w >= 1);
    const cy = weeks.map((w, i) => ({ x: i, w, y: weekStats(DATA.cy, pest, w).avg }));
    const py = weeks.map((w, i) => ({ x: i, w, y: weekStats(DATA.py, pest, w).avg }));
    const cur = cy[cy.length - 1].y, prev = cy[cy.length - 2]?.y, ch = change(prev, cur);
    card.innerHTML = `
      <div class="card__head">
        <div><h3 class="card__title"><span class="swatch" style="background:${P.color}"></span>${P.name} weekly avg. count</h3>
        <p class="card__sub">Weeks ${weeks[0]}–${WEEK} · ${fmt(cur)} this week ${ch == null ? "" : deltaHTML(ch)}</p></div>
        <div class="card__tools"><button class="toggle" type="button" aria-pressed="${showPY[pest]}">vs ${esc(DATA.settings["Season (PY)"] || "PY")}</button></div>
      </div>
      <div class="chart" role="img" aria-label="${P.long} weekly average count from week ${weeks[0]} to ${WEEK}: ${cy.map(p => `week ${p.w} ${fmt(p.y)}`).join(", ")}."></div>
      <ul class="legend">${legendItem(`${P.name} weekly avg. ${DATA.settings["Season (CY)"] || ""}`, "dot", P.color)}${legendItem("Linear trend", "dot2", "var(--avg)")}${showPY[pest] ? legendItem(`Weekly avg. ${DATA.settings["Season (PY)"] || "PY"}`, "dash", "var(--py)") : ""}</ul>`;
    $(".toggle", card).onclick = () => { showPY[pest] = !showPY[pest]; renderTrend(pest); };
    drawLine($(".chart", card), cy, showPY[pest] ? py : null, P.color);
  }

  function drawLine(host, cy, py, color) {
    host.innerHTML = "";
    const W = Math.max(280, host.clientWidth), H = W < 520 ? 190 : 210;
    const m = { l: 12, r: 12, t: 26, b: 26 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" }, host);
    const all = [...cy, ...(py || [])].map(p => p.y).filter(isNum);
    let lo = Math.min(...all), hi = Math.max(...all); const span = Math.max(hi - lo, 40);
    lo = Math.max(0, lo - span * .45); hi = hi + span * .25;
    const n = cy.length, x = i => m.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1) * .92 + pw * .04), y = v => m.t + ph - ((v - lo) / (hi - lo)) * ph;
    el("line", { x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph, class: "axis" }, svg);
    cy.forEach((p, i) => txt(svg, x(i), H - 7, (W < 420 ? "W" : "Week ") + p.w, { "text-anchor": "middle", style: i === n - 1 ? "fill:var(--ink);font-weight:800" : "" }));
    const path = pts => { let d = "", pen = false; pts.forEach((p, i) => { if (!isNum(p.y)) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(p.y).toFixed(1); pen = true; }); return d; };
    const lr = linreg(cy);
    if (lr) el("line", { x1: x(0), y1: y(lr.b), x2: x(n - 1), y2: y(lr.m * (n - 1) + lr.b), stroke: "var(--avg)", "stroke-width": 1.5, "stroke-dasharray": "1.5 3.5", "stroke-linecap": "round" }, svg);
    if (py) {
      el("path", { d: path(py), fill: "none", stroke: "var(--py)", "stroke-width": 2, "stroke-dasharray": "5 4" }, svg);
      py.forEach((p, i) => isNum(p.y) && el("circle", { cx: x(i), cy: y(p.y), r: 3, fill: "var(--py)" }, svg));
    }
    // soft area under CY
    const first = cy.findIndex(p => isNum(p.y)), last = cy.length - 1 - [...cy].reverse().findIndex(p => isNum(p.y));
    if (first >= 0) el("path", { d: path(cy) + `L${x(last)},${m.t + ph}L${x(first)},${m.t + ph}Z`, fill: color, opacity: .08 }, svg);
    el("path", { d: path(cy), fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    cy.forEach((p, i) => {
      if (!isNum(p.y)) return;
      const big = i === n - 1;
      el("circle", { cx: x(i), cy: y(p.y), r: big ? 6 : 4.5, fill: big ? color : "var(--surface)", stroke: color, "stroke-width": 2.5 }, svg);
      txt(svg, x(i), y(p.y) - 11, fmt(p.y), { "text-anchor": "middle", class: "val", style: big ? "fill:var(--ink);font-size:12.5px;font-weight:800" : "" });
    });
    // crosshair hover
    const cross = el("line", { y1: m.t - 8, y2: m.t + ph, stroke: "var(--ink-3)", "stroke-width": 1, opacity: 0 }, svg);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, class: "hit" }, svg);
    const move = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
      let i = 0, best = Infinity; cy.forEach((_, k) => { const d = Math.abs(x(k) - px); if (d < best) { best = d; i = k; } });
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", .5);
      const prev = cy[i - 1]?.y, c = change(prev, cy[i].y);
      showTip(`<b>Week ${cy[i].w}</b>` + tipRow("Weekly avg.", fmt(cy[i].y)) + (c == null ? "" : tipRow("vs prev. week", pct(c))) + (py ? tipRow("Prev. season", fmt(py[i].y)) : ""), e);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
  }

  /* ---------- KPIs, ratio, movement ---------- */
  function deltaHTML(c, label) {
    if (c == null) return "";
    const cls = Math.abs(c) < 0.0005 ? "flat" : c > 0 ? "up" : "down";
    const arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "■";
    return `<span class="delta delta--${cls}"><span aria-hidden="true">${arrow}</span>${label ? label + " " : ""}${pct(c)}<span class="sr">${cls === "up" ? " increase" : cls === "down" ? " decrease" : ""}</span></span>`;
  }
  function renderKPIs() {
    const out = [];
    for (const pest of ["PTM", "TA"]) {
      const s = weekStats(DATA.cy, pest, WEEK), p = weekStats(DATA.cy, pest, WEEK - 1), ly = weekStats(DATA.py, pest, WEEK), thr = threshold(pest);
      out.push(`<div class="kpi" style="--k:${PESTS[pest].color}">
        <p class="kpi__label">${pest} weekly avg.</p>
        <p class="kpi__value">${fmt(s.avg)}<small>/ trap</small></p>
        <p class="kpi__foot">${deltaHTML(change(p.avg, s.avg))}<span>vs wk ${WEEK - 1}</span></p>
        <div class="kpi__bar" title="${fmt(s.avg)} of ${thr} threshold"><i style="width:${Math.min(100, (s.avg || 0) / thr * 100)}%"></i></div>
      </div>`);
      out.push(`<div class="kpi" style="--k:${PESTS[pest].color}">
        <p class="kpi__label">${pest} total catch</p>
        <p class="kpi__value">${fmt(s.total)}</p>
        <p class="kpi__foot">${deltaHTML(change(p.total, s.total))}<span>${fmt(p.total)} in wk ${WEEK - 1}</span></p>
        <p class="kpi__foot" style="margin-top:4px">${s.n} traps read${ly.avg ? ` · PY avg ${fmt(ly.avg)}` : ""}</p>
      </div>`);
    }
    // order: PTM avg, TA avg, PTM total, TA total
    $("#kpis").innerHTML = [out[0], out[2], out[1], out[3]].join("");
  }
  function renderRatio() {
    const a = weekStats(DATA.cy, "PTM", WEEK).total || 0, b = weekStats(DATA.cy, "TA", WEEK).total || 0, t = a + b;
    const pa = t ? a / t : 0, pb = t ? b / t : 0;
    const card = $("#ratio");
    card.innerHTML = `<div class="card__head"><div><h3 class="card__title">PTM : TA</h3><p class="card__sub">Share of total catch · week ${WEEK}</p></div></div>
      <div class="donut"><div class="chart" style="width:160px" role="img" aria-label="PTM ${Math.round(pa * 100)} percent, TA ${Math.round(pb * 100)} percent of ${fmt(t)} moths."></div>
      <ul class="donut__list">
        <li><span class="swatch" style="background:var(--ptm);width:12px;height:12px"></span><b>${Math.round(pa * 100)}%</b><span>PTM · ${fmt(a)}</span></li>
        <li><span class="swatch" style="background:var(--ta);width:12px;height:12px"></span><b>${Math.round(pb * 100)}%</b><span>TA · ${fmt(b)}</span></li>
      </ul></div>`;
    const host = $(".chart", card), svg = el("svg", { viewBox: "0 0 160 160", width: 160, height: 160, "aria-hidden": "true" }, host);
    const R = 64, w = 22, C = 2 * Math.PI * R, gap = t && pa > 0 && pb > 0 ? 3 : 0;
    el("circle", { cx: 80, cy: 80, r: R, fill: "none", stroke: "var(--grid)", "stroke-width": w }, svg);
    const seg = (frac, off, color, label, v) => {
      const c = el("circle", { cx: 80, cy: 80, r: R, fill: "none", stroke: color, "stroke-width": w, "stroke-dasharray": `${Math.max(0, frac * C - gap)} ${C}`, "stroke-dashoffset": -off * C, transform: "rotate(-90 80 80)", style: "cursor:pointer" }, svg);
      const on = e => showTip(`<b>${label}</b>` + tipRow("Moths", fmt(v)) + tipRow("Share", Math.round(frac * 100) + "%"), e);
      c.addEventListener("pointermove", on); c.addEventListener("pointerdown", on); c.addEventListener("pointerleave", hideTip);
    };
    if (t) { seg(pa, 0, "var(--ptm)", "PTM", a); seg(pb, pa, "var(--ta)", "TA", b); }
    txt(svg, 80, 78, fmt(t), { "text-anchor": "middle", class: "donut__big" });
    txt(svg, 80, 96, "moths", { "text-anchor": "middle", class: "donut__center" });
  }
  function renderMovement() {
    const card = $("#movement");
    const block = pest => {
      const p = weekStats(DATA.cy, pest, WEEK - 1).total, c = weekStats(DATA.cy, pest, WEEK).total, ch = change(p, c);
      const dir = ch == null ? "–" : ch > 0 ? "Up" : "Down";
      return `<div class="move"><h3><span class="swatch" style="background:${PESTS[pest].color}"></span>${pest} movement</h3>
        <div class="move__vs"><div><span class="wk">Week ${WEEK - 1}</span><b>${fmt(p)}</b></div><span class="move__arrow" aria-hidden="true">→</span><div><span class="wk">Week ${WEEK}</span><b>${fmt(c)}</b></div></div>
        ${deltaHTML(ch, dir)}</div>`;
    };
    card.innerHTML = `<div class="card__head"><div><h3 class="card__title">Week-on-week movement</h3><p class="card__sub">Total trap catch, all traps</p></div></div><div class="moves">${block("PTM")}${block("TA")}</div>`;
  }

  /* ---------- forecast ---------- */
  function parseDate(s) {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s); if (m) return new Date(+m[1], m[2] - 1, +m[3]);
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  function lvl(v) {
    const s = String(v ?? "").trim(); const k = s.toLowerCase();
    const cls = k.startsWith("low") ? "low" : k.startsWith("med") ? "medium" : k.startsWith("high") ? "high" : "none";
    return `<span class="lvl lvl--${cls}">${esc(s && s !== "-" ? s : "–")}</span>`;
  }
  function renderForecast() {
    const all = DATA.forecast || [], card = $("#forecast");
    const f = all.some(r => isNum(r.Week)) ? all.filter(r => r.Week === WEEK) : all;
    if (!f.length) { card.innerHTML = `<p class="fc__note">No blight risk or temperature outlook has been entered for week ${WEEK}.</p>`; return; }
    const tmin = Math.min(...f.map(r => r["Temp Min"]).filter(isNum)) - 2, tmax = Math.max(...f.map(r => r["Temp Max"]).filter(isNum)) + 2;
    card.innerHTML = `<div class="fc" role="list">${f.map(r => {
      const d = parseDate(r.Date), lo = r["Temp Min"], hi = r["Temp Max"];
      const left = isNum(lo) ? (lo - tmin) / (tmax - tmin) * 100 : 0, right = isNum(hi) ? (hi - tmin) / (tmax - tmin) * 100 : 0;
      return `<div class="fc__day" role="listitem">
        <p class="fc__dow">${d ? d.toLocaleDateString("en-ZA", { weekday: "short" }) : esc(r.Date)}</p>
        <p class="fc__date">${d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : ""}</p>
        <div class="risk"><span>Early blight ${lvl(r["Blight Early"])}</span><span>Late blight ${lvl(r["Blight Late"])}</span></div>
        <div class="temp"><div class="temp__nums"><span class="lo">${isNum(lo) ? lo + "°" : "–"}</span><span>${isNum(hi) ? hi + "°" : "–"}</span></div>
        <div class="temp__track" aria-label="Min ${lo}°C, max ${hi}°C"><span class="temp__fill" style="left:${left}%;right:${100 - right}%"></span></div></div>
      </div>`;
    }).join("")}</div><p class="fc__note">Temperatures in °C. Swipe sideways for all 7 days on smaller screens.</p>`;
  }

  /* ---------- page wiring ---------- */
  function setWeek(w, push = true) {
    WEEK = w;
    document.querySelectorAll("[data-week]").forEach(e => e.textContent = w);
    $("#weekSel").value = String(w);
    const ws = weeksWithData();
    $("#prevWeek").disabled = ws.indexOf(w) <= 0;
    $("#nextWeek").disabled = ws.indexOf(w) >= ws.length - 1;
    document.title = `Week ${w} · LAC Monitoring Report`;
    if (push) { const u = new URL(location); u.searchParams.set("week", w); history.replaceState(null, "", u); }
    renderAll();
  }
  function renderAll() {
    renderKPIs(); renderTrapCard("PTM"); renderTrapCard("TA"); renderTrend("PTM"); renderTrend("TA"); renderRatio(); renderMovement(); renderForecast();
  }
  function applySettings() {
    const s = DATA.settings;
    $("#title").textContent = s["Report Title"] || "Monitoring Report";
    $("#company").textContent = s.Company || "Laeveld Agrochem";
    $("#region").textContent = s.Region || "";
    $("#rep").textContent = s.Representative || "";
    const ws = weeksWithData();
    $("#weekSel").innerHTML = ws.map(w => `<option value="${w}">Week ${w}${w === Number(s["Current Week"]) ? " (current)" : ""}</option>`).join("");
  }
  function setSource(kind, msg) {
    SOURCE = kind;
    const s = $("#source");
    s.className = "source " + (kind === "live" ? "is-live" : "is-offline");
    $(".source__txt", s).textContent = msg;
    s.title = kind === "live" ? "Reading live from Google Sheets" : "Showing the bundled Week 46 snapshot";
    $("#srcFoot").textContent = kind === "live" ? `Data: Google Sheets, refreshed ${new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}.` : "Data: bundled Week 46 snapshot.";
  }
  async function boot(initial) {
    let data = null;
    if (SHEET_ID) {
      try { data = await loadLive(); if (!data.cy.length) throw new Error("Counts CY is empty"); setSource("live", "Live"); }
      catch (e) { console.warn("Live data failed, using snapshot:", e); data = null; setSource("offline", "Offline"); }
    } else setSource("offline", "Snapshot");
    DATA = data || window.LAC_SNAPSHOT;
    applySettings();
    const ws = weeksWithData(), want = Number(qs.get("week")) || Number(DATA.settings["Current Week"]);
    const w = initial ? (ws.includes(want) ? want : ws[ws.length - 1]) : (ws.includes(WEEK) ? WEEK : ws[ws.length - 1]);
    document.body.classList.remove("loading");
    setWeek(w, !initial);
  }

  $("#weekSel").addEventListener("change", e => setWeek(+e.target.value));
  $("#prevWeek").addEventListener("click", () => { const ws = weeksWithData(); setWeek(ws[Math.max(0, ws.indexOf(WEEK) - 1)]); });
  $("#nextWeek").addEventListener("click", () => { const ws = weeksWithData(); setWeek(ws[Math.min(ws.length - 1, ws.indexOf(WEEK) + 1)]); });
  $("#printBtn").addEventListener("click", () => print());
  $("#themeBtn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark"; document.documentElement.dataset.theme = next;
    try { localStorage.setItem("lac-theme", next); } catch (e) {}
  });
  try { const t = localStorage.getItem("lac-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  // section highlighting in the sticky tab bar
  const links = [...document.querySelectorAll(".tabs a")];
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id));
  }), { rootMargin: "-40% 0px -55% 0px" });
  document.querySelectorAll("main .section").forEach(s => io.observe(s));

  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => DATA && renderAll(), 150); });
  if (SHEET_ID && CFG.REFRESH_MINUTES) setInterval(() => boot(false), CFG.REFRESH_MINUTES * 60000);

  document.body.classList.add("loading");
  boot(true);
})();
