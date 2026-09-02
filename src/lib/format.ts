/**
 * Shared display formatting. Not a full i18n layer — just the handful of
 * things every money-and-date screen in this app needs, kept in one place so
 * "how do we show a balance" has one answer.
 */

export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // An unrecognised currency code would throw inside Intl.NumberFormat.
    // The database only constrains the SHAPE (3 letters), not a known-ISO
    // list, so this fallback keeps a typo'd code from crashing the page.
    return `${amount.toLocaleString()} ${currency}`;
  }
}

export function formatResetTime(time: string): string {
  // "HH:MM:SS" from Postgres -> "HH:MM" for display.
  return time.slice(0, 5);
}
