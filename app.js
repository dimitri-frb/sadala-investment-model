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

// Newton-Raphson IRR for arbitrary cashflow series (year 0, 1, 2, ...).
// Returns null when the cashflow has no sign change (no IRR exists) or fails to converge.
function irrNewton(cashflows, guess = 0.10) {
  if (!cashflows || cashflows.length < 2) return null;
  // Need at least one positive and one negative flow; otherwise no IRR exists.
  const hasPos = cashflows.some(x => x > 0);
  const hasNeg = cashflows.some(x => x < 0);
  if (!hasPos || !hasNeg) return null;

  let r = guess;
  for (let i = 0; i < 200; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const d = Math.pow(1 + r, t);
      npv += cashflows[t] / d;
      if (t > 0) dnpv += -t * cashflows[t] / (d * (1 + r));
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const delta = npv / dnpv;
    r -= delta;
    if (!isFinite(r) || r < -0.999) return null;
    if (Math.abs(delta) < 1e-10) return r;
  }
  return null;
}

// French-amortization mortgage payment (monthly).
function mortgagePayment(principal, annualRate, termYears) {
  const r = annualRate / 12;
  const n = termYears * 12;
  if (r === 0) return principal / n;
  return principal * r / (1 - Math.pow(1 + r, -n));
}

// Build month-by-month amortization schedule, return per-year aggregates
// [{ year, interest, principal, endingBalance }].
function amortizationByYear(principal, annualRate, termYears, holdYears) {
  const r = annualRate / 12;
  const monthly = mortgagePayment(principal, annualRate, termYears);
  let balance = principal;
  const years = [];
  for (let y = 1; y <= holdYears; y++) {
    let yInterest = 0, yPrincipal = 0;
    for (let m = 0; m < 12; m++) {
      const i = balance * r;
      const p = Math.min(monthly - i, balance);
      yInterest += i;
      yPrincipal += p;
      balance -= p;
      if (balance < 0) balance = 0;
    }
    years.push({ year: y, interest: yInterest, principal: yPrincipal, endingBalance: balance });
  }
  return { years, monthly, annual: monthly * 12 };
}

// ===== Core engine: dispatcher =====
function compute(opp, scenarioKey) {
  if (opp.projectType === "rental") return computeRental(opp, scenarioKey);
  return computeDevelopment(opp, scenarioKey);
}

// ===== Rental engine =====
// Acquire + renovate + rent for `holdYears` + exit at residual value.
function computeRental(opp, scenarioKey) {
  const s = opp.scenarios[scenarioKey] || {};
  const A = opp.acquisition;
  const R = opp.renovation;
  const F = opp.financing;
  const RT = opp.rental;

  // --- Acquisition costs (paid by Sadala if not bank-financed) ---
  const itp = A.purchasePrice * (A.landTaxRate || 0);
  const notary = A.notary != null ? A.notary : A.purchasePrice * (A.notaryRate || 0);
  const agency = A.purchasePrice * (A.agencyCommissionRate || 0);
  const acquisitionCosts = itp + notary + agency;

  // --- Renovation cost ---
  // Construction part (= bank-financeable). Furnishing is separate and paid
  // by equity (Spanish banks don't typically finance free-standing furniture).
  const renovationBase = R.costPerSqm * opp.property.totalSqm;
  const renovationContingencies = renovationBase * (R.contingenciesRate || 0);
  const renovationConstruction = renovationBase + renovationContingencies;
  const furnishingCost = R.furnishingCost || 0;
  const renovationTotal = renovationConstruction + furnishingCost;

  // --- Total project cost ---
  const totalCost = A.purchasePrice + acquisitionCosts + renovationTotal;

  // --- Bank loan ---
  // Loan can be specified as either:
  //   - F.ltcRate: % of (purchase + reno construction), excluding notary, furnishing & other costs
  //   - F.bankCoversAcquisition / F.bankCoversRenovation booleans (legacy)
  let loanAmount;
  if (F.ltcRate != null) {
    loanAmount = (A.purchasePrice + renovationConstruction) * F.ltcRate;
  } else {
    loanAmount = (F.bankCoversAcquisition ? A.purchasePrice : 0)
               + (F.bankCoversRenovation ? renovationConstruction : 0);
  }
  const equityRequired = totalCost - loanAmount;

  // --- Amortization ---
  const amort = amortizationByYear(loanAmount, F.interestRate, F.termYears, RT.holdYears);

  // --- Yearly cash flows ---
  const baseAnnualRent = opp.property.units.reduce((sum, u) => sum + u.monthlyRent * 12, 0);
  const adjustedBaseRent = baseAnnualRent * (s.rentMultiplier || 1);

  const cashFlows = [];
  for (let y = 1; y <= RT.holdYears; y++) {
    const inflation = Math.pow(1 + (RT.inflationRate || 0), y - 1);
    const tenantRent = adjustedBaseRent * inflation;
    const otherIncome = tenantRent * (RT.otherIncomeRate || 0);
    const grossPotential = tenantRent + otherIncome;        // PGI = rent + other income
    const baseVacancy = RT.vacancySchedule[y - 1] != null
      ? RT.vacancySchedule[y - 1]
      : RT.vacancySchedule[RT.vacancySchedule.length - 1];
    const vacancy = Math.max(0, Math.min(1, baseVacancy + (s.vacancyAdjust || 0)));
    const vacancyLoss = grossPotential * vacancy;
    const effectiveGross = grossPotential - vacancyLoss;    // EGI

    // OpEx and CapEx are computed on POTENTIAL gross income (PGI), not EGI —
    // operating costs don't disappear when a unit is vacant.
    // OpEx keys are data-driven: whatever's in `RT.operatingExpenses` gets included.
    // CapEx is a top-level capexRate (or operatingExpenses.capex for legacy).
    const opex = {};
    let totalOpEx = 0;
    for (const [key, rate] of Object.entries(RT.operatingExpenses || {})) {
      if (key === "capex") continue;  // legacy: capex used to live here
      const v = grossPotential * (rate || 0);
      opex[key] = v;
      totalOpEx += v;
    }
    const noi = effectiveGross - totalOpEx;
    const capexRate = RT.capexRate != null ? RT.capexRate : (RT.operatingExpenses?.capex || 0);
    const capex = grossPotential * capexRate;
    const cashFlowOps = noi - capex;

    const a = amort.years[y - 1];
    const debtService = a.interest + a.principal;
    const cashFlowAfterDebt = cashFlowOps - debtService;

    cashFlows.push({
      year: y,
      grossPotential, vacancy, vacancyLoss, effectiveGross,
      opex, totalOpEx, noi, capex, cashFlowOps,
      interest: a.interest, principal: a.principal, debtService,
      outstandingDebt: a.endingBalance,
      cashFlowAfterDebt,
    });
  }

  // --- Residual value at exit ---
  // Two methods, we use cap rate (NOI / cap rate) as the standard income approach.
  const finalCF = cashFlows[cashFlows.length - 1];
  const exitYearNOI = finalCF.noi * (1 + (RT.inflationRate || 0));  // Year holdYears+1 NOI
  const residualValueCapRate = exitYearNOI / RT.exitCapRate;

  // Capital growth approach (used by the source screenshot)
  const residualValueGrowth = A.purchasePrice
    * Math.pow(1 + (RT.capitalGrowthRate || 0), RT.holdYears);

  const residualValue = residualValueCapRate;  // primary
  const saleCommission = residualValue * (RT.saleCommissionRate || 0);
  const saleProceeds = residualValue - saleCommission;
  const remainingDebt = finalCF.outstandingDebt;
  const netToEquityAtExit = saleProceeds - remainingDebt;

  // --- IRR (unlevered: as if all-cash; levered: actual equity flows) ---
  const unleveredCF = [-totalCost, ...cashFlows.map(c => c.cashFlowOps)];
  unleveredCF[unleveredCF.length - 1] += saleProceeds;
  const unleveredIRR = irrNewton(unleveredCF);

  const leveredCF = [-equityRequired, ...cashFlows.map(c => c.cashFlowAfterDebt)];
  leveredCF[leveredCF.length - 1] += netToEquityAtExit;
  const leveredIRR = irrNewton(leveredCF);

  // --- Cash on cash multiples ---
  const equityIn = -unleveredCF.filter(x => x < 0).reduce((a, b) => a + b, 0);
  const equityOut = unleveredCF.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const unleveredMOIC = equityIn ? equityOut / equityIn : null;

  const levEquityIn = -leveredCF.filter(x => x < 0).reduce((a, b) => a + b, 0);
  const levEquityOut = leveredCF.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const leveredMOIC = levEquityIn ? levEquityOut / levEquityIn : null;

  // --- Year-1 yields ---
  const year1NOI = cashFlows[0].noi;
  const grossYield = baseAnnualRent / totalCost;
  const netYield = year1NOI / totalCost;

  // --- "Net profit" for ROE display = sum of equity returns - equity in (over hold) ---
  const totalLeveredCashOut = leveredCF.reduce((a, b) => a + b, 0);  // sum of all flows (negative + positive)

  return {
    type: "rental",
    acquisitionCosts: { itp, notary, agency, total: acquisitionCosts },
    renovation: { base: renovationBase, contingencies: renovationContingencies, furnishing: furnishingCost, construction: renovationConstruction, total: renovationTotal },
    totals: { totalCost, loanAmount, equityRequired },
    debt: { monthlyPayment: amort.monthly, annualDebtService: amort.annual, schedule: amort.years },
    cashFlows,
    exit: {
      finalNOI: finalCF.noi,
      exitYearNOI,
      residualValueCapRate, residualValueGrowth, residualValue,
      saleCommission, saleProceeds, remainingDebt, netToEquityAtExit,
    },
    yields: { gross: grossYield, net: netYield, year1NOI },
    irr: { unlevered: unleveredIRR, levered: leveredIRR },
    moic: { unlevered: unleveredMOIC, levered: leveredMOIC },
    cashflows: { unlevered: unleveredCF, levered: leveredCF },
    summary: {
      totalNetEquityReturn: totalLeveredCashOut,  // sum across all years (including initial)
    },
  };
}

