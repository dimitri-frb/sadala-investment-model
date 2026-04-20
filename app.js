// Calculation engine + UI rendering for the investment model.

// ===== Formatting =====
const fmtEUR = (n) => (n == null || isNaN(n)) ? "—" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n, d = 1) => (n == null || isNaN(n)) ? "—" : `${(n * 100).toFixed(d)}%`;
const fmtNum = (n, d = 2) => (n == null || isNaN(n)) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

// ===== IRR =====
// Closed-form annualized IRR for a single lump-sum return after `months` months.
function irrLumpSum(equityInvested, equityReturn, months) {
  if (!equityInvested || equityInvested <= 0 || !months || months <= 0) return null;
  const multiple = equityReturn / equityInvested;
  if (multiple <= 0) return -1;
  return Math.pow(multiple, 12 / months) - 1;
}

// ===== Core engine =====
function compute(opp, scenarioKey) {
  const s = opp.scenarios[scenarioKey];
  const P = opp.property;
  const builtTotal = P.sobreRasante + P.bajoRasante + P.terrazas;
  const edificableTotal = P.parcela * P.ratioEdificabilidad;

  // --- Revenue (single line, no stages) ---
  const revenue = s.salePricePerSqm * builtTotal;

  // --- Acquisition ---
  const A = opp.acquisition;
  const landTax = A.landPrice * A.landTaxRate;
  const notary = A.landPrice * A.notaryRate;
  const landSalesComm = A.landPrice * A.salesCommissionRate;
  const acquisitionTotal = A.landPrice + landTax + notary + landSalesComm;

  // --- Setup ---
  const setupCost = acquisitionTotal * opp.setupRate;

  // --- Hard costs (construction) ---
  const H = opp.hardCosts;
  const pem = s.pemPerSqm * builtTotal;
  const pec = pem * H.pecRate;
  const otherCosts = pem * H.otherCostsRate;  // now % of PEM only
  const construction = pem + pec + otherCosts;
  const contingencies = construction * H.contingenciesRate;

  // --- Soft costs (all % of construction) ---
  const S = opp.softCosts;
  const architecture = construction * S.architectureRate;
  const aparejador = construction * S.aparejadorRate;
  const licence = construction * S.licenceRate;
  const projectManagement = construction * S.projectManagementRate;
  const softCost = architecture + aparejador + licence + projectManagement;

  // --- Totals ---
  const totalCosts = acquisitionTotal + setupCost + opp.urbanizationCost
                   + construction + contingencies + softCost;

  // --- P&L waterfall ---
  const ebitda = revenue - totalCosts;
  const commercialization = revenue * opp.commercializationRate;
  const ebit = ebitda - commercialization;
  const financing = totalCosts * opp.financingRate;
  const ebt = ebit - financing;
  const tax = ebt * opp.taxRate;
  const eat = ebt - tax;

  // --- Equity & returns ---
  const equityInvested = acquisitionTotal + setupCost + opp.urbanizationCost
                       + contingencies + softCost;
  const netProfit = eat;
  const roe = netProfit / equityInvested;
  const rentabilidad = netProfit / totalCosts;
  const equityReturn = equityInvested + netProfit;

  const durationMonths = opp.projectDurationMonths;
  const irrBase = irrLumpSum(equityInvested, equityReturn, durationMonths);
  const irrDelayed = irrLumpSum(equityInvested, equityReturn, durationMonths + 12);
  const irrDelayed24 = irrLumpSum(equityInvested, equityReturn, durationMonths + 24);

  return {
    builtTotal, edificableTotal,
    revenue, pricePerSqm: s.salePricePerSqm,
    acquisition: {
      landPrice: A.landPrice, landTax, notary, landSalesComm, total: acquisitionTotal,
      landTaxRegime: A.landTaxRegime, landTaxRate: A.landTaxRate,
      notaryRate: A.notaryRate, salesCommissionRate: A.salesCommissionRate,
    },
    setupCost,
    urbanization: opp.urbanizationCost,
    hard: {
      pem, pec, otherCosts, construction, contingencies,
      pemPerSqm: s.pemPerSqm,
    },
    soft: {
      architecture, aparejador, licence, projectManagement, total: softCost,
    },
    totalCosts,
    pnl: { revenue, totalCosts, ebitda, commercialization, ebit, financing, ebt, tax, eat },
    returns: {
      equityInvested, netProfit, roe, rentabilidad,
      equityReturn, durationMonths,
      irrBase, irrDelayed, irrDelayed24,
    },
  };
}

