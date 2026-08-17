"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FirebaseClientConfig } from "@/modules/auth/firebase-config";

const FirebaseClientConfigContext = createContext<FirebaseClientConfig | undefined>(undefined);

export function useOnboardingFirebaseConfig(): FirebaseClientConfig | undefined {
  return useContext(FirebaseClientConfigContext);
}

export default function OnboardingFirebaseConfigProvider({
  config,
  children,
}: {
  config?: FirebaseClientConfig;
  children: ReactNode;
}) {
  return (
    <FirebaseClientConfigContext.Provider value={config}>
      {children}
    </FirebaseClientConfigContext.Provider>
  );
}
