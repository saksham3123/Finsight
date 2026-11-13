/**
 * The next `days` trading dates after `lastDate` (YYYY-MM-DD), for drawing a forecast box.
 * Stocks skip weekends (exchange holidays are ignored, so the box can end a day early around a
 * holiday); crypto trades every day.
 */
export function futureDates(lastDate, days, assetType) {
  const dates = [];
  const d = new Date(`${lastDate}T00:00:00Z`);
  while (dates.length < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (assetType === "crypto" || (weekday !== 0 && weekday !== 6)) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** True when an advisory carries a usable range forecast. */
export const hasRange = (a) => a?.priceLow != null && a?.priceHigh != null && a?.horizonDays != null;

/** Forecast prop for TrendChart from an advisory and the chart's last date. */
export function chartForecast(advisory, lastDate, assetType) {
  if (!hasRange(advisory) || !lastDate) return null;
  return {
    low: advisory.priceLow,
    high: advisory.priceHigh,
    dates: futureDates(lastDate, advisory.horizonDays, assetType),
    label: `${Math.round(advisory.rangeLevel * 100)}% range`,
  };
}