// ===== Development engine (existing) =====
function computeDevelopment(opp, scenarioKey) {
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
  // `otherCostsBase` defaults to "PEM" but can be "PEM_PLUS_PEC" (source models differ).
  const H = opp.hardCosts;
  const pem = s.pemPerSqm * builtTotal;
  const pec = pem * H.pecRate;
  const otherBase = H.otherCostsBase === "PEM_PLUS_PEC" ? (pem + pec) : pem;
  const otherCosts = otherBase * H.otherCostsRate;
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
  // VAT paid on land acquisition is recovered at exit (Spanish IVA regime).
  // ITP (impuesto de transmisiones) is NOT recoverable, so it stays as a cost.
  const vatRefund = A.landTaxRegime === "VAT" ? landTax : 0;
  const eat = ebt - tax + vatRefund;

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
    pnl: { revenue, totalCosts, ebitda, commercialization, ebit, financing, ebt, tax, vatRefund, eat },
    returns: {
      equityInvested, netProfit, roe, rentabilidad,
      equityReturn, durationMonths,
      irrBase, irrDelayed, irrDelayed24,
    },
    phasedCashflow: buildDevPhasedCashflow({
      acquisitionTotal,
      setupCost,
      softCost,
      contingencies,
      equityInvested,
      netProfit,
      durationMonths,
    }),
  };
}

// Build a year-by-year cashflow for development projects (more realistic than
// a single Y0 outflow). Splits equity into:
//   Y0: acquisition + setup (paid at signing)
//   Y1..Y(N-1): soft costs + contingencies, spread evenly
//   Y_exit (= N): equity + profit returned
// Also computes the 12-month delay variant.
function buildDevPhasedCashflow({ acquisitionTotal, setupCost, softCost, contingencies, equityInvested, netProfit, durationMonths }) {
  const projectYears = Math.max(1, Math.round(durationMonths / 12));
  const remaining = softCost + contingencies;
  const constructionYears = Math.max(1, projectYears - 1);
  const yearlyRemaining = remaining / constructionYears;

  const yearsArr = [];
  for (let y = 0; y <= projectYears + 1; y++) {
    let outflow = 0;
    let inflowBase = 0;
    let inflowDelayed = 0;
    if (y === 0) outflow = acquisitionTotal + setupCost;
    else if (y < projectYears) outflow = yearlyRemaining;
    if (y === projectYears) inflowBase = equityInvested + netProfit;
    if (y === projectYears + 1) inflowDelayed = equityInvested + netProfit;
    yearsArr.push({ year: y, outflow, inflowBase, inflowDelayed });
  }

  // Cumulative
  let cumBase = 0, cumDelayed = 0;
  yearsArr.forEach(c => {
    const netBase = c.inflowBase - c.outflow;
    const netDelayed = c.inflowDelayed - c.outflow;
    cumBase += netBase;
    cumDelayed += netDelayed;
    c.netBase = netBase;
    c.netDelayed = netDelayed;
    c.cumBase = cumBase;
    c.cumDelayed = cumDelayed;
  });

  // IRR from the phased cashflow (more accurate than the lump-sum IRR
  // because not all equity is locked up at Y0).
  const cfBase = yearsArr.map(c => c.netBase);
  const cfDelayed = yearsArr.map(c => c.netDelayed);
  const irrPhasedBase = irrNewton(cfBase);
  const irrPhasedDelayed = irrNewton(cfDelayed);

  return { yearsArr, projectYears, irrPhasedBase, irrPhasedDelayed };
}

// ===== State =====
const state = {
  oppKey: null,
  scenario: "base",
  tab: "summary",
  expanded: { land: false, hard: false, soft: false },
};

// ===== URL hash sync (so refresh + share keep the view) =====
// Hash format: #opp=<key>&tab=<tab>&scenario=<scenario>
function readHash() {
  const hash = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return {
    opp: params.get("opp"),
    tab: params.get("tab"),
    scenario: params.get("scenario"),
  };
}

