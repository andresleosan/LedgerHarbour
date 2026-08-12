export const defaultCurrencySeed = {
  name: "British Pound",
  isoCode: "GBP",
  symbol: "GBP",
  decimalCount: 2,
  isStandard: true,
} as const;

export const standardCurrencySeeds = [
  defaultCurrencySeed,
  { name: "Euro", isoCode: "EUR", symbol: "EUR", decimalCount: 2, isStandard: true },
  { name: "US Dollar", isoCode: "USD", symbol: "USD", decimalCount: 2, isStandard: true },
] as const;

export const defaultCategorySeeds = [
  { name: "Office expenses" },
  { name: "Travel" },
  { name: "Utilities" },
  { name: "Professional services" },
  { name: "Other expenses" },
] as const;
