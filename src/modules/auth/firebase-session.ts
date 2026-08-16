import { cookies } from "next/headers";

export const FIREBASE_SESSION_COOKIE = "ledgerharbour_firebase_session";
export const FIREBASE_SESSION_MAX_AGE = 5 * 24 * 60 * 60;

export interface FirebaseSessionStore {
  set(value: string): Promise<void>;
  get(): Promise<string | null>;
  clear(): Promise<void>;
}

export const firebaseSessionStore: FirebaseSessionStore = {
  async set(value) {
    (await cookies()).set(FIREBASE_SESSION_COOKIE, value, {
      httpOnly: true,
      maxAge: FIREBASE_SESSION_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  },
  async get() {
    return (await cookies()).get(FIREBASE_SESSION_COOKIE)?.value ?? null;
  },
  async clear() {
    (await cookies()).delete(FIREBASE_SESSION_COOKIE);
  },
};