function writeHash() {
  const params = new URLSearchParams();
  // Portfolio mode = no opp set. URL hash stays empty.
  if (state.tab !== "portfolio" && state.oppKey) {
    params.set("opp", state.oppKey);
    if (state.tab && state.tab !== "summary") params.set("tab", state.tab);
    if (state.scenario && state.scenario !== "base") params.set("scenario", state.scenario);
  }
  const qs = params.toString();
  const newHash = qs ? "#" + qs : "";
  if (location.hash.replace(/^#/, "") !== qs) {
    if (newHash) history.replaceState(null, "", newHash);
    else history.replaceState(null, "", location.pathname + location.search);
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
      <div class="timeline-head">
        <h3>Timeline</h3>
        ${statusBadgeHTML(opp)}
      </div>
      <div class="timeline">${inner}</div>
    </div>`;
}

// ===== Signed cash-flow cell (red bg if negative, green bg if positive) =====
function cfCell(value) {
  if (value == null || value === 0) return `<td class="num">—</td>`;
  const cls = value < 0 ? "cf-neg" : "cf-pos";
  const text = value < 0 ? `−${fmtEUR(-value)}` : `+${fmtEUR(value)}`;
  return `<td class="num ${cls}">${text}</td>`;
}

// ===== Per-row % visualization (cell background fill) =====
function pctCell(value, total) {
  const pct = total ? value / total : 0;
  const clamped = Math.min(Math.max(pct, 0), 1);
  const w = (clamped * 100).toFixed(1);
  return `<div class="pct-cell pctv-fill" style="background: linear-gradient(to right, var(--pct-color, #dbeafe) ${w}%, transparent ${w}%)"><span class="pct-num">${fmtPct(pct)}</span></div>`;
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
        <h2>${opp.name}</h2>
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
    <h2>Hypothesis — ${opp.name}</h2>
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

  const html = `
    <h2>P&L — ${opp.name} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

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
        ${r.pnl.vatRefund > 0 ? `
        <tr class="line-addition">
          <td><span class="triangle-spacer"></span> VAT recovery (${opp.acquisition.landTaxRegime} recuperated at exit)</td>
          <td class="num">+${fmtEUR(r.pnl.vatRefund)}</td>
          <td class="num pct-text-cell">${pctCell(r.pnl.vatRefund, rev)}</td>
        </tr>
        ` : ""}

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
    <h2>Investors — ${opp.name} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

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

    <p class="muted" style="margin-top: 16px;">
      For per-investor capital deployment timing, see the <strong>Cash flow</strong> tab.
    </p>
  `;
}

// ===================================================================
// ===== Rental project type — renderers =============================
// ===================================================================

// Human-readable labels for OpEx categories. Add to this map when new
// keys are introduced in opportunity data files.
const OPEX_LABELS = {
  marketing:         "Marketing",
  salaries:          "Salaries",
  maintenance:       "Maintenance & repairs",
  management:        "Management",
  ibiInsurance:      "IBI & insurance",
  utilities:         "Water, electricity, etc.",
  agency:            "Agency commission",
  rentalCommissions: "Rental commissions",
};
function opexLabel(key) {
  return OPEX_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}


function renderRentalSummary(opp) {
  const scenarios = ["worst", "base", "best"];
  const results = Object.fromEntries(scenarios.map(s => [s, compute(opp, s)]));
  const scenLabel = { worst: "Worst", base: "Base", best: "Best" };

  const kpis = [
    { label: "Total project cost",   get: r => fmtEUR(r.totals.totalCost) },
    { label: "Bank loan",            get: r => fmtEUR(r.totals.loanAmount) },
    { label: "Sadala equity",        get: r => fmtEUR(r.totals.equityRequired) },
    { label: "Year-1 NOI",           get: r => fmtEUR(r.yields.year1NOI) },
    { label: "Net yield (Y1)",       get: r => fmtPct(r.yields.net) },
    { label: "Unlevered IRR",        get: r => fmtPct(r.irr.unlevered), highlight: true },
    { label: "Levered IRR",          get: r => fmtPct(r.irr.levered),   highlight: true },
    { label: "Levered MOIC",         get: r => r.moic.levered ? r.moic.levered.toFixed(2) + "×" : "—", highlight: true },
    { label: "Residual value (Y" + opp.rental.holdYears + ")", get: r => fmtEUR(r.exit.residualValue) },
  ];

  let html = `
    <div class="summary-head">
      <div>
        <h2>${opp.name}</h2>
        <div class="muted">${opp.address || "Address TBD"}</div>
      </div>
    </div>
    ${renderTimeline(opp)}
    <h3>Scenarios</h3>
    <div class="scenario-grid">
  `;

  for (const scen of scenarios) {
    const r = results[scen];
    const note = (opp.scenarios[scen] || {}).note;
    const rentMult = (opp.scenarios[scen] || {}).rentMultiplier || 1;
    html += `
      <div class="scenario-card scen-${scen}">
        <div class="scen-head">
          <div class="scen-name">${scenLabel[scen]} case</div>
          <div class="scen-sub">Rents × ${rentMult}</div>
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

function renderRentalHypothesis(opp) {
  const A = opp.acquisition;
  const R = opp.renovation;
  const F = opp.financing;
  const RT = opp.rental;
  const P = opp.property;

  const totalRent = P.units.reduce((s, u) => s + u.monthlyRent, 0);
  const renovationBase = R.costPerSqm * P.totalSqm;
  const renovationConstruction = renovationBase * (1 + (R.contingenciesRate || 0));
  const loanForDisplay = F.ltcRate != null
    ? (A.purchasePrice + renovationConstruction) * F.ltcRate
    : ((F.bankCoversAcquisition ? A.purchasePrice : 0) + (F.bankCoversRenovation ? renovationConstruction : 0));
  const monthly = mortgagePayment(loanForDisplay, F.interestRate, F.termYears);

  return `
    <h2>Hypothesis — ${opp.name}</h2>
    <p class="muted">Inputs are edited in <code>data/${state.oppKey}.js</code> via Claude Code. This view is read-only.</p>

    <div class="two-col">
      <div class="col">
        <h3>Property</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Typology", P.typology)}
            ${hypRow("Total surface", `${fmtNum(P.totalSqm, 0)} m²`)}
            ${P.units.map(u => hypRow(`${u.name}`, `${fmtNum(u.sqm, 0)} m² · ${fmtEUR(u.monthlyRent)}/mo`, { sub: true })).join("")}
            ${hypRow("Total monthly rent", fmtEUR(totalRent), { derived: true })}
            ${hypRow("Total annual rent", fmtEUR(totalRent * 12), { derived: true })}
          </tbody>
        </table>

        <h3>Acquisition</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Purchase price", fmtEUR(A.purchasePrice))}
            ${hypRow(`${A.landTaxRegime} (% of purchase price)`, fmtPct(A.landTaxRate, 0))}
            ${hypRow("Notary",                                   A.notary != null ? fmtEUR(A.notary) : fmtPct(A.notaryRate, 1))}
            ${hypRow("Agency commission",                        fmtPct(A.agencyCommissionRate || 0, 1))}
          </tbody>
        </table>

        <h3>Renovation</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Cost per sqm",                             fmtEUR(R.costPerSqm))}
            ${hypRow("Total surface × cost",                     fmtEUR(R.costPerSqm * P.totalSqm), { derived: true })}
            ${hypRow(`Contingencies (${fmtPct(R.contingenciesRate, 0)})`, fmtEUR(R.costPerSqm * P.totalSqm * R.contingenciesRate), { derived: true })}
            ${R.furnishingCost ? hypRow("Furnishing (one-off, equity-funded)", fmtEUR(R.furnishingCost)) : ""}
            ${hypRow("Estimated duration",                       `${R.durationMonths} months`)}
          </tbody>
        </table>
      </div>

      <div class="col">
        <h3>Bank financing</h3>
        <table class="kv">
          <tbody>
            ${F.ltcRate != null
              ? hypRow("Loan-to-cost (% of acquisition + reno)", fmtPct(F.ltcRate, 0))
              : `${hypRow("Bank covers acquisition",  F.bankCoversAcquisition ? "Yes" : "No")}
                 ${hypRow("Bank covers renovation",   F.bankCoversRenovation  ? "Yes" : "No")}`}
            ${hypRow("Interest rate",                            fmtPct(F.interestRate, 2))}
            ${hypRow("Loan term",                                `${F.termYears} years`)}
            ${hypRow("Amortization",                             F.amortizationStyle === "french" ? "French (constant payment)" : F.amortizationStyle)}
            ${hypRow("Estimated monthly payment",                fmtEUR(monthly), { derived: true })}
          </tbody>
        </table>

        <h3>Rental operating assumptions</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Inflation on rents & opex",                fmtPct(RT.inflationRate, 1))}
            ${hypRow("Other income (% of rent, paid by tenant)", fmtPct(RT.otherIncomeRate || 0, 0))}
            ${hypRow("Hold period",                              `${RT.holdYears} years`)}
            ${hypRow("Vacancy schedule (Y1→Y" + RT.holdYears + ")", RT.vacancySchedule.slice(0, RT.holdYears).map(v => fmtPct(v, 0)).join(" · "))}
            ${Object.entries(RT.operatingExpenses || {})
              .filter(([k]) => k !== "capex")
              .map(([k, v]) => hypRow(`${opexLabel(k)} (% of PGI)`, fmtPct(v, 0)))
              .join("")}
            ${hypRow("CapEx reserve (% of PGI)",                 fmtPct(RT.capexRate != null ? RT.capexRate : (RT.operatingExpenses?.capex || 0), 0))}
          </tbody>
        </table>

        <h3>Exit assumptions</h3>
        <table class="kv">
          <tbody>
            ${hypRow("Capital growth (per year)",                fmtPct(RT.capitalGrowthRate, 1))}
            ${hypRow("Sale commission",                          fmtPct(RT.saleCommissionRate, 1))}
            ${hypRow("Exit cap rate",                            fmtPct(RT.exitCapRate, 2))}
          </tbody>
        </table>
      </div>
    </div>

    <h3>Scenario assumptions</h3>
    <table class="kv">
      <thead>
        <tr><th>Scenario</th><th class="num">Rent multiplier</th><th class="num">Vacancy adjust</th><th>Note</th></tr>
      </thead>
      <tbody>
        ${["worst", "base", "best"].map(s => {
          const sc = opp.scenarios[s] || {};
          const adj = sc.vacancyAdjust || 0;
          return `
            <tr>
              <td class="scen-${s}">${s[0].toUpperCase()}${s.slice(1)} case</td>
              <td class="num">×${(sc.rentMultiplier || 1).toFixed(2)}</td>
              <td class="num">${adj > 0 ? "+" : ""}${(adj * 100).toFixed(0)}%</td>
              <td class="muted">${sc.note || "—"}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderRentalCashFlow(opp) {
  const r = compute(opp, state.scenario);
  const years = r.cashFlows;
  const yearCols = years.map(c => c.year);

  const fmt = v => fmtEUR(v);
  const fmtNeg = v => v < 0 ? `−${fmtEUR(-v)}` : fmt(v);

  // Build table rows
  function row(label, getter, opts = {}) {
    const cls = opts.className || "";
    const cells = years.map(y => `<td class="num">${opts.fmt ? opts.fmt(getter(y)) : fmt(getter(y))}</td>`).join("");
    return `<tr class="${cls}"><td>${label}</td>${cells}</tr>`;
  }

  return `
    <h2>Cash flow — ${opp.name} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

    <div class="cashflow-summary">
      <div class="cf-summary-item">
        <div class="cf-summary-label">Total project cost</div>
        <div class="cf-summary-value">${fmtEUR(r.totals.totalCost)}</div>
      </div>
      <div class="cf-summary-item">
        <div class="cf-summary-label">Bank loan</div>
        <div class="cf-summary-value">${fmtEUR(r.totals.loanAmount)}</div>
      </div>
      <div class="cf-summary-item highlight">
        <div class="cf-summary-label">Sadala equity</div>
        <div class="cf-summary-value">${fmtEUR(r.totals.equityRequired)}</div>
      </div>
      <div class="cf-summary-item">
        <div class="cf-summary-label">Annual debt service</div>
        <div class="cf-summary-value">${fmtEUR(r.debt.annualDebtService)}</div>
      </div>
    </div>

    <h3>Operating cash flow</h3>
    <table class="pnl cashflow-table">
      <thead>
        <tr>
          <th></th>
          ${yearCols.map(y => `<th class="num">Year ${y}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        <tr class="section-header"><td colspan="${yearCols.length + 1}">Income</td></tr>
        ${row("Potential gross income", c => c.grossPotential)}
        <tr class="line-deduction">
          <td><span class="triangle-spacer"></span> Vacancy</td>
          ${years.map(c => `<td class="num">−${fmtEUR(c.vacancyLoss)} (${fmtPct(c.vacancy, 0)})</td>`).join("")}
        </tr>
        ${row("Effective gross income", c => c.effectiveGross, { className: "line-primary" })}

        <tr class="section-spacer"><td colspan="${yearCols.length + 1}"></td></tr>

        <tr class="section-header"><td colspan="${yearCols.length + 1}">Operating expenses</td></tr>
        ${(() => {
          // Render an OpEx row for each key actually present in the data
          // (in the order the user wrote them).
          const opexKeys = Object.keys(opp.rental.operatingExpenses || {}).filter(k => k !== "capex");
          return opexKeys.map(key => row(opexLabel(key), c => c.opex[key] || 0, { className: "line-deduction" })).join("");
        })()}
        ${row("Total operating expenses", c => c.totalOpEx, { className: "line-primary subtle" })}

        <tr class="section-spacer"><td colspan="${yearCols.length + 1}"></td></tr>

        <tr class="line-primary pos">
          <td>Net operating income (NOI)</td>
          ${years.map(c => `<td class="num">${fmtEUR(c.noi)}</td>`).join("")}
        </tr>
        ${row("CapEx reserve", c => c.capex, { className: "line-deduction" })}
        <tr class="line-primary pos">
          <td>Cash flow from operations</td>
          ${years.map(c => `<td class="num">${fmtEUR(c.cashFlowOps)}</td>`).join("")}
        </tr>

        <tr class="section-spacer"><td colspan="${yearCols.length + 1}"></td></tr>

        <tr class="section-header waterfall-header"><td colspan="${yearCols.length + 1}">Debt service</td></tr>
        ${row("Interest",       c => c.interest,  { className: "line-deduction" })}
        ${row("Principal",      c => c.principal, { className: "line-deduction" })}
        ${row("Outstanding debt (end of year)", c => c.outstandingDebt, { className: "line-deduction" })}

        <tr class="section-spacer"><td colspan="${yearCols.length + 1}"></td></tr>

        <tr class="line-primary cf-row">
          <td>Cash flow to equity (after debt)</td>
          ${years.map(c => cfCell(c.cashFlowAfterDebt)).join("")}
        </tr>
      </tbody>
    </table>

    <h3>Exit (Year ${opp.rental.holdYears})</h3>
    <table class="kv">
      <tbody>
        <tr><td>Residual value (NOI / cap rate)</td><td class="num">${fmtEUR(r.exit.residualValue)}</td></tr>
        <tr class="line-deduction"><td>Sale commission (${fmtPct(opp.rental.saleCommissionRate, 0)})</td><td class="num">−${fmtEUR(r.exit.saleCommission)}</td></tr>
        <tr><td>Sale proceeds</td><td class="num">${fmtEUR(r.exit.saleProceeds)}</td></tr>
        <tr class="line-deduction"><td>Remaining debt</td><td class="num">−${fmtEUR(r.exit.remainingDebt)}</td></tr>
        <tr class="hl"><td><strong>Net to equity at exit</strong></td><td class="num"><strong>${fmtEUR(r.exit.netToEquityAtExit)}</strong></td></tr>
      </tbody>
    </table>
  `;
}

function renderRentalInvestors(opp) {
  const r = compute(opp, state.scenario);
  const equity = r.totals.equityRequired;

  const namedEquity = opp.investors.reduce((s, i) => s + (i.equity || 0), 0);
  const investors = opp.investors.map(i => ({
    ...i,
    computedEquity: i.equity == null ? equity - namedEquity : i.equity,
  }));

  // Per-investor: their share of total levered cash flow over the hold + exit
  const totalLeveredOut = r.cashflows.levered.slice(1).reduce((a, b) => a + b, 0);  // exclude initial outflow
  const totalLeveredIn = -r.cashflows.levered[0];

  return `
    <h2>Investors — ${opp.name} <span class="scenario-tag scen-${state.scenario}">${state.scenario} case</span></h2>

    <h3>Equity & returns</h3>
    <table class="kv">
      <tbody>
        <tr><td>Equity invested (Year 0)</td><td class="num">${fmtEUR(totalLeveredIn)}</td></tr>
        <tr><td>Total cash flow during hold (Y1–Y${opp.rental.holdYears})</td><td class="num">${fmtEUR(r.cashflows.levered.slice(1, -1).reduce((a, b) => a + b, 0) + r.cashflows.levered[r.cashflows.levered.length - 1] - r.exit.netToEquityAtExit)}</td></tr>
        <tr><td>Net to equity at exit</td><td class="num">${fmtEUR(r.exit.netToEquityAtExit)}</td></tr>
        <tr class="hl"><td><strong>Total equity return</strong></td><td class="num"><strong>${fmtEUR(totalLeveredOut)}</strong></td></tr>
      </tbody>
    </table>

    <h3>IRR &amp; multiples</h3>
    <table class="kv">
      <thead>
        <tr><th></th><th class="num">Unlevered</th><th class="num">Levered</th></tr>
      </thead>
      <tbody>
        <tr class="hl"><td><strong>IRR</strong></td><td class="num"><strong>${fmtPct(r.irr.unlevered)}</strong></td><td class="num"><strong>${fmtPct(r.irr.levered)}</strong></td></tr>
        <tr><td>MOIC (Multiple on Invested Capital)</td><td class="num">${r.moic.unlevered ? r.moic.unlevered.toFixed(2) + "×" : "—"}</td><td class="num">${r.moic.levered ? r.moic.levered.toFixed(2) + "×" : "—"}</td></tr>
        <tr><td>Year-1 net yield</td><td class="num">${fmtPct(r.yields.net)}</td><td class="num">—</td></tr>
      </tbody>
    </table>

    <h3>Cap table</h3>
    <table class="kv">
      <thead>
        <tr><th>Investor</th><th class="num">Equity</th><th class="num">Profit share</th><th class="num">Estimated return</th></tr>
      </thead>
      <tbody>
        ${investors.map(i => {
          const myEquity = i.computedEquity;
          const myReturn = i.profitShare * (totalLeveredOut + totalLeveredIn);  // their share of profits (return - principal)
          // Better: their share of equity + their share of profits at exit
          const myProfit = (totalLeveredOut - totalLeveredIn) * i.profitShare;
          return `
            <tr>
              <td>${i.name}</td>
              <td class="num">${fmtEUR(myEquity)}</td>
              <td class="num">${fmtPct(i.profitShare, 1)}</td>
              <td class="num">${fmtEUR(myEquity + myProfit)}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>

    <p class="muted" style="margin-top: 16px;">Note: returns assume a single sponsor (Sadala SL) for now since equity at risk is small and bank covers acquisition + renovation. Update <code>investors</code> in <code>data/${state.oppKey}.js</code> to bring co-investors in.</p>
  `;
}

// ===================================================================
// ===== Bank Dossier (one-pager for financing requests) =============
// ===================================================================

function renderBankDossier(opp) {
  // Bank dossier shows sale prices uplifted by +10% across all 3 scenarios
  // (mid-market projection vs the internally-conservative baseline used in
  // Summary / P&L / Cash flow). Costs and structure unchanged — only the
  // top line moves, which mechanically lifts margin / ROE / IRR.
  const DOSSIER_UPLIFT = 1.10;
  const dossierOpp = {
    ...opp,
    scenarios: Object.fromEntries(
      Object.entries(opp.scenarios || {}).map(([k, s]) => [
        k, { ...s, salePricePerSqm: (s.salePricePerSqm || 0) * DOSSIER_UPLIFT }
      ])
    ),
  };
  const worst = compute(dossierOpp, "worst");
  const base  = compute(dossierOpp, "base");
  const best  = compute(dossierOpp, "best");

  const totalCost = base.totalCosts;
  const equityDeployed = base.returns.equityInvested;
  const constructionCost = base.hard.construction;
  // The "100% financing" ask = 100% of construction (= what equity hasn't already covered)
  const loanAsk = constructionCost;
  const ltcRatio = loanAsk / totalCost;
  const equityCoveragePct = equityDeployed / totalCost;

  const builtTotal = opp.property.sobreRasante + opp.property.bajoRasante + (opp.property.terrazas || 0);
  const today = new Date();
  const fmtToday = `${today.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;

  // Investor summary (from cap table)
  const investors = (opp.investors || []).filter(i => (i.equity || 0) > 0 || i.role === "sponsor");
  const namedEquity = (opp.investors || []).reduce((s, i) => s + (i.equity || 0), 0);
  const investorRows = investors.map(i => {
    const eq = i.equity != null ? i.equity : (equityDeployed - namedEquity);
    return { name: i.name, equity: eq, share: eq / equityDeployed };
  });

  // Timeline highlights (only milestones that are still future or current)
  const timeline = (opp.timeline || []).map(t => {
    const date = t.date || (t.offsetFrom ? "computed" : "");
    return { ...t, displayDate: date };
  });

  return `
    <div class="dossier">
      <div class="dossier-toolbar no-print">
        <button onclick="window.print()" class="btn-primary">📄 Print / Save as PDF</button>
        <span class="muted" style="margin-left: 12px;">Use Cmd+P → Save as PDF for a clean handout. Optimized for A4.</span>
      </div>

      <article class="dossier-page">
        <header class="dossier-header">
          <div class="dossier-brand">
            <img src="logo.png" alt="Sadala" class="dossier-logo" />
            <div>
              <div class="dossier-brand-name">Sadala</div>
              <div class="dossier-brand-tagline">Real Estate Development</div>
            </div>
          </div>
          <div class="dossier-title">
            <div class="dossier-doctype">Préstamo promotor — financing request</div>
            <h1>${opp.name}</h1>
            <div class="dossier-address">${opp.address || ""}</div>
            <div class="dossier-meta">${fmtToday}</div>
          </div>
        </header>

        <section class="dossier-ask">
          <h2>The ask</h2>
          <p class="dossier-lede">
            We are seeking a development loan of <strong>${fmtEUR(loanAsk)}</strong>
            (${fmtPct(ltcRatio, 0)} LTC) to finance the construction phase of
            <strong>${opp.name}</strong>, a ${fmtNum(builtTotal, 0)} m² ${opp.property.tipologia || "villa"}
            in ${(opp.address || "").split(",")[1] || "Málaga"}.
            Equity (${fmtEUR(equityDeployed)}, ${fmtPct(equityCoveragePct, 0)} of project cost)
            is fully deployed: land, taxes, soft costs, and the approved Basic Project.
            The bank loan covers <strong>100% of construction</strong>, drawn down against
            certified milestones.
          </p>

          <div class="dossier-stats">
            <div class="ds-stat">
              <div class="ds-stat-label">Total project cost</div>
              <div class="ds-stat-value">${fmtEUR(totalCost)}</div>
            </div>
            <div class="ds-stat ds-stat-equity">
              <div class="ds-stat-label">Equity already deployed</div>
              <div class="ds-stat-value">${fmtEUR(equityDeployed)}</div>
              <div class="ds-stat-sub">${fmtPct(equityCoveragePct, 0)} of project cost</div>
            </div>
            <div class="ds-stat ds-stat-loan">
              <div class="ds-stat-label">Loan requested</div>
              <div class="ds-stat-value">${fmtEUR(loanAsk)}</div>
              <div class="ds-stat-sub">${fmtPct(ltcRatio, 0)} LTC · 100% of construction</div>
            </div>
            <div class="ds-stat">
              <div class="ds-stat-label">Expected exit</div>
              <div class="ds-stat-value">${fmtEUR(base.pnl.revenue)}</div>
              <div class="ds-stat-sub">Base case sale price</div>
            </div>
          </div>
        </section>

        <section class="dossier-grid">
          <div class="ds-block">
            <h2>Project</h2>
            <table class="ds-kv">
              <tr><td>Address</td><td>${opp.address || "—"}</td></tr>
              <tr><td>Typology</td><td>${opp.property.tipologia || "—"}</td></tr>
              <tr><td>Plot size</td><td>${fmtNum(opp.property.parcela, 0)} m²</td></tr>
              <tr><td>Edificability</td><td>${fmtPct(opp.property.ratioEdificabilidad, 1)}</td></tr>
              <tr><td>Built area</td><td>${fmtNum(builtTotal, 0)} m² (${fmtNum(opp.property.sobreRasante, 0)} sobre + ${fmtNum(opp.property.bajoRasante, 0)} bajo${opp.property.terrazas ? ` + ${fmtNum(opp.property.terrazas, 0)} terrazas` : ""})</td></tr>
              <tr><td>Status</td><td><strong>${opp.status || "—"}</strong></td></tr>
              <tr><td>Acquisition price</td><td>${fmtEUR(opp.acquisition.landPrice)}</td></tr>
            </table>
          </div>

          <div class="ds-block">
            <h2>Timeline</h2>
            <ul class="ds-timeline">
              ${timeline.map(t => `
                <li class="ds-timeline-item ds-${t.status}">
                  <span class="ds-tl-date">${t.displayDate || ""}</span>
                  <span class="ds-tl-label">${t.label}</span>
                </li>
              `).join("")}
            </ul>
          </div>
        </section>

        <section class="ds-block ds-block-wide">
          <h2>Financial projections (3 scenarios)</h2>
          <table class="ds-financials">
            <thead>
              <tr>
                <th></th>
                <th class="num">Worst</th>
                <th class="num ds-base-col">Base case</th>
                <th class="num">Best</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Sale price (€/m²)</td>
                <td class="num">${fmtEUR(dossierOpp.scenarios.worst.salePricePerSqm)}</td>
                <td class="num ds-base-col">${fmtEUR(dossierOpp.scenarios.base.salePricePerSqm)}</td>
                <td class="num">${fmtEUR(dossierOpp.scenarios.best.salePricePerSqm)}</td>
              </tr>
              <tr><td>Total revenue</td>
                <td class="num">${fmtEUR(worst.pnl.revenue)}</td>
                <td class="num ds-base-col">${fmtEUR(base.pnl.revenue)}</td>
                <td class="num">${fmtEUR(best.pnl.revenue)}</td>
              </tr>
              <tr><td>Total costs</td>
                <td class="num">${fmtEUR(worst.totalCosts)}</td>
                <td class="num ds-base-col">${fmtEUR(base.totalCosts)}</td>
                <td class="num">${fmtEUR(best.totalCosts)}</td>
              </tr>
              <tr class="ds-row-mid"><td>EBITDA</td>
                <td class="num">${fmtEUR(worst.pnl.ebitda)}</td>
                <td class="num ds-base-col">${fmtEUR(base.pnl.ebitda)}</td>
                <td class="num">${fmtEUR(best.pnl.ebitda)}</td>
              </tr>
              <tr class="ds-row-eat"><td>Net profit (EAT)</td>
                <td class="num">${fmtEUR(worst.pnl.eat)}</td>
                <td class="num ds-base-col">${fmtEUR(base.pnl.eat)}</td>
                <td class="num">${fmtEUR(best.pnl.eat)}</td>
              </tr>
              <tr><td>Margin (EAT / Revenue)</td>
                <td class="num">${fmtPct(worst.pnl.eat / worst.pnl.revenue)}</td>
                <td class="num ds-base-col">${fmtPct(base.pnl.eat / base.pnl.revenue)}</td>
                <td class="num">${fmtPct(best.pnl.eat / best.pnl.revenue)}</td>
              </tr>
              <tr><td>ROE</td>
                <td class="num">${fmtPct(worst.returns.roe)}</td>
                <td class="num ds-base-col">${fmtPct(base.returns.roe)}</td>
                <td class="num">${fmtPct(best.returns.roe)}</td>
              </tr>
              <tr><td>IRR (${base.returns.durationMonths} months)</td>
                <td class="num">${fmtPct(worst.returns.irrBase)}</td>
                <td class="num ds-base-col">${fmtPct(base.returns.irrBase)}</td>
                <td class="num">${fmtPct(best.returns.irrBase)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="dossier-grid">
          <div class="ds-block">
            <h2>Capital structure</h2>
            <table class="ds-kv">
              ${investorRows.map(i => `
                <tr>
                  <td>${i.name}</td>
                  <td class="num">${fmtEUR(i.equity)} <span class="muted">(${fmtPct(i.share, 0)})</span></td>
                </tr>
              `).join("")}
              <tr class="ds-row-total">
                <td><strong>Total equity</strong></td>
                <td class="num"><strong>${fmtEUR(equityDeployed)}</strong></td>
              </tr>
            </table>
            <p class="ds-note">Both partners have signed binding capital commitments. Equity already deployed at signing of this dossier.</p>
          </div>

          <div class="ds-block">
            <h2>Loan terms requested</h2>
            <table class="ds-kv">
              <tr><td>Loan amount</td><td><strong>${fmtEUR(loanAsk)}</strong></td></tr>
              <tr><td>Loan-to-cost</td><td>${fmtPct(ltcRatio, 0)}</td></tr>
              <tr><td>Term</td><td>~${base.returns.durationMonths} months (construction + sale)</td></tr>
              <tr><td>Drawdown</td><td>Tied to construction milestones, certified by aparejador</td></tr>
              <tr><td>Repayment</td><td>Bullet at sale (or refinance to mortgage on unsold units)</td></tr>
              <tr><td>Collateral</td><td>1st-rank hipoteca on the asset</td></tr>
              <tr><td>Interest</td><td>Open to bank's offer</td></tr>
            </table>
          </div>
        </section>

        <section class="ds-block ds-block-wide">
          <h2>Cost breakdown (base case)</h2>
          <div class="ds-cost-grid">
            <div class="ds-cost-row">
              <span class="ds-cost-label">Land + acquisition</span>
              <span class="ds-cost-bar"><span class="ds-cost-fill ds-cost-paid" style="width: ${(base.acquisition.total / totalCost * 100).toFixed(1)}%"></span></span>
              <span class="ds-cost-value">${fmtEUR(base.acquisition.total)}</span>
              <span class="ds-cost-pct">${fmtPct(base.acquisition.total / totalCost)}</span>
            </div>
            <div class="ds-cost-row">
              <span class="ds-cost-label">Setup costs</span>
              <span class="ds-cost-bar"><span class="ds-cost-fill ds-cost-paid" style="width: ${(base.setupCost / totalCost * 100).toFixed(1)}%"></span></span>
              <span class="ds-cost-value">${fmtEUR(base.setupCost)}</span>
              <span class="ds-cost-pct">${fmtPct(base.setupCost / totalCost)}</span>
            </div>
            <div class="ds-cost-row">
              <span class="ds-cost-label">Soft costs (architect, licence, PM)</span>
              <span class="ds-cost-bar"><span class="ds-cost-fill ds-cost-paid" style="width: ${(base.soft.total / totalCost * 100).toFixed(1)}%"></span></span>
              <span class="ds-cost-value">${fmtEUR(base.soft.total)}</span>
              <span class="ds-cost-pct">${fmtPct(base.soft.total / totalCost)}</span>
            </div>
            <div class="ds-cost-row">
              <span class="ds-cost-label">Contingencies</span>
              <span class="ds-cost-bar"><span class="ds-cost-fill ds-cost-paid" style="width: ${(base.hard.contingencies / totalCost * 100).toFixed(1)}%"></span></span>
              <span class="ds-cost-value">${fmtEUR(base.hard.contingencies)}</span>
              <span class="ds-cost-pct">${fmtPct(base.hard.contingencies / totalCost)}</span>
            </div>
            <div class="ds-cost-row ds-cost-construction">
              <span class="ds-cost-label"><strong>Construction (PEM + PEC + other) — bank-financed</strong></span>
              <span class="ds-cost-bar"><span class="ds-cost-fill ds-cost-loan" style="width: ${(base.hard.construction / totalCost * 100).toFixed(1)}%"></span></span>
              <span class="ds-cost-value"><strong>${fmtEUR(base.hard.construction)}</strong></span>
              <span class="ds-cost-pct"><strong>${fmtPct(base.hard.construction / totalCost)}</strong></span>
            </div>
            <div class="ds-cost-row ds-cost-total">
              <span class="ds-cost-label"><strong>TOTAL</strong></span>
              <span class="ds-cost-bar"></span>
              <span class="ds-cost-value"><strong>${fmtEUR(totalCost)}</strong></span>
              <span class="ds-cost-pct"><strong>100%</strong></span>
            </div>
          </div>
        </section>

        <footer class="dossier-footer">
          <div>
            <strong>Sadala SL</strong> · Real Estate Development · Málaga
          </div>
          <div class="muted">
            Confidential — for the addressed bank only · ${fmtToday}
          </div>
        </footer>
      </article>
    </div>
  `;
}

// ===================================================================
// ===== Capital calls / contributions tab ===========================
// ===================================================================

function fmtCallPeriod(p) {
  if (!p) return "";
  // "2025-S2" → "S2 2025" ; "2025-Q3" → "Q3 2025"
  const m = p.match(/^(\d{4})-([SQ])(\d)$/);
  return m ? `${m[2]}${m[3]} ${m[1]}` : p;
}

// Format a specific call's display label. Prefers `date` (e.g. "2025-09-12"
// → "12 Sep 2025") if present, otherwise falls back to the period.
function fmtCallLabel(call) {
  if (call && call.date) {
    const m = call.date.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (m) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthName = months[parseInt(m[2], 10) - 1];
      return m[3] ? `${parseInt(m[3], 10)} ${monthName} ${m[1]}` : `${monthName} ${m[1]}`;
    }
  }
  return fmtCallPeriod(call ? call.period : "");
}

function collectCapitalCalls(opp) {
  const rows = [];
  for (const inv of opp.investors || []) {
    for (const c of (inv.capitalCalls || [])) {
      rows.push({ investor: inv.name, period: c.period, amount: c.amount, status: c.status, note: c.note || "" });
    }
  }
  // Sort by period, then by investor for stable display
  rows.sort((a, b) => a.period.localeCompare(b.period) || a.investor.localeCompare(b.investor));
  return rows;
}

function computeContribSummary(opp) {
  return (opp.investors || []).map(inv => {
    const calls = inv.capitalCalls || [];
    // "Committed" is the target equity. Use inv.equity if set, otherwise
    // fall back to the sum of capital calls (legacy behaviour).
    const committed = inv.equity != null
      ? inv.equity
      : calls.reduce((s, c) => s + (c.amount || 0), 0);
    const paid = calls.filter(c => c.status === "paid").reduce((s, c) => s + (c.amount || 0), 0);
    const expected = calls.filter(c => c.status === "expected").reduce((s, c) => s + (c.amount || 0), 0);
    // remaining = committed − paid. Negative means over-paid.
    const remaining = committed - paid;
    return { ...inv, committed, paid, expected, remaining, pctPaid: committed ? paid / committed : 0 };
  });
}

function renderCapitalCalls(opp) {
  const summary = computeContribSummary(opp);
  const allCalls = collectCapitalCalls(opp);

  // Aggregate by period for the schedule table
  const byPeriod = {};
  for (const c of allCalls) {
    byPeriod[c.period] = byPeriod[c.period] || { period: c.period, total: 0, paid: 0, expected: 0 };
    byPeriod[c.period].total += c.amount;
    if (c.status === "paid") byPeriod[c.period].paid += c.amount;
    else byPeriod[c.period].expected += c.amount;
  }
  const periodList = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));

  // Cumulative per period
  let cum = 0;
  for (const p of periodList) {
    cum += p.total;
    p.cumulative = cum;
  }

  const totalCommitted = summary.reduce((s, i) => s + i.committed, 0);
  const totalPaid      = summary.reduce((s, i) => s + i.paid, 0);
  const totalRemaining = summary.reduce((s, i) => s + i.remaining, 0);

  const hasData = totalCommitted > 0;

  if (!hasData) {
    return `
      <h2>Cash flow — ${opp.name}</h2>
      <div class="placeholder-panel">
        <div class="placeholder-icon">💸</div>
        <h3>No capital calls defined yet</h3>
        <p>To track investor contributions, add a <code>capitalCalls</code> array on each investor in <code>data/${state.oppKey}.js</code>.</p>
        <p class="muted">Each entry: <code>{ period: "2026-S1", amount: 50000, status: "paid" | "expected", note: "..." }</code></p>
      </div>
    `;
  }

  return `
    <h2>Cash flow — ${opp.name}</h2>
    <p class="muted">When each investor contributes equity to the project. Status switches from <em>expected</em> to <em>paid</em> as the project progresses.</p>

    <div class="cashflow-summary">
      <div class="cf-summary-item"><div class="cf-summary-label">Total committed</div><div class="cf-summary-value">${fmtEUR(totalCommitted)}</div></div>
      <div class="cf-summary-item highlight"><div class="cf-summary-label">Paid to date</div><div class="cf-summary-value">${fmtEUR(totalPaid)}</div></div>
      <div class="cf-summary-item"><div class="cf-summary-label">Remaining</div><div class="cf-summary-value">${fmtEUR(totalRemaining)}</div></div>
    </div>

    <h3>By investor</h3>
    <table class="kv contrib-summary">
      <thead>
        <tr>
          <th>Investor</th>
          <th class="num">Committed</th>
          <th class="num">Paid</th>
          <th class="num">Status</th>
          <th>Progress</th>
        </tr>
      </thead>
      <tbody>
        ${summary.map(inv => {
          if (inv.committed === 0) {
            return `<tr class="muted">
              <td>${inv.name}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td><span class="muted">${inv.role === "free-shares" ? "free shares" : "no calls"}</span></td>
            </tr>`;
          }

          // Determine status text + cell colour
          let statusCell, barClass;
          if (inv.remaining > 0.5) {
            // Under-paid — still owes money
            statusCell = `<td class="num cf-neg-light"><strong>−${fmtEUR(inv.remaining)}</strong> remaining</td>`;
            barClass = inv.paid > 0 ? "partial" : "pending";
          } else if (inv.remaining < -0.5) {
            // Over-paid — front-loaded
            statusCell = `<td class="num cf-pos-light"><strong>+${fmtEUR(-inv.remaining)}</strong> over commitment</td>`;
            barClass = "fully-paid";
          } else {
            statusCell = `<td class="num cf-pos-light">Paid in full ✓</td>`;
            barClass = "fully-paid";
          }

          const barWidth = Math.min(inv.pctPaid * 100, 100).toFixed(1);
          const overflowPct = inv.pctPaid > 1 ? Math.min((inv.pctPaid - 1) * 100, 50).toFixed(1) : 0;
          return `<tr>
            <td>${inv.name}</td>
            <td class="num">${fmtEUR(inv.committed)}</td>
            <td class="num">${fmtEUR(inv.paid)}</td>
            ${statusCell}
            <td>
              <div class="contrib-bar">
                <div class="contrib-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                ${overflowPct > 0 ? `<div class="contrib-bar-overflow" style="width:${overflowPct}%"></div>` : ""}
                <span class="contrib-bar-pct">${fmtPct(inv.pctPaid, 0)}</span>
              </div>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>

    <h3>Schedule by period</h3>
    ${(() => {
      const investorsWithCalls = summary.filter(s => s.committed > 0);
      const periods = periodList.map(p => p.period);
      // Compute per-period totals + cumulative
      const totalsPerPeriod = periods.map(per =>
        investorsWithCalls.reduce((sum, inv) => {
          const c = (inv.capitalCalls || []).find(x => x.period === per);
          return sum + (c ? c.amount : 0);
        }, 0)
      );
      let runningCum = 0;
      const cumPerPeriod = totalsPerPeriod.map(t => (runningCum += t));

      return `
        <div class="schedule-scroll">
          <table class="kv contrib-schedule">
            <thead>
              <tr>
                <th>Investor</th>
                ${periods.map(per => `<th class="num">${fmtCallPeriod(per)}</th>`).join("")}
                <th class="num">Committed</th>
              </tr>
            </thead>
            <tbody>
              ${investorsWithCalls.map(inv => `
                <tr>
                  <td><strong>${inv.name}</strong></td>
                  ${periods.map(per => {
                    const call = (inv.capitalCalls || []).find(c => c.period === per);
                    if (!call) return `<td class="num muted">—</td>`;
                    const cls = call.status === "paid" ? "cf-pos-light" : "cf-neg-light";
                    const tooltip = [call.note, call.date ? `Paid ${fmtCallLabel(call)}` : null].filter(Boolean).join(" — ");
                    return `<td class="num ${cls}" title="${tooltip}">${fmtEUR(call.amount)}</td>`;
                  }).join("")}
                  <td class="num total-cell">${fmtEUR(inv.committed)}</td>
                </tr>
              `).join("")}
              <tr class="period-total-row">
                <td><strong>Total per period</strong></td>
                ${totalsPerPeriod.map(t => `<td class="num"><strong>${fmtEUR(t)}</strong></td>`).join("")}
                <td class="num total-cell"><strong>${fmtEUR(totalCommitted)}</strong></td>
              </tr>
              <tr class="period-cum-row muted">
                <td>Cumulative</td>
                ${cumPerPeriod.map(c => `<td class="num">${fmtEUR(c)}</td>`).join("")}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    })()}

    <h3>Detail</h3>
    <table class="kv contrib-detail">
      <thead>
        <tr>
          <th>Period</th>
          <th>Investor</th>
          <th class="num">Amount</th>
          <th>Status</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${allCalls.map(c => `
          <tr>
            <td>${fmtCallPeriod(c.period)}</td>
            <td>${c.investor}</td>
            <td class="num">${fmtEUR(c.amount)}</td>
            <td><span class="contrib-status status-${c.status}">${c.status}</span></td>
            <td class="muted">${c.note}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ===================================================================
// ===== Portfolio (kanban) renderer =================================
// ===================================================================

const KANBAN_STAGES = {
  current:   ["acquired", "construction", "rental", "sold"],
  potential: ["analysis", "offer-sent", "no-go"],
};
const STAGE_LABELS = {
  acquired:     "Acquired",
  construction: "Construction in progress",
  rental:       "Rental",
  sold:         "Sold",
  analysis:     "Analysis in progress",
  "offer-sent": "Offer sent",
  "no-go":      "No go",
};
const DEAL_TYPE_LABELS = {
  "buy-to-sell": "Buy to sell",
  "buy-to-rent": "Buy to rent",
  "buy-to-flip": "Buy to flip",
};

function portfolioCardKPI(opp) {
  if (opp.placeholder) return `<div class="kb-kpi muted">No data yet</div>`;
  try {
    if (opp.projectType === "rental") {
      const base = compute(opp, "base");
      const best = compute(opp, "best");
      return `
        <div class="kb-kpi">
          <span class="kb-kpi-label">Levered IRR</span>
          <span class="kb-kpi-value">${fmtPct(base.irr.levered)} <span class="kb-kpi-best">/ ${fmtPct(best.irr.levered)} best</span></span>
        </div>`;
    } else {
      const r = compute(opp, "base");
      return `
        <div class="kb-kpi">
          <span class="kb-kpi-label">Base IRR</span>
          <span class="kb-kpi-value">${fmtPct(r.returns.irrBase)} <span class="kb-kpi-best">· ROE ${fmtPct(r.returns.roe)}</span></span>
        </div>`;
    }
  } catch (e) {
    return `<div class="kb-kpi muted">—</div>`;
  }
}

function renderPortfolioCard(oppKey, opp) {
  const dealLabel = DEAL_TYPE_LABELS[opp.dealType] || (opp.dealType ? opp.dealType : "");
  return `
    <a class="kb-card kb-${opp.dealType || "unknown"}" href="#opp=${oppKey}&tab=summary">
      <div class="kb-card-head">
        <strong class="kb-card-name">${opp.name}</strong>
        ${dealLabel ? `<span class="kb-tag tag-${opp.dealType}">${dealLabel}</span>` : ""}
      </div>
      ${opp.address ? `<div class="kb-card-address">${opp.address}</div>` : ""}
      ${opp.status ? `<div class="kb-card-status">${opp.status}</div>` : ""}
      ${portfolioCardKPI(opp)}
    </a>`;
}

function findSadalaInvestor(opp) {
  return (opp.investors || []).find(i => i.name && i.name.toLowerCase().startsWith("sadala"));
}

function sadalaEquityIn(opp, computed) {
  const inv = findSadalaInvestor(opp);
  if (!inv) return 0;
  if (opp.projectType === "rental") return computed.totals.equityRequired;  // sole sponsor for now
  if (inv.equity != null) return inv.equity;
  // Derived: total equity - sum of named equity from other investors
  const named = (opp.investors || []).reduce((s, i) => s + (i.equity || 0), 0);
  return computed.returns.equityInvested - named;
}

function renderPortfolioKPIs() {
  const allOpps = (window.OPPORTUNITY_ORDER || Object.keys(window.OPPORTUNITIES))
    .map(k => ({ key: k, ...window.OPPORTUNITIES[k] }));
  const isActive = (o) => KANBAN_STAGES.current.includes(o.stage) && o.stage !== "sold" && !o.placeholder;
  const active = allOpps.filter(isActive);

  let totalProjectCost = 0;
  let totalSadalaEquity = 0;
  let totalSadalaProfit = 0;

  for (const opp of active) {
    try {
      const r = compute(opp, "base");
      const sEq = sadalaEquityIn(opp, r);
      totalSadalaEquity += sEq;

      if (opp.projectType === "rental") {
        totalProjectCost += r.totals.totalCost;
        // Sadala net profit = total levered cashflow + initial equity (since cf[0] = -equity)
        const netProfit = r.cashflows.levered.reduce((a, b) => a + b, 0);
        totalSadalaProfit += netProfit;  // sole sponsor
      } else {
        totalProjectCost += r.totalCosts || 0;
        const inv = findSadalaInvestor(opp);
        const share = inv ? (inv.profitShare || 0) : 1;
        totalSadalaProfit += (r.pnl.eat || 0) * share;
      }
    } catch (e) {}
  }

  const card = (label, value, sub) => `
    <div class="pkpi">
      <div class="pkpi-label">${label}</div>
      <div class="pkpi-value">${value}</div>
      ${sub ? `<div class="pkpi-sub">${sub}</div>` : ""}
    </div>`;

  return `
    <div class="portfolio-kpis">
      ${card("Active assets",                String(active.length), active.map(o => o.name).join(" · "))}
      ${card("Asset value",                  fmtEUR(totalProjectCost), "Sum of total project costs (base)")}
      ${card("Sadala equity committed",      fmtEUR(totalSadalaEquity), "Active deals only")}
      ${card("Expected profit (Sadala)",     fmtEUR(totalSadalaProfit), "Base case, share-weighted")}
    </div>
  `;
}

function renderPortfolio() {
  const allOpps = (window.OPPORTUNITY_ORDER || Object.keys(window.OPPORTUNITIES)).map(k => ({ key: k, ...window.OPPORTUNITIES[k] }));

  const byStage = {};
  for (const o of allOpps) {
    const s = o.stage || "analysis";
    (byStage[s] = byStage[s] || []).push(o);
  }

  const renderColumn = (stage) => {
    const items = byStage[stage] || [];
    return `
      <div class="kb-column">
        <div class="kb-column-head">
          <span class="kb-column-title">${STAGE_LABELS[stage]}</span>
          <span class="kb-column-count">${items.length}</span>
        </div>
        <div class="kb-cards">
          ${items.map(o => renderPortfolioCard(o.key, o)).join("") || `<div class="kb-empty">—</div>`}
        </div>
      </div>`;
  };

  return `
    <div class="portfolio-head">
      <h2>Portfolio</h2>
      <p class="muted">All opportunities at a glance. Click any card to drill in.</p>
    </div>

    ${renderPortfolioKPIs()}

    <h3>Current assets</h3>
    <div class="kb-board">
      ${KANBAN_STAGES.current.map(renderColumn).join("")}
    </div>

    <h3>Potential assets</h3>
    <div class="kb-board">
      ${KANBAN_STAGES.potential.map(renderColumn).join("")}
    </div>
  `;
}

// ===== Tab dispatch =====
function renderTab() {
  writeHash();
  const isPortfolio = state.tab === "portfolio";

  // Sync the active tab button class (only relevant in project view)
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === state.tab));

  // Tabs nav only shown in project view. Opp dropdown stays visible
  // everywhere — user can navigate to any project from anywhere via it.
  const tabsNav = document.querySelector("nav.tabs");
  if (tabsNav) tabsNav.style.display = isPortfolio ? "none" : "";

  // Keep dropdown in sync with current state
  const select = document.getElementById("opportunity-select");
  if (select) {
    const wantedValue = isPortfolio ? "" : (state.oppKey || "");
    if (select.value !== wantedValue) select.value = wantedValue;
  }

  const main = document.getElementById("main");

  if (isPortfolio) {
    main.innerHTML = renderPortfolio();
    return;
  }

  const opp = window.OPPORTUNITIES[state.oppKey];
  if (!opp) { main.innerHTML = "<p>No opportunity selected.</p>"; return; }

  const isRental = opp.projectType === "rental";

  // Update the "P&L" / "Cash flow" tab label based on project type, and
  // hide the new "cashflow" tab on rental (the P&L tab is already labeled
  // "Cash flow" there — capital calls trivial since equity is upfront).
  const pnlBtn = document.querySelector('.tab-btn[data-tab="pnl"]');
  if (pnlBtn) {
    pnlBtn.textContent = isRental ? "Cash flow" : "P&L";
  }
  const cashflowBtn = document.querySelector('.tab-btn[data-tab="cashflow"]');
  if (cashflowBtn) cashflowBtn.style.display = isRental ? "none" : "";
  const dossierBtn = document.querySelector('.tab-btn[data-tab="dossier"]');
  if (dossierBtn) dossierBtn.style.display = isRental ? "none" : "";

  if (opp.placeholder) {
    main.innerHTML = renderPlaceholder(opp);
    return;
  }

  // Dev-only tabs — redirect rentals to a sensible default
  if ((state.tab === "cashflow" || state.tab === "dossier") && isRental) {
    state.tab = state.tab === "cashflow" ? "pnl" : "summary";
    document.querySelectorAll(".tab-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === state.tab));
  }

  switch (state.tab) {
    case "summary":     main.innerHTML = isRental ? renderRentalSummary(opp)    : renderSummary(opp); break;
    case "hypothesis":  main.innerHTML = isRental ? renderRentalHypothesis(opp) : renderHypothesis(opp); break;
    case "pnl":         main.innerHTML = isRental ? renderRentalCashFlow(opp)   : renderPnL(opp); break;
    case "cashflow":    main.innerHTML = renderCapitalCalls(opp); break;
    case "investors":   main.innerHTML = isRental ? renderRentalInvestors(opp)  : renderInvestors(opp); break;
    case "dossier":     main.innerHTML = renderBankDossier(opp); break;
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

}

// ===== Bootstrap =====
function init() {
  const oppKeys = window.OPPORTUNITY_ORDER && window.OPPORTUNITY_ORDER.length
    ? window.OPPORTUNITY_ORDER
    : Object.keys(window.OPPORTUNITIES);

  // Initialize from URL hash. No opp in hash → portfolio (home) view.
  const hashed = readHash();
  if (hashed.opp && window.OPPORTUNITIES[hashed.opp]) {
    state.oppKey = hashed.opp;
    state.tab    = ["summary", "hypothesis", "pnl", "cashflow", "investors", "dossier"].includes(hashed.tab) ? hashed.tab : "summary";
  } else {
    state.oppKey = null;
    state.tab    = "portfolio";
  }
  state.scenario = ["worst", "base", "best"].includes(hashed.scenario) ? hashed.scenario : "base";

  // Opportunity dropdown — always visible. Top option = Portfolio (home).
  const select = document.getElementById("opportunity-select");
  select.innerHTML = `
    <option value="">— Portfolio —</option>
    ${oppKeys.map(k =>
      `<option value="${k}" ${k === state.oppKey ? "selected" : ""}>${window.OPPORTUNITIES[k].name}</option>`
    ).join("")}
  `;
  if (!state.oppKey) select.value = "";
  select.addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) {
      // Selected "— Portfolio —" → go home
      state.oppKey = null;
      state.tab = "portfolio";
    } else {
      state.oppKey = v;
      // If we were on portfolio, jump to that project's Summary
      if (state.tab === "portfolio") state.tab = "summary";
    }
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

  // React to back/forward navigation, and to clicking links that change the hash.
  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h.opp && window.OPPORTUNITIES[h.opp]) {
      // Project view
      state.oppKey = h.opp;
      state.tab    = ["summary","hypothesis","pnl","cashflow","investors"].includes(h.tab) ? h.tab : "summary";
    } else {
      // Portfolio (home) view
      state.oppKey = null;
      state.tab    = "portfolio";
    }
    if (["worst","base","best"].includes(h.scenario)) state.scenario = h.scenario;
    if (state.oppKey && select.value !== state.oppKey) select.value = state.oppKey;
    renderTab();
  });

  renderTab();
}

document.addEventListener("DOMContentLoaded", init);
