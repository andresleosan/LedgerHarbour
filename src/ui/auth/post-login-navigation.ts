import { withLocale } from "../../i18n/locale";
import type { SupportedLocale } from "../../i18n/config";

export type SuccessfulLoginFlow = "googleRedirectCompletion" | "email";

interface SuccessfulLoginNavigationInput {
  flow: SuccessfulLoginFlow;
  mode: "login" | "register";
  authMode: "development" | "firebase";
  isDeterministicFirebaseTest: boolean;
  locale: SupportedLocale;
}

export function navigateAfterSuccessfulLogin(
  input: SuccessfulLoginNavigationInput,
  replace: (destination: string) => void,
): void {
  if (
    (input.flow !== "googleRedirectCompletion" && input.flow !== "email")
    || input.mode !== "login"
    || input.authMode !== "firebase"
    || input.isDeterministicFirebaseTest
  ) {
    return;
  }

  replace(withLocale("/auth/continue", "", input.locale));
}
