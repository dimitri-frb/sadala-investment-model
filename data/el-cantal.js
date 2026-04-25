// El Cantal — full model
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("el-cantal");

window.OPPORTUNITIES["el-cantal"] = {
  name: "El Cantal",
  address: "Leoni Benabu 41, 29018 Malaga",
  status: "Basic project submitted",

  // ====== PROPERTY ======
  property: {
    tipologia: "Unifamiliar aislada UAS",
    parcela: 1006.75,              // Superficie parcela adoptada (m²)
    ratioEdificabilidad: 0.25,
    sobreRasante: 380.5,           // Construida sobre rasante (m²)
    bajoRasante: 130.6,            // Construida bajo rasante (m²)
    terrazas: 59.0,                // Terrazas (m²)
    exteriorJardines: 755.06,      // Exterior jardines y ZZCC urbanizacion (m²)
  },

  // ====== ACQUISITION ======
  // All percentage fees are computed on landPrice.
  acquisition: {
    landPrice: 540000,
    landTaxRegime: "ITP",          // "ITP" or "VAT"
    landTaxRate: 0.07,             // 7% for ITP; typical VAT on residential land is 21%
    notaryRate: 0.01,              // 1% of land price
    salesCommissionRate: 0.03,     // 3% of land price
  },

  // ====== SETUP (% of acquisition total) ======
  setupRate: 0.03,

  // ====== URBANIZATION ======
  urbanizationCost: 0,

  // ====== HARD COSTS ======
  // Construction = PEM + PEC + Other costs
  // PEC       = pecRate        × PEM  (10% of PEM)
  // Other     = otherCostsRate × PEM  (10% of PEM — insurance, taxes)
  hardCosts: {
    pecRate: 0.10,
    otherCostsRate: 0.10,
    contingenciesRate: 0.05,       // % of construction
  },

  // ====== SOFT COSTS ======
  // All expressed as % of construction costs
  softCosts: {
    architectureRate: 0.10,        // 10% of construction
    aparejadorRate: 0.045,         // 4.5% of construction
    licenceRate: 0.03,             // 3% of construction
    projectManagementRate: 0.04,   // 4% of construction
  },

  // ====== P&L RATES ======
  commercializationRate: 0.07,     // % of revenue
  financingRate: 0.05,             // % of total costs
  taxRate: 0.25,                   // IS

  // ====== TIMING ======
  // Total project duration from acquisition to exit (months).
  // "12-month delay" IRR uses projectDurationMonths + 12.
  projectDurationMonths: 36,

  // ====== TIMELINE ======
  // Each milestone has `status: "done" | "expected"`.
  // Date format: "YYYY-MM". Use `offsetFrom: <id> + offsetMonths` to
  // derive a date relative to an earlier milestone (e.g. delivery =
  // construction start + 18 months).
  timeline: [
    { id: "acquired",     label: "Property acquired",           date: "2025-09", status: "done" },
    { id: "pb-submitted", label: "Basic project submitted",     date: "2026-01", status: "done" },
    { id: "pb-approved",  label: "Basic project approved",      date: "2026-09", status: "expected" },
    { id: "pe-submitted", label: "Execution project submitted", date: "2026-09", status: "expected" },
    { id: "pe-approved",  label: "Execution project approved",  date: "2026-10", status: "expected" },
    { id: "construction", label: "Construction start",          date: "2026-10", status: "expected" },
    { id: "delivery",     label: "Delivery",                    offsetFrom: "construction", offsetMonths: 18, status: "expected" },
  ],

  // ====== SCENARIO ASSUMPTIONS ======
  // Only these values change between worst / base / best.
  scenarios: {
    worst: { salePricePerSqm: 6500, pemPerSqm: 3000, note: "" },
    base:  { salePricePerSqm: 8000, pemPerSqm: 2900, note: "" },
    best:  { salePricePerSqm: 9000, pemPerSqm: 2800, note: "" },
  },

  // ====== CAP TABLE ======
  // Sadala equity is derived (total equity invested − sum of others).
  investors: [
    { name: "Sadala SL",                role: "sponsor",     equity: null,   profitShare: 0.57 },
    { name: "Bingin SC",                 role: "investor",    equity: 450000, profitShare: 0.42 },
    { name: "Bingin SC (free shares)",   role: "free-shares", equity: 0,      profitShare: 0.005 },
    { name: "Lili One SC (free shares)", role: "free-shares", equity: 0,      profitShare: 0.005 },
  ],
};
