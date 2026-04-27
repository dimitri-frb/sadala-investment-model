// Bolivia — old fisherman's house in Pedregalejo, 50m from the sea.
// Renovate + split into studio (ground floor) + duplex (top, 2 terraces).
// Long-term rental for now; touristic licence is the upside scenario.
window.OPPORTUNITIES = window.OPPORTUNITIES || {};
window.OPPORTUNITY_ORDER = window.OPPORTUNITY_ORDER || [];
window.OPPORTUNITY_ORDER.push("bolivia");

window.OPPORTUNITIES["bolivia"] = {
  name: "Bolivia",
  address: "Calle Bolivia 276, Pedregalejo, Málaga",
  status: "Offer sent",
  projectType: "rental",
  stage: "offer-sent",
  dealType: "buy-to-rent",

  // ====== PROPERTY ======
  // Old fisherman's house split into 6 studios (~30 m² each). Hybrid rental:
  //   - Long-term (Oct–Jun, 9 mo): €800/mo per studio × 85% occupancy
  //   - Short-term (Jul–Sep, 3 mo): €200/night × 70% occupancy
  // Per studio: €6,120 LT + €12,600 ST = €18,720/yr
  // 6 studios: €112,320/yr blended revenue.
  property: {
    typology: "Casa de pescadores → 6 studios (hybrid rental)",
    totalSqm: 183,
    units: (() => {
      const seasons = [
        { label: "Long-term (Oct–Jun)",  months: 9, monthlyRent: 800,  occupancyRate: 0.85, commissionRate: 0.05, note: "Local management 5%" },
        { label: "Short-term (Jul–Sep)", months: 3, nightlyRate: 200,                       occupancyRate: 0.70, commissionRate: 0.38, note: "Property mgmt 20% + Airbnb 18%" },
      ];
      return Array.from({ length: 6 }, (_, i) => ({
        name: `Studio ${i + 1}`,
        sqm: 30,
        seasons,
      }));
    })(),
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
  // House was renovated 10y ago — structure / plumbing / electrical are fine.
  // Scope: windows + paint + kitchen + 2 bathrooms + wall changes for unit split.
  // €600/sqm × 183 m² = €109,800 base + 10% contingencies.
  // Furnishing is separate (mid-term rentals require furnished). Furnishing
  // is paid by equity — Spanish banks typically don't finance free-standing furniture.
  renovation: {
    costPerSqm: 600,
    contingenciesRate: 0.10,
    furnishingCost: 20000,    // one-off furnishing budget, equity-funded
    durationMonths: 6,        // estimate; adjust when we have a builder timeline
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
  // Short-term (Airbnb) operating model. Occupancy is baked into each unit's
  // expected revenue (nightlyRate × occupancyRate × 365/12 → monthlyRent),
  // so vacancySchedule is held at 0% (no double-counting). Bump it up if
  // you want to model a slow ramp during Y1.
  rental: {
    inflationRate: 0.02,
    otherIncomeRate: 0,            // short-term: cleaning fees pass through, no extra income
    vacancySchedule: [0, 0, 0, 0, 0, 0],
    operatingExpenses: {
      maintenance:  0.06,
      ibiInsurance: 0.10,
      utilities:    0.05,
      // Rental commissions are derived from each unit's seasons
      // (commissionRate per season, weighted by season revenue) and
      // injected as a synthetic OpEx line by the engine.
    },
    capexRate: 0.01,
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
    { id: "acquired",     label: "Property signed",  date: "2026-05", status: "expected" },
    { id: "reno-start",   label: "Renovation start", offsetFrom: "acquired",     offsetMonths: 1,  status: "expected" },
    { id: "reno-end",     label: "Renovation end",   offsetFrom: "reno-start",   offsetMonths: 6,  status: "expected" },
    { id: "rental-start", label: "First tenants",    offsetFrom: "reno-end",     offsetMonths: 1,  status: "expected" },
    { id: "exit",         label: "Exit / refinance", offsetFrom: "rental-start", offsetMonths: 60, status: "expected" },
  ],

  // ====== CAP TABLE ======
  // Single sponsor for now — equity is small (just ITP + notary).
  investors: [
    { name: "Sadala SL", role: "sponsor", equity: null, profitShare: 1.00 },
  ],
};
