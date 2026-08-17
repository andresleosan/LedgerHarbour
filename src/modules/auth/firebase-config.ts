export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export function getFirebaseClientConfig(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig | undefined {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID;
  return apiKey && authDomain && projectId && appId ? { apiKey, authDomain, projectId, appId } : undefined;
}