// ===== State =====
const state = {
  oppKey: null,
  scenario: "base",
  tab: "summary",
  expanded: { land: false, hard: false, soft: false },
  pctStyle: "bars",  // "bars" | "fill" | "dots" | "text"
};

const PCT_STYLES = ["bars", "fill", "dots", "text"];

// ===== URL hash sync (so refresh + share keep the view) =====
// Hash format: #opp=<key>&tab=<tab>&scenario=<scenario>
function readHash() {
  const hash = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return {
    opp: params.get("opp"),
    tab: params.get("tab"),
    scenario: params.get("scenario"),
    pct: params.get("pct"),
  };
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.oppKey)   params.set("opp", state.oppKey);
  if (state.tab)      params.set("tab", state.tab);
  if (state.scenario) params.set("scenario", state.scenario);
  if (state.pctStyle && state.pctStyle !== "bars") params.set("pct", state.pctStyle);
  const newHash = "#" + params.toString();
  // Use replaceState so we don't clutter browser history on every click.
  if (location.hash !== newHash) {
    history.replaceState(null, "", newHash);
  }
}

// ===== Status badge =====
function statusBadgeHTML(opp) {
  if (!opp.status) return "";
  const slug = opp.status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `<span class="status-badge status-${slug}">${opp.status}</span>`;
}

// ===== Placeholder renderer =====
function renderPlaceholder(opp) {
  return `
    <div class="summary-head">
      <div>
        <h2>${opp.name} ${statusBadgeHTML(opp)}</h2>
        <div class="muted">${opp.address || "Address TBD"}</div>
      </div>
    </div>
    <div class="placeholder-panel">
      <div class="placeholder-icon">📋</div>
      <h3>No data yet</h3>
      <p>This opportunity is at the <strong>"${opp.status}"</strong> stage. Numbers will be filled in as the project progresses.</p>
      <p class="muted">To add data, edit <code>data/${state.oppKey}.js</code> — remove the <code>placeholder: true</code> flag and add the same fields as <code>el-cantal.js</code>.</p>
    </div>
  `;
}

