import { defaultLocale, type SupportedLocale } from "./config";

export function resolveLocale(value: string | null | undefined): SupportedLocale {
  return value === "es" ? "es" : defaultLocale;
}

export function withLocale(
  path: string,
  current: URLSearchParams | string,
  locale: SupportedLocale,
): string {
  const params = typeof current === "string"
    ? new URLSearchParams(current)
    : new URLSearchParams(current.toString());
  params.set("locale", locale);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
