// El Cantal — full model
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("el-cantal");

window.OPPORTUNITIES["el-cantal"] = {
  name: "El Cantal",
  address: "Leoni Benabu 41, 29018 Malaga",
  status: "Proyecto basico submitted",
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
  setupRate: 0.03,
  urbanizationCost: 0,
  pecRate: 0.10,
  otherCostsRate: 0.10,
  contingenciesRate: 0.05,
  architectureRate: 0.10,
  aparejadorRate: 0.045,
  licenceRate: 0.03,
  projectManagementCost: 76598.7,

  // --- P&L rates ---
  commercializationRate: 0.07,
  financingRate: 0.05,
  taxRate: 0.25,

  // --- Sale stage ladder (vs stage IV) ---
  saleStageDeltas: { III: -500, II: -1000, I: -2000 },

  // --- Scenarios ---
  scenarios: {
    worst: { salePricePerSqm: 6500, pemPerSqm: 3000, note: "" },
    base:  { salePricePerSqm: 8000, pemPerSqm: 2900, note: "" },
    best:  { salePricePerSqm: 9000, pemPerSqm: 2800, note: "" },
  },

  // --- Project timing (months from acquisition to exit) ---
  projectDurationMonths: 36,

  // --- Cap table (Kakarot equity derived = total equity - others) ---
  investors: [
    { name: "Kakarot SL",                role: "sponsor",     equity: null,   profitShare: 0.57 },
    { name: "Bingin SC",                 role: "investor",    equity: 450000, profitShare: 0.41 },
    { name: "Bingin SC (free shares)",   role: "free-shares", equity: 0,      profitShare: 0.01 },
    { name: "Lili One SC (free shares)", role: "free-shares", equity: 0,      profitShare: 0.01 },
  ],
};