// ===== Date helpers (YYYY-MM) =====
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMonthYear(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ===== Timeline =====
function resolveTimeline(timeline) {
  const byId = {};
  return timeline.map(item => {
    let date = item.date;
    if (!date && item.offsetFrom) {
      const anchor = byId[item.offsetFrom];
      if (anchor && anchor.date) date = addMonths(anchor.date, item.offsetMonths || 0);
    }
    const resolved = { ...item, date };
    byId[item.id] = resolved;
    return resolved;
  });
}

function renderTimeline(opp) {
  if (!opp.timeline || !opp.timeline.length) return "";
  const items = resolveTimeline(opp.timeline);

  // Build: item, line-to-next, item, line-to-next, ... item
  let inner = "";
  items.forEach((t, i) => {
    inner += `
      <div class="tl-item tl-${t.status}">
        <div class="tl-dot"></div>
        <div class="tl-label">${t.label}</div>
        <div class="tl-date">${fmtMonthYear(t.date)}</div>
      </div>`;
    if (i < items.length - 1) {
      // Line color is driven by the *next* milestone's status:
      // done if we've completed it, dashed if still upcoming.
      inner += `<div class="tl-line tl-${items[i + 1].status}"></div>`;
    }
  });

  return `
    <div class="timeline-section">
      <h3>Timeline</h3>
      <div class="timeline">${inner}</div>
    </div>`;
}

// ===== Per-row % visualization (style controlled by state.pctStyle) =====
// Styles: "bars" (default), "fill", "dots", "text"
function pctCell(value, total) {
  const pct = total ? value / total : 0;
  const clamped = Math.min(Math.max(pct, 0), 1);
  const label = `<span class="pct-num">${fmtPct(pct)}</span>`;

  switch (state.pctStyle) {
    case "fill": {
      const w = (clamped * 100).toFixed(1);
      return `<div class="pct-cell pctv-fill" style="background: linear-gradient(to right, var(--pct-color, #dbeafe) ${w}%, transparent ${w}%)">${label}</div>`;
    }
    case "dots": {
      const filled = Math.round(clamped * 10);
      let dots = "";
      for (let i = 0; i < 10; i++) dots += `<span class="pct-dot ${i < filled ? "on" : "off"}"></span>`;
      return `<div class="pct-cell pctv-dots"><div class="pct-dots-row">${dots}</div>${label}</div>`;
    }
    case "text":
      return `<div class="pct-cell pctv-text">${label}</div>`;
    case "bars":
    default: {
      const w = (clamped * 100).toFixed(1);
      return `
        <div class="pct-cell pctv-bars">
          <div class="pct-bar"><div class="pct-fill" style="width:${w}%"></div></div>
          ${label}
        </div>`;
    }
  }
}

// ===== Tab: Summary =====
function renderSummary(opp) {
  const scenarios = ["worst", "base", "best"];
  const results = Object.fromEntries(scenarios.map(s => [s, compute(opp, s)]));
  const scenLabel = { worst: "Worst", base: "Base", best: "Best" };

  const kpis = [
    { label: "Revenue",                                              get: r => fmtEUR(r.pnl.revenue) },
    { label: "Costs",                                                get: r => fmtEUR(r.pnl.totalCosts) },
    { label: "Benefits",                                             get: r => fmtEUR(r.pnl.eat), highlight: true },
    { label: "Profit margin",                                        get: r => fmtPct(r.returns.rentabilidad) },
    { label: r => `Net IRR (${r.returns.durationMonths} mo)`,        get: r => fmtPct(r.returns.irrBase), highlight: true },
    { label: r => `Net IRR (${r.returns.durationMonths + 12} mo, 12-mo delay)`, get: r => fmtPct(r.returns.irrDelayed) },
    { label: "ROE",                                                  get: r => fmtPct(r.returns.roe), highlight: true },
  ];

  let html = `
    <div class="summary-head">
      <div>
        <h2>${opp.name} ${statusBadgeHTML(opp)}</h2>
        <div class="muted">${opp.address || "Address TBD"}</div>
      </div>
    </div>
    ${renderTimeline(opp)}
    <h3>Scenarios</h3>
    <div class="scenario-grid">
  `;

  for (const scen of scenarios) {
    const r = results[scen];
    const note = opp.scenarios[scen].note;
    html += `
      <div class="scenario-card scen-${scen}">
        <div class="scen-head">
          <div class="scen-name">${scenLabel[scen]} case</div>
          <div class="scen-sub">${fmtEUR(opp.scenarios[scen].salePricePerSqm)}/sqm sale · ${fmtEUR(opp.scenarios[scen].pemPerSqm)}/sqm PEM</div>
          ${note ? `<div class="scen-note">${note}</div>` : ""}
        </div>
        <div class="scen-body">
    `;
    for (const k of kpis) {
      const label = typeof k.label === "function" ? k.label(r) : k.label;
      html += `
        <div class="kpi ${k.highlight ? "kpi-hl" : ""}">
          <div class="kpi-label">${label}</div>
          <div class="kpi-value">${k.get(r)}</div>
        </div>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}

// ===== Tab: Hypothesis =====
function hypRow(label, value, opts = {}) {
  const cls = opts.sub ? "sub" : opts.derived ? "derived" : "";
  return `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;
}

function renderHypothesis(opp) {
  const P = opp.property;
  const builtTotal = P.sobreRasante + P.bajoRasante + P.terrazas;
  const edificable = P.parcela * P.ratioEdificabilidad;
  const A = opp.acquisition;
  const H = opp.hardCosts;
  const S = opp.softCosts;

  let html = `
    <h2>Hypothesis — ${opp.name} ${statusBadgeHTML(opp)}</h2>
    <p class="muted">Inputs are edited in <code>data/${state.oppKey}.js</code> via Claude Code. This view is read-only.</p>

    <div class="two-col">
      <div class="col">
        <h3>Property</h3>
        <table class="kv property-table">
          <tbody>
            ${hypRow("Tipologia edificacion", P.tipologia)}
            ${hypRow("Superficie parcela adoptada", `${fmtNum(P.parcela)} m²`)}
            ${hypRow("Ratio edificabilidad", fmtNum(P.ratioEdificabilidad))}
            ${hypRow("Superficie edificabilidad total", `${fmtNum(edificable)} m²`, { derived: true })}
            ${hypRow("Superficie construida total", `${fmtNum(builtTotal)} m²`, { derived: true })}
            ${hypRow("Construida sobre rasante", `${fmtNum(P.sobreRasante)} m²`, { sub: true })}
            ${hypRow("Construida bajo rasante", `${fmtNum(P.bajoRasante)} m²`, { sub: true })}
            ${hypRow("Terrazas", `${fmtNum(P.terrazas)} m²`, { sub: true })}
            ${hypRow("Exterior jardines y ZZCC urbanizacion", `${fmtNum(P.exteriorJardines)} m²`, { sub: true })}
          </tbody>
        </table>

        <h3>Acquisition</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Land price", fmtEUR(A.landPrice))}
            ${hypRow(`${A.landTaxRegime} (% of land price)`,      fmtPct(A.landTaxRate, 0))}
            ${hypRow("Notary (% of land price)",                  fmtPct(A.notaryRate, 0))}
            ${hypRow("Sales commission (% of land price)",        fmtPct(A.salesCommissionRate, 0))}
          </tbody>
        </table>

        <h3>Setup</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Setup costs (% of acquisition total)",      fmtPct(opp.setupRate, 0))}
          </tbody>
        </table>

        <h3>Timing</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Project duration (est.)", `${opp.projectDurationMonths} months`)}
          </tbody>
        </table>
      </div>

      <div class="col">
        <h3>Hard costs</h3>
        <table class="kv">
          <tbody>
            ${hypRow("PEM costs",                                 "per scenario")}
            ${hypRow("PEC costs (% of PEM costs)",                fmtPct(H.pecRate, 0))}
            ${hypRow("Other costs — insurance, taxes (% of PEM)", fmtPct(H.otherCostsRate, 0))}
            ${hypRow("Contingencies (% of construction)",         fmtPct(H.contingenciesRate, 0))}
          </tbody>
        </table>

        <h3>Soft costs</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Architecture (% of construction)",          fmtPct(S.architectureRate, 0))}
            ${hypRow("Aparejador (% of construction)",            fmtPct(S.aparejadorRate, 1))}
            ${hypRow("Licence & others (% of construction)",      fmtPct(S.licenceRate, 0))}
            ${hypRow("Project management (% of construction)",    fmtPct(S.projectManagementRate, 0))}
          </tbody>
        </table>

        <h3>P&L rates</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Commercialization (% of revenue)",          fmtPct(opp.commercializationRate, 0))}
            ${hypRow("Financing (% of total costs)",              fmtPct(opp.financingRate, 0))}
            ${hypRow("IS / tax rate",                             fmtPct(opp.taxRate, 0))}
          </tbody>
        </table>
      </div>
    </div>

    <h3>Scenario assumptions</h3>
    <table class="kv">
      <thead>
        <tr><th>Scenario</th><th class="num">Sale €/sqm</th><th class="num">PEM €/sqm</th><th>Note</th></tr>
      </thead>
      <tbody>
        ${["worst", "base", "best"].map(s => `
          <tr>
            <td class="scen-${s}">${s[0].toUpperCase()}${s.slice(1)} case</td>
            <td class="num">${fmtEUR(opp.scenarios[s].salePricePerSqm)}</td>
            <td class="num">${fmtEUR(opp.scenarios[s].pemPerSqm)}</td>
            <td class="muted">${opp.scenarios[s].note || "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

  `;
  return html;
}

// ===== Tab: P&L =====
function renderPnL(opp) {
  const r = compute(opp, state.scenario);
  const rev = r.pnl.revenue;
  const A = r.acquisition;

  // Expandable cost detail rows
  const landDetails = [
    { label: "Land price",                                                              value: A.landPrice },
    { label: `${A.landTaxRegime} (${fmtPct(A.landTaxRate, 0)})`,                        value: A.landTax },
    { label: `Notary (${fmtPct(A.notaryRate, 0)})`,                                     value: A.notary },
    { label: `Sales commission (${fmtPct(A.salesCommissionRate, 0)})`,                  value: A.landSalesComm },
  ];
  const hardDetails = [
    { label: `PEM (${fmtEUR(r.hard.pemPerSqm)}/sqm × ${fmtNum(r.builtTotal, 1)} sqm)`, value: r.hard.pem },
    { label: `PEC (${fmtPct(opp.hardCosts.pecRate, 0)} of PEM)`,                        value: r.hard.pec },
    { label: `Other costs — insurance, taxes (${fmtPct(opp.hardCosts.otherCostsRate, 0)} of PEM)`, value: r.hard.otherCosts },
  ];
  const softDetails = [
    { label: `Architecture (${fmtPct(opp.softCosts.architectureRate, 0)} of construction)`,          value: r.soft.architecture },
    { label: `Aparejador (${fmtPct(opp.softCosts.aparejadorRate, 1)} of construction)`,              value: r.soft.aparejador },
    { label: `Licence & others (${fmtPct(opp.softCosts.licenceRate, 0)} of construction)`,           value: r.soft.licence },
    { label: `Project management (${fmtPct(opp.softCosts.projectManagementRate, 0)} of construction)`, value: r.soft.projectManagement },
  ];

  function expandableRow(key, label, value) {
    const open = state.expanded[key];
    const triangle = open ? "▾" : "▸";
    return `
      <tr class="cost-row expandable" data-toggle="${key}">
        <td><span class="triangle">${triangle}</span> ${label}</td>
        <td class="num">${fmtEUR(value)}</td>
        <td class="num pct-text-cell">${pctCell(value, rev)}</td>
      </tr>`;
  }

  function detailRows(key, details) {
    if (!state.expanded[key]) return "";
    return details.map(d => `
      <tr class="cost-detail">
        <td>${d.label}</td>
        <td class="num">${fmtEUR(d.value)}</td>
        <td class="num pct-text-cell">${pctCell(d.value, rev)}</td>
      </tr>`).join("");
  }

  const pctStyleLabel = { bars: "Bars", fill: "Fill", dots: "Dots", text: "Text" };
  const html = `
    <h2>P&L — ${opp.name} ${statusBadgeHTML(opp)} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

    <div class="pnl-toolbar">
      <div class="pct-style-toggle">
        <span class="pct-style-label">% visual:</span>
        ${PCT_STYLES.map(k => `
          <button class="pct-style-btn ${state.pctStyle === k ? "active" : ""}" data-pct-style="${k}">${pctStyleLabel[k]}</button>
        `).join("")}
      </div>
    </div>

    <table class="pnl">
      <thead>
        <tr><th></th><th class="num">€</th><th class="pct-col">% of revenue</th></tr>
      </thead>
      <tbody>

        <tr class="section-header"><td colspan="3">Revenue</td></tr>
        <tr class="line-primary">
          <td>Gross sale</td>
          <td class="num">${fmtEUR(r.pnl.revenue)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.revenue, rev)}</td>
        </tr>

        <tr class="section-spacer"><td colspan="3"></td></tr>

        <tr class="section-header"><td colspan="3">Costs</td></tr>
        ${expandableRow("land", "Land (incl. tax, notary, commission)", r.acquisition.total)}
        ${detailRows("land", landDetails)}
        <tr class="cost-row">
          <td><span class="triangle-spacer"></span> Setup costs (${fmtPct(opp.setupRate, 0)} of acquisition)</td>
          <td class="num">${fmtEUR(r.setupCost)}</td>
          <td class="num pct-text-cell">${pctCell(r.setupCost, rev)}</td>
        </tr>
        ${expandableRow("hard", "Hard costs (construction)", r.hard.construction)}
        ${detailRows("hard", hardDetails)}
        <tr class="cost-row">
          <td><span class="triangle-spacer"></span> Contingencies (${fmtPct(opp.hardCosts.contingenciesRate, 0)} of construction)</td>
          <td class="num">${fmtEUR(r.hard.contingencies)}</td>
          <td class="num pct-text-cell">${pctCell(r.hard.contingencies, rev)}</td>
        </tr>
        ${expandableRow("soft", "Soft costs (architecture, PM, etc.)", r.soft.total)}
        ${detailRows("soft", softDetails)}
        <tr class="line-primary subtle">
          <td>Total costs</td>
          <td class="num">${fmtEUR(r.pnl.totalCosts)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.totalCosts, rev)}</td>
        </tr>

        <tr class="section-spacer"><td colspan="3"></td></tr>

        <tr class="section-header waterfall-header"><td colspan="3">EBITDA</td></tr>
        <tr class="line-primary pos">
          <td>EBITDA (Revenue − Costs)</td>
          <td class="num">${fmtEUR(r.pnl.ebitda)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.ebitda, rev)}</td>
        </tr>
        <tr class="line-deduction">
          <td><span class="triangle-spacer"></span> Commercialization costs (${fmtPct(opp.commercializationRate, 0)} of revenue)</td>
          <td class="num">−${fmtEUR(r.pnl.commercialization)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.commercialization, rev)}</td>
        </tr>

        <tr class="section-spacer"><td colspan="3"></td></tr>

        <tr class="section-header waterfall-header"><td colspan="3">EBIT</td></tr>
        <tr class="line-primary pos">
          <td>EBIT</td>
          <td class="num">${fmtEUR(r.pnl.ebit)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.ebit, rev)}</td>
        </tr>
        <tr class="line-deduction">
          <td><span class="triangle-spacer"></span> Financing costs (${fmtPct(opp.financingRate, 0)} of costs)</td>
          <td class="num">−${fmtEUR(r.pnl.financing)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.financing, rev)}</td>
        </tr>

        <tr class="section-spacer"><td colspan="3"></td></tr>

        <tr class="section-header waterfall-header"><td colspan="3">EBT</td></tr>
        <tr class="line-primary pos">
          <td>EBT</td>
          <td class="num">${fmtEUR(r.pnl.ebt)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.ebt, rev)}</td>
        </tr>
        <tr class="line-deduction">
          <td><span class="triangle-spacer"></span> Taxes (IS, ${fmtPct(opp.taxRate, 0)})</td>
          <td class="num">−${fmtEUR(r.pnl.tax)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.tax, rev)}</td>
        </tr>

        <tr class="section-spacer"><td colspan="3"></td></tr>

        <tr class="section-header waterfall-header eat-header"><td colspan="3">EAT</td></tr>
        <tr class="line-primary pos eat-line">
          <td>EAT (Net profit)</td>
          <td class="num">${fmtEUR(r.pnl.eat)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.eat, rev)}</td>
        </tr>

      </tbody>
    </table>

    ${renderProfitDistribution(opp, r)}
  `;
  return html;
}

// ===== Profit distribution block (shared between P&L bottom and elsewhere) =====
// Palette — one color per investor position. Cycles if > 5 investors.
const DIST_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];

function computeDistribution(opp, r) {
  const eq = r.returns.equityInvested;
  const namedEquity = opp.investors.reduce((s, i) => s + (i.equity || 0), 0);
  return opp.investors.map((inv, idx) => {
    const profit = inv.profitShare * r.returns.netProfit;
    const equityIn = inv.equity == null ? eq - namedEquity : inv.equity;
    const multiple = equityIn > 0 ? (equityIn + profit) / equityIn : null;
    return { ...inv, idx, equityIn, profit, multiple, color: DIST_COLORS[idx % DIST_COLORS.length] };
  });
}

function renderProfitDistribution(opp, r) {
  const rows = computeDistribution(opp, r);
  const totalProfit = r.returns.netProfit;

  // Stacked bar segments (use profitShare so tiny positions still show)
  const segments = rows.map(inv => `
    <div class="dist-seg"
         style="width:${(inv.profitShare * 100)}%; background:${inv.color}"
         title="${inv.name}: ${fmtPct(inv.profitShare, 1)} · ${fmtEUR(inv.profit)}"></div>
  `).join("");

  // Per-investor rows with their own mini bar
  const investorRows = rows.map(inv => `
    <tr>
      <td><span class="dist-dot" style="background:${inv.color}"></span> ${inv.name}</td>
      <td class="num">${fmtPct(inv.profitShare, 1)}</td>
      <td class="num">${fmtEUR(inv.profit)}</td>
      <td class="num">${inv.multiple == null ? "—" : inv.multiple.toFixed(2) + "×"}</td>
      <td class="dist-bar-cell">
        <div class="dist-mini-bar">
          <div class="dist-mini-fill" style="width:${inv.profitShare * 100}%; background:${inv.color}"></div>
        </div>
      </td>
    </tr>
  `).join("");

  return `
    <div class="distribution-section">
      <h3>Profit distribution</h3>
      <p class="muted">How the EAT of <strong>${fmtEUR(totalProfit)}</strong> is split among shareholders.</p>

      <div class="dist-bar-wrap">
        <div class="dist-bar">${segments}</div>
        <div class="dist-legend">
          ${rows.map(inv => `
            <div class="dist-legend-item">
              <span class="dist-dot" style="background:${inv.color}"></span>
              <span class="dist-legend-name">${inv.name}</span>
              <span class="dist-legend-pct">${fmtPct(inv.profitShare, 1)}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <table class="kv dist-table">
        <thead>
          <tr>
            <th>Investor</th>
            <th class="num">Share</th>
            <th class="num">Net profit</th>
            <th class="num">Multiple</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${investorRows}</tbody>
      </table>
    </div>
  `;
}

// ===== Tab: Investors =====
function renderInvestors(opp) {
  const r = compute(opp, state.scenario);
  const eq = r.returns.equityInvested;

  const namedEquity = opp.investors.reduce((sum, i) => sum + (i.equity || 0), 0);
  const investors = opp.investors.map(i => ({
    ...i,
    computedEquity: i.equity == null ? eq - namedEquity : i.equity,
  }));

  return `
    <h2>Investors — ${opp.name} ${statusBadgeHTML(opp)} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

    <h3>ROE analysis</h3>
    <table class="kv">
      <tbody>
        <tr><td>Equity invested</td><td class="num">${fmtEUR(r.returns.equityInvested)}</td></tr>
        <tr><td>Net profit (EAT, for distribution)</td><td class="num">${fmtEUR(r.returns.netProfit)}</td></tr>
        <tr class="hl"><td>ROE</td><td class="num"><strong>${fmtPct(r.returns.roe)}</strong></td></tr>
      </tbody>
    </table>

    <h3>IRR analysis</h3>
    <p class="muted">IRR assumes a lump-sum equity return at exit. Annualized.</p>
    <table class="kv">
      <thead>
        <tr><th>Horizon</th><th class="num">Equity invested (Y0)</th><th class="num">Equity return at exit</th><th class="num">IRR</th></tr>
      </thead>
      <tbody>
        <tr class="hl"><td>${r.returns.durationMonths} months (base)</td><td class="num">${fmtEUR(-eq)}</td><td class="num">${fmtEUR(r.returns.equityReturn)}</td><td class="num"><strong>${fmtPct(r.returns.irrBase)}</strong></td></tr>
        <tr><td>${r.returns.durationMonths + 12} months (12-mo delay)</td><td class="num">${fmtEUR(-eq)}</td><td class="num">${fmtEUR(r.returns.equityReturn)}</td><td class="num">${fmtPct(r.returns.irrDelayed)}</td></tr>
        <tr><td>${r.returns.durationMonths + 24} months (24-mo delay)</td><td class="num">${fmtEUR(-eq)}</td><td class="num">${fmtEUR(r.returns.equityReturn)}</td><td class="num">${fmtPct(r.returns.irrDelayed24)}</td></tr>
      </tbody>
    </table>

    <h3>Distribution per investor</h3>
    <table class="kv">
      <thead>
        <tr>
          <th>Investor</th>
          <th class="num">Equity</th>
          <th class="num">Profit share</th>
          <th class="num">Net profit</th>
          <th class="num">Multiple</th>
        </tr>
      </thead>
      <tbody>
        ${investors.map(i => {
          const profit = i.profitShare * r.returns.netProfit;
          const multiple = i.computedEquity > 0 ? (i.computedEquity + profit) / i.computedEquity : null;
          return `
            <tr>
              <td>${i.name}</td>
              <td class="num">${fmtEUR(i.computedEquity)}</td>
              <td class="num">${fmtPct(i.profitShare, 1)}</td>
              <td class="num">${fmtEUR(profit)}</td>
              <td class="num">${multiple == null ? "—" : multiple.toFixed(2) + "×"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

// ===== Tab dispatch =====
function renderTab() {
  writeHash();
  // Sync the active tab button class (in case tab changed via hash/back)
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === state.tab));

  const opp = window.OPPORTUNITIES[state.oppKey];
  const main = document.getElementById("main");
  if (!opp) { main.innerHTML = "<p>No opportunity selected.</p>"; return; }

  if (opp.placeholder) {
    main.innerHTML = renderPlaceholder(opp);
    return;
  }

  switch (state.tab) {
    case "summary":     main.innerHTML = renderSummary(opp); break;
    case "hypothesis":  main.innerHTML = renderHypothesis(opp); break;
    case "pnl":         main.innerHTML = renderPnL(opp); break;
    case "investors":   main.innerHTML = renderInvestors(opp); break;
  }

  // Keep the global scenario picker in sync with current state
  const globalScenario = document.getElementById("global-scenario-select");
  if (globalScenario && globalScenario.value !== state.scenario) {
    globalScenario.value = state.scenario;
  }

  // Wire up expand/collapse on cost rows
  document.querySelectorAll(".expandable").forEach(row => {
    row.addEventListener("click", () => {
      const key = row.dataset.toggle;
      state.expanded[key] = !state.expanded[key];
      renderTab();
    });
  });

  // Wire up % visualization style toggle (only present on P&L tab)
  document.querySelectorAll(".pct-style-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.pctStyle = btn.dataset.pctStyle;
      renderTab();
    });
  });
}

