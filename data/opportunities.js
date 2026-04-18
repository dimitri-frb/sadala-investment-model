// Investment opportunities data.
// Add a new opportunity by adding an entry to this object.
// All monetary values in EUR. Areas in m2. Rates as decimals (0.25 = 25%).

window.OPPORTUNITIES = {
  "villa-el-cantal": {
    name: "Villa El Cantal",
    address: "Leoni Benabu 41, 29018 Malaga",
    typology: "Unifamiliar aislada UAS",

    // --- Plot & built area (same across scenarios) ---
    plotSize: 1006.75,
    edificabilityRatio: 0.25,
    builtAbove: 380.5,         // sobre rasante
    builtBelow: 130.6,         // bajo rasante
    terraces: 59,
    exteriorGarden: 755.06,

    // --- Land acquisition ---
    landPrice: 540000,
    itpRate: 0.07,
    notary: 2200,
    landSalesCommissionRate: 0.037,

    // --- Construction & cost rates ---
    setupRate: 0.03,             // % of land total
    urbanizationCost: 0,
    pecRate: 0.10,               // PEC as % of PEM
    otherCostsRate: 0.10,        // % of (PEM + PEC)
    contingenciesRate: 0.05,     // % of construction
    architectureRate: 0.10,      // % of construction
    aparejadorRate: 0.045,
    licenceRate: 0.03,
    projectManagementCost: 76598.7,  // absolute

    // --- P&L rates ---
    commercializationRate: 0.07,  // % of revenue
    financingRate: 0.05,          // % of total costs
    taxRate: 0.25,

    // --- Sale stage ladder: stage IV is the reference, earlier stages priced lower ---
    // Stage prices (€/sqm): IV = salePricePerSqm, III = IV - 500, II = III - 500, I = II - 1000
    saleStageDeltas: { III: -500, II: -1000, I: -2000 },  // vs stage IV

    // --- Scenarios: only these two values change between worst/base/best ---
    scenarios: {
      worst: { salePricePerSqm: 6500, pemPerSqm: 3000 },
      base:  { salePricePerSqm: 8000, pemPerSqm: 2900 },
      best:  { salePricePerSqm: 9000, pemPerSqm: 2800 },
    },

    // --- Project timing for IRR ---
    // Total project duration from acquisition to exit (months). Default ~36 months.
    // "12-month delay" IRR uses projectDurationMonths + 12.
    projectDurationMonths: 36,

    // --- Cap table ---
    // Kakarot's equity = total equity invested - sum of other equity contributions
    investors: [
      { name: "Kakarot SL",              role: "sponsor",       equity: null,    profitShare: 0.57 },
      { name: "Bingin SC",               role: "investor",      equity: 450000,  profitShare: 0.41 },
      { name: "Bingin SC (free shares)", role: "free-shares",   equity: 0,       profitShare: 0.01 },
      { name: "Lili One SC (free shares)", role: "free-shares", equity: 0,       profitShare: 0.01 },
    ],
  },
};
