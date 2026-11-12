// One "Month" filter for transactions: values are "YYYY-MM", "" means all time.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

export function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Every month of the years that have transactions, newest first, starting
 * from the current month (later months of this year haven't happened yet).
 */
export function monthOptions(years: number[], now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const allYears = Array.from(new Set([...years, currentYear])).sort((a, b) => b - a);
  const options: { value: string; label: string }[] = [];
  for (const year of allYears) {
    const last = year === currentYear ? currentMonth : 12;
    for (let month = last; month >= 1; month--) {
      const value = `${year}-${pad(month)}`;
      options.push({ value, label: monthLabel(value) });
    }
  }
  return options;
}

/** First and last day of a "YYYY-MM" month, as YYYY-MM-DD. */
export function monthRange(value: string) {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: `${year}-${pad(month)}-01`,
    dateTo: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** The month a date range covers exactly, or "" when it isn't one whole month. */
export function monthOfRange(dateFrom?: string | null, dateTo?: string | null) {
  const value = String(dateFrom || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(value)) return "";
  const range = monthRange(value);
  return range.dateFrom === dateFrom && range.dateTo === dateTo ? value : "";
}
