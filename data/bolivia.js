// Bolivia — old fisherman's house in Pedregalejo, 50m from the sea.
// Renovate + split into studio (ground floor) + duplex (top, 2 terraces).
// Long-term rental for now; touristic licence is the upside scenario.
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("bolivia");

window.OPPORTUNITIES["bolivia"] = {
  name: "Bolivia",
  address: "Calle Bolivia 276, Pedregalejo, Málaga",
  status: "Property acquired",
  projectType: "rental",

  // ====== PROPERTY ======
  property: {
    typology: "Casa de pescadores (renovación + split)",
    totalSqm: 183,
    units: [
      { name: "Studio (ground floor)",        sqm: 60,  monthlyRent: 1500 },
      { name: "Duplex (top floor, 2 terraces)", sqm: 123, monthlyRent: 3000 },
    ],
  },

  // ====== ACQUISITION ======
  // Sadala pays ITP + notary; bank covers the purchase price itself.
  acquisition: {
    purchasePrice: 570000,
    landTaxRegime: "ITP",   // second-hand residential in Andalucía
    landTaxRate: 0.07,
    notary: 2200,           // fixed (consistent with other projects)
    agencyCommissionRate: 0,
  },

  // ====== RENOVATION ======
  // ~€1,000/sqm × 183 m² = €183,000 base + 5% contingencies.
  renovation: {
    costPerSqm: 1000,
    contingenciesRate: 0.05,
    durationMonths: 6,      // estimate; adjust when we have a builder timeline
  },

  // ====== BANK FINANCING ======
  // Loan = 50% × (purchase price + renovation total), excluding notary/other costs.
  // Notary, ITP, agency fees and any other acquisition costs are paid by Sadala.
  financing: {
    ltcRate: 0.50,             // 50% of (acquisition + reno)
    interestRate: 0.045,       // 4.5%
    termYears: 20,             // 20-year amortization
    amortizationStyle: "french",
  },

  // ====== RENTAL OPERATIONS ======
  rental: {
    inflationRate: 0.02,                                 // applied to rents and OpEx
    otherIncomeRate: 0.10,                               // tenant pays 10% of misc expenses (added to revenue)
    // Vacancy: 25% Y1, ramping down to 20% by Y3, then steady.
    vacancySchedule: [0.25, 0.22, 0.20, 0.20, 0.20, 0.20],
    operatingExpenses: {
      // Marketing and Management removed per Apr 2026 update.
      salaries:     0.04,
      maintenance:  0.06,
      ibiInsurance: 0.10,
      agency:       0.05,      // agency commission for finding tenants — % of PGI
    },
    capexRate: 0.01,           // CapEx reserve, % of PGI (separate from OpEx)
    holdYears: 5,
    capitalGrowthRate: 0.01,
    saleCommissionRate: 0.05,
    exitCapRate: 0.0692,
  },

  taxRate: 0.25,
  projectDurationMonths: 60,

  // ====== SCENARIOS ======
  // Worst: stable long-term rental, slightly weaker than current ask, higher vacancy.
  // Base:  current rents (1500 + 3000), screenshot vacancy schedule.
  // Best:  touristic licence obtained → rents +50%, vacancy floor lower.
  scenarios: {
    worst: { rentMultiplier: 0.85, vacancyAdjust: +0.05, note: "Below-market rents, higher vacancy" },
    base:  { rentMultiplier: 1.00, vacancyAdjust:  0,    note: "Long-term rental, current rents" },
    best:  { rentMultiplier: 2.00, vacancyAdjust: -0.02, note: "Touristic licence Y2+, rents ×2" },
  },

  // ====== TIMELINE ======
  timeline: [
    { id: "acquired",     label: "Property signed",  date: "2026-04", status: "done" },
    { id: "reno-start",   label: "Renovation start", date: "2026-05", status: "expected" },
    { id: "reno-end",     label: "Renovation end",   offsetFrom: "reno-start", offsetMonths: 6,  status: "expected" },
    { id: "rental-start", label: "First tenants",    offsetFrom: "reno-end",   offsetMonths: 1,  status: "expected" },
    { id: "exit",         label: "Exit / refinance", offsetFrom: "rental-start", offsetMonths: 60, status: "expected" },
  ],

  // ====== CAP TABLE ======
  // Single sponsor for now — equity is small (just ITP + notary).
  investors: [
    { name: "Sadala SL", role: "sponsor", equity: null, profitShare: 1.00 },
  ],
};
