import enMessages from "./messages/en.json";
import esMessages from "./messages/es.json";

export type SupportedLocale = "en" | "es";

export const supportedLocales = ["en", "es"] as const satisfies readonly SupportedLocale[];
export const defaultLocale: SupportedLocale = "en";

export const messages = {
  en: enMessages,
  es: esMessages,
} as const;

export type AuthMessages = typeof enMessages;
export { enMessages, esMessages };
