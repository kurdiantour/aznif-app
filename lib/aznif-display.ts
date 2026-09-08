export const AZNIF_DISPLAY_SCALE = 1_000;

export type DisplayCurrency =
  | "aznif"
  | "mc"
  | "MC"
  | "coin"
  | "Coin"
  | "gem"
  | "Gem";

export function toDisplayedAznif(rawAmount: number): number {
  return Math.round(rawAmount * AZNIF_DISPLAY_SCALE);
}

export function formatAznif(rawAmount: number, locale = "en-US"): string {
  return toDisplayedAznif(rawAmount).toLocaleString(locale);
}

export function formatCurrencyAmount(
  rawAmount: number,
  currency: DisplayCurrency,
  locale = "en-US",
): string {
  const normalizedCurrency = currency.toLowerCase();

  return normalizedCurrency === "aznif" || normalizedCurrency === "mc"
    ? formatAznif(rawAmount, locale)
    : rawAmount.toLocaleString(locale);
}