// ===== Bootstrap =====
function init() {
  const oppKeys = window.OPPORTUNITY_ORDER && window.OPPORTUNITY_ORDER.length
    ? window.OPPORTUNITY_ORDER
    : Object.keys(window.OPPORTUNITIES);

  // Initialize from URL hash if present; otherwise defaults.
  const hashed = readHash();
  state.oppKey   = (hashed.opp && window.OPPORTUNITIES[hashed.opp]) ? hashed.opp : oppKeys[0];
  state.tab      = ["summary", "hypothesis", "pnl", "investors"].includes(hashed.tab) ? hashed.tab : "summary";
  state.scenario = ["worst", "base", "best"].includes(hashed.scenario) ? hashed.scenario : "base";
  state.pctStyle = PCT_STYLES.includes(hashed.pct) ? hashed.pct : "bars";

  // Opportunity dropdown
  const select = document.getElementById("opportunity-select");
  select.innerHTML = oppKeys.map(k =>
    `<option value="${k}" ${k === state.oppKey ? "selected" : ""}>${window.OPPORTUNITIES[k].name}</option>`
  ).join("");
  select.addEventListener("change", (e) => {
    state.oppKey = e.target.value;
    state.expanded = { land: false, hard: false, soft: false };
    renderTab();
  });

  // Tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      renderTab();
    });
  });

  // Global scenario picker (wired once; persists across tab changes)
  const globalScenario = document.getElementById("global-scenario-select");
  globalScenario.value = state.scenario;
  globalScenario.addEventListener("change", (e) => {
    state.scenario = e.target.value;
    renderTab();
  });

  // React to back/forward navigation (hash changes externally)
  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h.opp && window.OPPORTUNITIES[h.opp])          state.oppKey   = h.opp;
    if (["summary","hypothesis","pnl","investors"].includes(h.tab))  state.tab = h.tab;
    if (["worst","base","best"].includes(h.scenario))  state.scenario = h.scenario;
    // Keep the dropdown in sync
    if (select.value !== state.oppKey) select.value = state.oppKey;
    renderTab();
  });

  renderTab();
}

document.addEventListener("DOMContentLoaded", init);
