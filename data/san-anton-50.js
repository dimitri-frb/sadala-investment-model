// San Antón 50 (source: Villa Buganvilleas analysis, Oct 2025)
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("san-anton-50");

window.OPPORTUNITIES["san-anton-50"] = {
  name: "Sosiego",
  address: "Buganvillas 14, 29018 Malaga",
  status: "Basic project approved",

  // ====== PROPERTY ======
  property: {
    tipologia: "Unifamiliar aislada UAS-4",
    parcela: 1127,
    ratioEdificabilidad: 0.244,
    sobreRasante: 263.5,
    bajoRasante: 263.5,
    terrazas: 0,
    exteriorJardines: 0,  // not given in source
  },

  // ====== ACQUISITION ======
  // Note: source uses VAT (IVA) 21% — marked "to be recuperated EOY".
  // Notary in source is €2,200 fixed; expressed as rate for consistency (~0.35%).
  acquisition: {
    landPrice: 625000,
    landTaxRegime: "VAT",
    landTaxRate: 0.21,
    notaryRate: 0.0035,
    salesCommissionRate: 0,     // no sales commission on land acquisition
  },

  // ====== SETUP ======
  setupRate: 0.03,

  // ====== URBANIZATION ======
  urbanizationCost: 0,

  // ====== HARD COSTS ======
  hardCosts: {
    pecRate: 0.10,
    otherCostsRate: 0.10,
    otherCostsBase: "PEM_PLUS_PEC",   // source uses 10% of (PEM+PEC); El Cantal uses 10% of PEM only
    contingenciesRate: 0.05,
  },

  // ====== SOFT COSTS ======
  // Source breaks architecture into project (2%) + ejecución (2%) + paisajismo (5%).
  // Rolled into architectureRate=9% until we add a paisajismo line.
  softCosts: {
    architectureRate: 0.09,
    aparejadorRate: 0.02,
    licenceRate: 0.03,
    projectManagementRate: 0.035,   // source: 3k + 3% PEM + 15k ≈ 3.5% of construction
  },

  // ====== P&L RATES ======
  commercializationRate: 0.07,
  financingRate: 0.05,
  taxRate: 0.25,

  // ====== TIMING ======
  projectDurationMonths: 36,

  // ====== SCENARIO ASSUMPTIONS ======
  // From source Hypothesis!D5:F8 lookup table.
  scenarios: {
    worst: { salePricePerSqm: 6500, pemPerSqm: 2750, note: "" },
    base:  { salePricePerSqm: 7500, pemPerSqm: 2750, note: "" },
    best:  { salePricePerSqm: 8000, pemPerSqm: 2750, note: "" },
  },

  // ====== TIMELINE ======
  // Same milestones as El Cantal. Given dates:
  //   - Basic project approved: Jan 2026 (done)
  //   - Execution project approved: May 2026 (expected)
  //   - Construction start: June 2026 (expected)
  //   - Delivery: construction start + 18 months (Dec 2027)
  // Property acquired / Basic project submitted: placeholder dates, TBC.
  timeline: [
    { id: "acquired",     label: "Property acquired",           date: "2024-06", status: "done" },
    { id: "pb-submitted", label: "Basic project submitted",     date: "2025-04", status: "done" },
    { id: "pb-approved",  label: "Basic project approved",      date: "2026-01", status: "done" },
    { id: "pe-submitted", label: "Execution project submitted", date: "2026-02", status: "done" },
    { id: "pe-approved",  label: "Execution project approved",  date: "2026-05", status: "expected" },
    { id: "construction", label: "Construction start",          date: "2026-06", status: "expected" },
    { id: "delivery",     label: "Delivery",                    offsetFrom: "construction", offsetMonths: 18, status: "expected" },
  ],

  // ====== CAP TABLE ======
  // 49.5 / 49.5 between Sadala SL and Inimex SL, plus 0.5% free shares each
  // to Bingin SC and Lili One SC.
  // Sadala equity is derived (total equity invested − others' contributions).
  investors: [
    { name: "Sadala SL",                 role: "sponsor",     equity: null,       profitShare: 0.495 },
    { name: "Inimex SL",                 role: "investor",    equity: 587931.79,  profitShare: 0.495 },
    { name: "Bingin SC (free shares)",   role: "free-shares", equity: 0,          profitShare: 0.005 },
    { name: "Lili One SC (free shares)", role: "free-shares", equity: 0,          profitShare: 0.005 },
  ],
};
