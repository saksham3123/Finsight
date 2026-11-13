// Mock IPO calendar. Dates are relative to today so the list never goes stale.

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

export const IPOS = [
  { name: "Northwind Renewables", sector: "Energy", priceBand: "₹312 – ₹328", lotSize: 45, opens: day(-1), closes: day(2), status: "Open", subscription: 3.4 },
  { name: "Saffron Foods", sector: "FMCG", priceBand: "₹96 – ₹102", lotSize: 145, opens: day(0), closes: day(3), status: "Open", subscription: 1.1 },
  { name: "Kavach Cyber", sector: "IT", priceBand: "₹540 – ₹568", lotSize: 26, opens: day(5), closes: day(8), status: "Upcoming", subscription: null },
  { name: "Meridian Logistics", sector: "Logistics", priceBand: "₹205 – ₹216", lotSize: 69, opens: day(9), closes: day(12), status: "Upcoming", subscription: null },
  { name: "Aarogya Diagnostics", sector: "Healthcare", priceBand: "₹415 – ₹437", lotSize: 34, opens: day(-12), closes: day(-9), status: "Listed", subscription: 22.8, listingGain: 18.6 },
  { name: "Urban Nest Homes", sector: "Real Estate", priceBand: "₹178 – ₹187", lotSize: 80, opens: day(-20), closes: day(-17), status: "Listed", subscription: 4.2, listingGain: -6.3 },
];
