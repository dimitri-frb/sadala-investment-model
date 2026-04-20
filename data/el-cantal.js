// El Cantal — full model
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("el-cantal");

window.OPPORTUNITIES["el-cantal"] = {
  name: "El Cantal",
  address: "Leoni Benabu 41, 29018 Malaga",
  status: "Proyecto basico submitted",

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

  // ====== SCENARIO ASSUMPTIONS ======
  // Only these values change between worst / base / best.
  scenarios: {
    worst: { salePricePerSqm: 6500, pemPerSqm: 3000, note: "" },
    base:  { salePricePerSqm: 8000, pemPerSqm: 2900, note: "" },
    best:  { salePricePerSqm: 9000, pemPerSqm: 2800, note: "" },
  },

  // ====== CAP TABLE ======
  // Kakarot equity is derived (total equity invested − sum of others).
  investors: [
    { name: "Kakarot SL",                role: "sponsor",     equity: null,   profitShare: 0.57 },
    { name: "Bingin SC",                 role: "investor",    equity: 450000, profitShare: 0.42 },
    { name: "Bingin SC (free shares)",   role: "free-shares", equity: 0,      profitShare: 0.005 },
    { name: "Lili One SC (free shares)", role: "free-shares", equity: 0,      profitShare: 0.005 },
  ],
};
