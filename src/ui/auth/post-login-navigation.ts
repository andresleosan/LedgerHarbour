export type SuccessfulLoginFlow = "googleRedirectCompletion" | "email";

interface SuccessfulLoginNavigationInput {
  flow: SuccessfulLoginFlow;
  mode: "login" | "register";
  authMode: "development" | "firebase";
  isDeterministicFirebaseTest: boolean;
}

export function navigateAfterSuccessfulLogin(
  input: SuccessfulLoginNavigationInput,
  replace: (destination: "/auth/continue") => void,
): void {
  if (
    (input.flow !== "googleRedirectCompletion" && input.flow !== "email")
    || input.mode !== "login"
    || input.authMode !== "firebase"
    || input.isDeterministicFirebaseTest
  ) {
    return;
  }

  replace("/auth/continue");
}
