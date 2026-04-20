// Calculation engine + UI rendering for the investment model.

// ===== Formatting =====
const fmtEUR = (n) => (n == null || isNaN(n)) ? "—" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtEUR2 = (n) => (n == null || isNaN(n)) ? "—" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n, d = 1) => (n == null || isNaN(n)) ? "—" : `${(n * 100).toFixed(d)}%`;
const fmtNum = (n, d = 2) => (n == null || isNaN(n)) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d });

// ===== IRR =====
// Closed-form annualized IRR for a single lump-sum return after `months` months:
//   (1 + r)^(months/12) = equityReturn / equityInvested
// => r = (multiple)^(12/months) - 1
function irrLumpSum(equityInvested, equityReturn, months) {
  if (!equityInvested || equityInvested <= 0 || !months || months <= 0) return null;
  const multiple = equityReturn / equityInvested;
  if (multiple <= 0) return -1;
  return Math.pow(multiple, 12 / months) - 1;
}

// ===== Core engine =====
function compute(opp, scenarioKey) {
  const s = opp.scenarios[scenarioKey];
  const builtTotal = opp.builtAbove + opp.builtBelow + opp.terraces;
  const edificableTotal = opp.plotSize * opp.edificabilityRatio;

  // Sale stages
  const priceIV = s.salePricePerSqm;
  const priceIII = priceIV + opp.saleStageDeltas.III;
  const priceII = priceIV + opp.saleStageDeltas.II;
  const priceI = priceIV + opp.saleStageDeltas.I;

  const revenueIV = priceIV * builtTotal;
  const revenueIII = priceIII * builtTotal;
  const revenueII = priceII * builtTotal;
  const revenueI = priceI * builtTotal;

  // Land
  const itp = opp.landPrice * opp.itpRate;
  const landSalesComm = opp.landPrice * opp.landSalesCommissionRate;
  const landTotal = opp.landPrice + itp + opp.notary + landSalesComm;
  const setupCost = landTotal * opp.setupRate;

  // Construction
  const pem = s.pemPerSqm * builtTotal;
  const pec = pem * opp.pecRate;
  const otherCosts = (pem + pec) * opp.otherCostsRate;
  const construction = pem + pec + otherCosts;
  const contingencies = construction * opp.contingenciesRate;

  // Soft
  const architecture = construction * opp.architectureRate;
  const aparejador = construction * opp.aparejadorRate;
  const licence = construction * opp.licenceRate;
  const softCost = architecture + aparejador + licence + opp.projectManagementCost;

  const totalCosts = landTotal + setupCost + opp.urbanizationCost + construction + contingencies + softCost;

  // Per-stage gross profit (vs total costs, before commercialization/financing/tax)
  const gross = {
    I:   { revenue: revenueI,   profit: revenueI   - totalCosts, margin: (revenueI   - totalCosts) / revenueI   },
    II:  { revenue: revenueII,  profit: revenueII  - totalCosts, margin: (revenueII  - totalCosts) / revenueII  },
    III: { revenue: revenueIII, profit: revenueIII - totalCosts, margin: (revenueIII - totalCosts) / revenueIII },
    IV:  { revenue: revenueIV,  profit: revenueIV  - totalCosts, margin: (revenueIV  - totalCosts) / revenueIV  },
  };

  // P&L based on stage IV
  const revenue = revenueIV;
  const ebitda = revenue - totalCosts;
  const commercialization = revenue * opp.commercializationRate;
  const ebit = ebitda - commercialization;
  const financing = totalCosts * opp.financingRate;
  const ebt = ebit - financing;
  const tax = ebt * opp.taxRate;
  const eat = ebt - tax;

  // Equity & returns
  const equityInvested = landTotal + setupCost + opp.urbanizationCost + contingencies + softCost;
  const netProfit = eat;
  const roe = netProfit / equityInvested;
  const rentabilidad = netProfit / totalCosts;  // margin post taxes on cost base
  const equityReturn = equityInvested + netProfit;

  const durationMonths = opp.projectDurationMonths;
  const irrBase = irrLumpSum(equityInvested, equityReturn, durationMonths);
  const irrDelayed = irrLumpSum(equityInvested, equityReturn, durationMonths + 12);
  const irrDelayed24 = irrLumpSum(equityInvested, equityReturn, durationMonths + 24);

  return {
    builtTotal, edificableTotal,
    prices: { I: priceI, II: priceII, III: priceIII, IV: priceIV },
    revenues: { I: revenueI, II: revenueII, III: revenueIII, IV: revenueIV },
    costs: {
      landPrice: opp.landPrice, itp, notary: opp.notary, landSalesComm,
      landTotal, setupCost, urbanization: opp.urbanizationCost,
      pem, pec, otherCosts, construction, contingencies,
      architecture, aparejador, licence, projectManagement: opp.projectManagementCost,
      softCost, totalCosts,
    },
    gross,
    pnl: {
      revenue, totalCosts, ebitda,
      commercialization, ebit,
      financing, ebt,
      tax, eat,
    },
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
  scenario: "base",   // for P&L tab
  tab: "summary",
};

// ===== Rendering helpers =====
function row(label, value, opts = {}) {
  const cls = opts.className || "";
  const subClass = opts.subLabel ? " sub" : "";
  return `<tr class="${cls}${subClass}"><td>${label}</td><td class="num">${value}</td></tr>`;
}

function sectionHeader(label) {
  return `<tr class="section"><td colspan="99">${label}</td></tr>`;
}

// ===== Tab: Summary =====
function renderSummary(opp) {
  const scenarios = ["worst", "base", "best"];
  const results = Object.fromEntries(scenarios.map(s => [s, compute(opp, s)]));

  const kpis = [
    { key: "revenue",        label: "Revenue",                         get: r => fmtEUR(r.pnl.revenue) },
    { key: "costs",          label: "Costs",                           get: r => fmtEUR(r.pnl.totalCosts) },
    { key: "benefits",       label: "Benefits (EAT)",                  get: r => fmtEUR(r.pnl.eat), highlight: true },
    { key: "rentabilidad",   label: "Rentabilidad %",                  get: r => fmtPct(r.returns.rentabilidad) },
    { key: "irrBase",        label: r => `Net IRR (${r.returns.durationMonths} mo)`, get: r => fmtPct(r.returns.irrBase), highlight: true },
    { key: "irrDelayed",     label: r => `Net IRR (${r.returns.durationMonths + 12} mo, 12-mo delay)`, get: r => fmtPct(r.returns.irrDelayed) },
    { key: "roe",            label: "ROE",                             get: r => fmtPct(r.returns.roe), highlight: true },
  ];

  const scenLabel = { worst: "Worst", base: "Base", best: "Best" };

  let html = `
    <div class="summary-head">
      <div>
        <h2>${opp.name} ${statusBadgeHTML(opp)}</h2>
        <div class="muted">${opp.address || "Address TBD"}</div>
      </div>
    </div>
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
function renderHypothesis(opp) {
  const builtTotal = opp.builtAbove + opp.builtBelow + opp.terraces;
  const edificable = opp.plotSize * opp.edificabilityRatio;

  let html = `
    <h2>Hypothesis — ${opp.name} ${statusBadgeHTML(opp)}</h2>
    <p class="muted">Inputs are edited in <code>data/${state.oppKey}.js</code> via Claude Code. This view is read-only.</p>

    <div class="two-col">
      <div class="col">
        <h3>Property</h3>
        <table class="kv">
          ${row("Typology", opp.typology)}
          ${row("Plot size", `${fmtNum(opp.plotSize)} m²`)}
          ${row("Edificability ratio", fmtPct(opp.edificabilityRatio, 0))}
          ${row("Edificable total", `${fmtNum(edificable)} m²`, { className: "derived" })}
          ${row("Built above rasante", `${fmtNum(opp.builtAbove)} m²`)}
          ${row("Built below rasante", `${fmtNum(opp.builtBelow)} m²`)}
          ${row("Terraces", `${fmtNum(opp.terraces)} m²`)}
          ${row("Built total", `${fmtNum(builtTotal)} m²`, { className: "derived" })}
          ${row("Exterior garden", `${fmtNum(opp.exteriorGarden)} m²`)}
        </table>

        <h3>Land acquisition</h3>
        <table class="kv">
          ${row("Land asking price", fmtEUR(opp.landPrice))}
          ${row("ITP rate", fmtPct(opp.itpRate, 0))}
          ${row("Notary & registro", fmtEUR(opp.notary))}
          ${row("Sales commission (land)", fmtPct(opp.landSalesCommissionRate, 1))}
        </table>

        <h3>P&L rates</h3>
        <table class="kv">
          ${row("Setup costs (% of land)", fmtPct(opp.setupRate, 0))}
          ${row("Commercialization (% of revenue)", fmtPct(opp.commercializationRate, 0))}
          ${row("Financing (% of total costs)", fmtPct(opp.financingRate, 0))}
          ${row("IS / tax rate", fmtPct(opp.taxRate, 0))}
        </table>

        <h3>Timing</h3>
        <table class="kv">
          ${row("Project duration", `${opp.projectDurationMonths} months`)}
          ${row("12-month delay scenario", `${opp.projectDurationMonths + 12} months`, { className: "derived" })}
        </table>
      </div>

      <div class="col">
        <h3>Construction rates</h3>
        <table class="kv">
          ${row("PEC (% of PEM)", fmtPct(opp.pecRate, 0))}
          ${row("Other costs (% of PEM+PEC)", fmtPct(opp.otherCostsRate, 0))}
          ${row("Contingencies (% of construction)", fmtPct(opp.contingenciesRate, 0))}
        </table>

        <h3>Soft costs</h3>
        <table class="kv">
          ${row("Architecture (% of construction)", fmtPct(opp.architectureRate, 0))}
          ${row("Aparejador (% of construction)", fmtPct(opp.aparejadorRate, 1))}
          ${row("Licence & others (% of construction)", fmtPct(opp.licenceRate, 0))}
          ${row("Project management (absolute)", fmtEUR(opp.projectManagementCost))}
        </table>

        <h3>Scenario KPIs</h3>
        <table class="kv">
          <thead>
            <tr><th>Scenario</th><th class="num">Sale €/sqm</th><th class="num">PEM €/sqm</th></tr>
          </thead>
          <tbody>
            ${["worst", "base", "best"].map(s => `
              <tr>
                <td class="scen-${s}">${s[0].toUpperCase()}${s.slice(1)} case</td>
                <td class="num">${fmtEUR(opp.scenarios[s].salePricePerSqm)}</td>
                <td class="num">${fmtEUR(opp.scenarios[s].pemPerSqm)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <h3>Cap table (inputs)</h3>
        <table class="kv">
          <thead>
            <tr><th>Investor</th><th class="num">Equity</th><th class="num">Profit share</th></tr>
          </thead>
          <tbody>
            ${opp.investors.map(i => `
              <tr>
                <td>${i.name}</td>
                <td class="num">${i.equity == null ? "<span class='muted'>derived</span>" : fmtEUR(i.equity)}</td>
                <td class="num">${fmtPct(i.profitShare, 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return html;
}

// ===== Tab: P&L =====
function renderPnL(opp) {
  const r = compute(opp, state.scenario);
  const rev = r.pnl.revenue;
  const pct = (n) => fmtPct(n / rev);

  let html = `
    <div class="pnl-head">
      <h2>P&L — ${opp.name} ${statusBadgeHTML(opp)}</h2>
      <div class="scenario-picker">
        <label for="scenario-select">Scenario:</label>
        <select id="scenario-select">
          <option value="worst" ${state.scenario === "worst" ? "selected" : ""}>Worst case</option>
          <option value="base"  ${state.scenario === "base"  ? "selected" : ""}>Base case</option>
          <option value="best"  ${state.scenario === "best"  ? "selected" : ""}>Best case</option>
        </select>
      </div>
    </div>

    <table class="pnl">
      <thead>
        <tr><th></th><th class="num">€</th><th class="num">% of revenue</th></tr>
      </thead>
      <tbody>
        ${sectionHeader("Revenue")}
        ${row("I. Villa sale (without licence)",   fmtEUR(r.revenues.I), { subLabel: true })}
        ${row("II. Villa sale (with licence)",     fmtEUR(r.revenues.II), { subLabel: true })}
        ${row("III. Villa sale (construction started)", fmtEUR(r.revenues.III), { subLabel: true })}
        ${row("IV. Villa sale (construction finalized)", fmtEUR(r.revenues.IV), { subLabel: true, className: "hl" })}

        ${sectionHeader("Costs")}
        ${row("Land (incl. ITP, notary, commission)", `<span class="num">${fmtEUR(r.costs.landTotal)}</span><span class="pct">${pct(r.costs.landTotal)}</span>`)}
        ${row("Setup costs",                           `<span class="num">${fmtEUR(r.costs.setupCost)}</span><span class="pct">${pct(r.costs.setupCost)}</span>`)}
        ${row("Construction (PEM + PEC + other)",      `<span class="num">${fmtEUR(r.costs.construction)}</span><span class="pct">${pct(r.costs.construction)}</span>`)}
        ${row("Contingencies",                         `<span class="num">${fmtEUR(r.costs.contingencies)}</span><span class="pct">${pct(r.costs.contingencies)}</span>`)}
        ${row("Soft costs (architecture, PM, etc.)",   `<span class="num">${fmtEUR(r.costs.softCost)}</span><span class="pct">${pct(r.costs.softCost)}</span>`)}
        <tr class="total"><td>Total costs</td><td class="num">${fmtEUR(r.pnl.totalCosts)}</td><td class="num">${pct(r.pnl.totalCosts)}</td></tr>

        <tr class="pnl-line"><td>EBITDA</td><td class="num">${fmtEUR(r.pnl.ebitda)}</td><td class="num">${pct(r.pnl.ebitda)}</td></tr>
        ${row("Commercialization costs", `<span class="num">${fmtEUR(r.pnl.commercialization)}</span><span class="pct">${pct(r.pnl.commercialization)}</span>`, { subLabel: true })}
        <tr class="pnl-line"><td>EBIT</td><td class="num">${fmtEUR(r.pnl.ebit)}</td><td class="num">${pct(r.pnl.ebit)}</td></tr>
        ${row("Financing costs", `<span class="num">${fmtEUR(r.pnl.financing)}</span><span class="pct">${pct(r.pnl.financing)}</span>`, { subLabel: true })}
        <tr class="pnl-line"><td>EBT</td><td class="num">${fmtEUR(r.pnl.ebt)}</td><td class="num">${pct(r.pnl.ebt)}</td></tr>
        ${row("Taxes (IS)", `<span class="num">${fmtEUR(r.pnl.tax)}</span><span class="pct">${pct(r.pnl.tax)}</span>`, { subLabel: true })}
        <tr class="pnl-line hl"><td>EAT (Net profit)</td><td class="num">${fmtEUR(r.pnl.eat)}</td><td class="num">${pct(r.pnl.eat)}</td></tr>
      </tbody>
    </table>

    <div class="gross-profit">
      <h3>Gross profit by sale stage</h3>
      <table class="kv">
        <thead>
          <tr><th>Stage</th><th class="num">Revenue</th><th class="num">Gross profit</th><th class="num">Margin</th></tr>
        </thead>
        <tbody>
          ${["I", "II", "III", "IV"].map(st => `
            <tr${st === "IV" ? " class='hl'" : ""}>
              <td>${st}. ${["without licence", "with licence", "construction started", "construction finalized"][["I", "II", "III", "IV"].indexOf(st)]}</td>
              <td class="num">${fmtEUR(r.gross[st].revenue)}</td>
              <td class="num">${fmtEUR(r.gross[st].profit)}</td>
              <td class="num">${fmtPct(r.gross[st].margin)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  return html;
}

// ===== Tab: Investors =====
function renderInvestors(opp) {
  const r = compute(opp, state.scenario);
  const eq = r.returns.equityInvested;

  // Compute per-investor equity: derive Kakarot equity to fill the gap.
  const namedEquity = opp.investors.reduce((sum, i) => sum + (i.equity || 0), 0);
  const investors = opp.investors.map(i => ({
    ...i,
    computedEquity: i.equity == null ? eq - namedEquity : i.equity,
  }));

  let html = `
    <div class="pnl-head">
      <h2>Investors — ${opp.name} ${statusBadgeHTML(opp)}</h2>
      <div class="scenario-picker">
        <label for="scenario-select-inv">Scenario:</label>
        <select id="scenario-select-inv">
          <option value="worst" ${state.scenario === "worst" ? "selected" : ""}>Worst case</option>
          <option value="base"  ${state.scenario === "base"  ? "selected" : ""}>Base case</option>
          <option value="best"  ${state.scenario === "best"  ? "selected" : ""}>Best case</option>
        </select>
      </div>
    </div>

    <h3>ROE analysis</h3>
    <table class="kv">
      <tbody>
        ${row("Equity invested",                    fmtEUR(r.returns.equityInvested))}
        ${row("Net profit (EAT, for distribution)", fmtEUR(r.returns.netProfit))}
        ${row("ROE",                                `<strong>${fmtPct(r.returns.roe)}</strong>`)}
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
              <td class="num">${fmtPct(i.profitShare, 0)}</td>
              <td class="num">${fmtEUR(profit)}</td>
              <td class="num">${multiple == null ? "—" : multiple.toFixed(2) + "×"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
  return html;
}

// ===== Tab dispatch =====
function renderTab() {
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

  // Wire up scenario pickers on P&L / Investors tabs
  const picker = document.getElementById("scenario-select") || document.getElementById("scenario-select-inv");
  if (picker) {
    picker.addEventListener("change", (e) => {
      state.scenario = e.target.value;
      renderTab();
    });
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

// ===== Bootstrap =====
function init() {
  // Use explicit order if available, else fall back to insertion order.
  const oppKeys = window.OPPORTUNITY_ORDER && window.OPPORTUNITY_ORDER.length
    ? window.OPPORTUNITY_ORDER
    : Object.keys(window.OPPORTUNITIES);
  state.oppKey = oppKeys[0];

  // Opportunity dropdown
  const select = document.getElementById("opportunity-select");
  select.innerHTML = oppKeys.map(k =>
    `<option value="${k}">${window.OPPORTUNITIES[k].name}</option>`
  ).join("");
  select.addEventListener("change", (e) => {
    state.oppKey = e.target.value;
    renderTab();
  });

  // Tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderTab();
    });
  });

  renderTab();
}

document.addEventListener("DOMContentLoaded", init);
