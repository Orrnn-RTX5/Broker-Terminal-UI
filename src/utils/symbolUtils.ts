/**
 * Utility functions for symbol formatting and calculations
 */

/**
 * Returns the standard number of decimal digits for a given symbol
 * Pairs with JPY typically have 3 digits, most others have 5.
 * Crypto varies but typical defaults apply.
 */
export function getSymbolDigits(symbol: string): number {
  if (!symbol) return 5;
  const sym = symbol.toUpperCase();
  if (sym.includes('JPY')) return 3;
  if (sym.includes('BTC') || sym.includes('ETH')) return 2;
  if (sym.includes('XAU') || sym.includes('XAG') || sym.includes('XPT') || sym.includes('XPD')) return 2;
  if (sym.includes('NAS') || sym.includes('SPX') || sym.includes('DJ') || sym.includes('US30') || sym.includes('US500') || sym.includes('NDX')) return 2;
  // Default to 5 digits for standard forex pairs (e.g. EURUSD, GBPUSD)
  return 5;
}

/**
 * Formats a price value to the correct number of decimal places for a given symbol.
 * If exact digits are known, they can be provided to override the symbol lookup.
 */
export function formatPrice(price: number, symbolOrDigits?: string | number): string {
  if (typeof price !== 'number' || isNaN(price)) return '0.00000';
  
  let digits = 5;
  
  if (typeof symbolOrDigits === 'number') {
    digits = symbolOrDigits;
  } else if (typeof symbolOrDigits === 'string') {
    digits = getSymbolDigits(symbolOrDigits);
  }
  
  return price.toFixed(digits);
}

/**
 * Parses a string value into a number safely.
 */
export function parsePrice(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
