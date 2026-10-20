// Running total under the Weights form: category weights plus the final exam must reach 100.

export function isCompleteTotal(total: number): boolean {
  return Math.abs(total - 100) <= 0.001;
}

// "Total: 95% of 100%. 5% left." Rounded to 2 decimals without trailing zeros, so
// 33.33 + 33.33 + 33.34 reads as 100, not 99.99999999999999.
export function weightTotalMessage(total: number): string {
  const safeTotal = Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
  const prefix = `Total: ${safeTotal}% of 100%.`;
  if (isCompleteTotal(safeTotal)) {
    return `${prefix} Adds up.`;
  }
  const difference = Math.round(Math.abs(100 - safeTotal) * 100) / 100;
  return safeTotal < 100 ? `${prefix} ${difference}% left.` : `${prefix} ${difference}% over.`;
}
