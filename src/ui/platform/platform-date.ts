import type { SupportedLocale } from "@/i18n/config";

export function formatPlatformDate(value: string | null, locale: SupportedLocale): string {
  if (value === null) return "\u2014";

  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
