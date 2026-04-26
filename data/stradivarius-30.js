// Stradivarius — 3 parcelas in Pinares, 2 luxury villas (~500 sqm each).
// Inputs estimated from El Cantal & Sosiego scaled for the Pinares premium
// market and the larger built area. Sale prices benchmarked against Coral
// Shield Asset Management's external scenario analysis (Apr 2026):
//   Worst: ~€6.5M revenue · Base: ~€8.7M · Best: ~€9.5M
// All numbers are PRELIMINARY — adjust as more data lands.
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("stradivarius-30");

window.OPPORTUNITIES["stradivarius-30"] = {
  name: "Stradivarius 30",
  address: "Pinares de San Antón, Málaga",
  status: "Offer accepted",
  stage: "offer-sent",
  dealType: "buy-to-sell",

  // ====== PROPERTY ======
  // 3 parcelas, ~3,000 m² total. 2 luxury villas of ~500 m² built each.
  property: {
    tipologia: "Unifamiliar aislada — luxury (Pinares)",
    parcela: 3000,
    ratioEdificabilidad: 0.333,    // 1,000 / 3,000
    sobreRasante: 700,             // 350 m² × 2 villas (interior living)
    bajoRasante: 300,              // 150 m² × 2 villas (basement / garage)
    terrazas: 0,                   // (terraces not separately broken out yet)
    exteriorJardines: 2000,
  },

  // ====== ACQUISITION ======
  // Offer accepted: €500k all-in (incl. notary) from a company → IVA regime.
  // Solving 500,000 = land × (1 + 0.21) → land base ≈ 413,223; VAT recovered.
  // Notary and other fees bundled in the 500k headline.
  acquisition: {
    landPrice: 413223,
    landTaxRegime: "VAT",
    landTaxRate: 0.21,
    notaryRate: 0,                 // bundled in headline 500k
    salesCommissionRate: 0,
  },

  // ====== SETUP ======
  setupRate: 0.03,

  // ====== URBANIZATION ======
  urbanizationCost: 150000,        // user-given estimate

  // ====== HARD COSTS ======
  hardCosts: {
    pecRate: 0.10,
    otherCostsRate: 0.10,          // % of PEM (consistent with El Cantal)
    contingenciesRate: 0.05,
  },

  // ====== SOFT COSTS ======
  softCosts: {
    architectureRate: 0.10,
    aparejadorRate: 0.045,
    licenceRate: 0.03,
    projectManagementRate: 0.04,
  },

  // ====== P&L RATES ======
  commercializationRate: 0.07,
  financingRate: 0.05,
  taxRate: 0.25,

  // ====== TIMING ======
  // 5-year horizon (matches Coral Shield's analysis): permit + execution +
  // construction (~24mo for 2 villas) + sale process buffer.
  projectDurationMonths: 60,

  // ====== TIMELINE ======
  // Estimated dates — anchor on a Q3 2026 signing target.
  timeline: [
    { id: "offer",        label: "Offer accepted",              date: "2026-04", status: "done" },
    { id: "signed",       label: "Property signed",             date: "2026-07", status: "expected" },
    { id: "pb-submitted", label: "Basic project submitted",     offsetFrom: "signed",       offsetMonths: 4,  status: "expected" },
    { id: "pb-approved",  label: "Basic project approved",      offsetFrom: "pb-submitted", offsetMonths: 8,  status: "expected" },
    { id: "pe-approved",  label: "Execution project approved",  offsetFrom: "pb-approved",  offsetMonths: 4,  status: "expected" },
    { id: "construction", label: "Construction start",          offsetFrom: "pe-approved",  offsetMonths: 1,  status: "expected" },
    { id: "delivery",     label: "Delivery",                    offsetFrom: "construction", offsetMonths: 24, status: "expected" },
  ],

  // ====== SCENARIO ASSUMPTIONS ======
  // Calibrated to Coral Shield Asset Management's D4.3 scenario analysis
  // (without presales) dated Apr 2026:
  //   Worst (Desfavorable): revenue €6.47M
  //   Base  (CORALshield):  revenue €8.72M (75% of historical 5-yr growth)
  //   Best  (Optimista):    revenue €9.47M (100% of historical growth)
  // Coral Shield treats costs as roughly constant across scenarios (~€5.0M)
  // — variation is concentrated on revenue. PEM held flat at €2,900/m².
  scenarios: {
    worst: { salePricePerSqm: 6500, pemPerSqm: 2900, note: "Today's market + cost escalation (Coral Shield Desfavorable)" },
    base:  { salePricePerSqm: 8700, pemPerSqm: 2900, note: "75% of historical 5-yr price growth (Coral Shield base)"      },
    best:  { salePricePerSqm: 9500, pemPerSqm: 2900, note: "100% historical growth + premium finish (Coral Shield Optimista)" },
  },

  // ====== CAP TABLE ======
  // Sadala-only for now — no co-investors signed yet. Capital calls TBD.
  investors: [
    {
      name: "Sadala SL", role: "sponsor", equity: null, profitShare: 1.00,
      capitalCalls: [],
    },
  ],
};
