"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AUTH_ERROR_CODES, AuthError, toAuthError } from "@/modules/auth/auth-errors";
import {
  createAuthProviderFromActions,
  type AuthProvider,
  type AuthProviderActions,
} from "@/modules/auth/auth-provider";
import {
  getFirebaseGoogleRedirectResult,
  signInWithFirebaseCredential,
  signInWithFirebaseEmail,
  signInWithFirebaseGoogle,
  signOutFirebaseUser,
  type FirebaseClientConfig,
} from "@/modules/auth/firebase-client";
import { messages, type SupportedLocale } from "@/i18n/config";

type AuthFormMode = "login" | "register";
type Feedback = { type: "signedIn" | "created"; email: string } | null;
type ErrorKey = "invalidEmail" | "missingIdentity" | "providerError" | "developmentUnavailable";

interface AuthFormProps {
  mode: AuthFormMode;
  providerActions: AuthProviderActions;
  authMode?: "development" | "firebase";
  firebaseConfig?: FirebaseClientConfig;
}

const interpolate = (message: string, email: string) => message.replace("{email}", email);

export default function AuthForm({ mode, providerActions, authMode = "firebase", firebaseConfig }: AuthFormProps) {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [provider] = useState<AuthProvider>(() => createAuthProviderFromActions(providerActions));
  const firebaseGoogleCompletionStarted = useRef(false);
  const router = useRouter();
  const copy = messages[locale].auth;
  const isLogin = mode === "login";
  const loginCopy = copy.login;
  const registerCopy = copy.register;
  const authCopy = isLogin ? loginCopy : registerCopy;
  const isFirebase = authMode === "firebase";
  const isDeterministicFirebaseTest = isFirebase && process.env.NEXT_PUBLIC_FIREBASE_TEST_ADAPTER === "true";

  useEffect(() => {
    if (!isFirebase || !isLogin || !firebaseConfig) return;
    let cancelled = false;

    void getFirebaseGoogleRedirectResult(firebaseConfig)
      .then(async (firebaseCredential) => {
        if (!firebaseCredential || cancelled) return;
        if (firebaseGoogleCompletionStarted.current) return;
        firebaseGoogleCompletionStarted.current = true;
        const identity = await signInWithFirebaseCredential(firebaseCredential, provider.signInWithGoogle);
        if (cancelled) return;
        if (!identity) {
          firebaseGoogleCompletionStarted.current = false;
          setErrorKey("missingIdentity");
          return;
        }
        setFeedback({ type: "signedIn", email: identity.email });
        if (!isDeterministicFirebaseTest) router.replace("/onboarding");
      })
      .catch((error) => {
        if (!cancelled) {
          firebaseGoogleCompletionStarted.current = false;
          toAuthError(error);
          setErrorKey("providerError");
        }
      });

    return () => { cancelled = true; };
  }, [firebaseConfig, isFirebase, isLogin, provider, router]);

  const clearFeedback = () => {
    setFeedback(null);
    setErrorKey(null);
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();

    try {
      if (isFirebase && !firebaseConfig) throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE);
      const firebaseCredential = isFirebase
        ? await signInWithFirebaseEmail(firebaseConfig!, email, password, !isLogin)
        : null;
      const identity = await provider.signInWithEmail({
        email: firebaseCredential?.user.email ?? email,
        idToken: firebaseCredential ? await firebaseCredential.user.getIdToken() : undefined,
      });

      if (!identity) {
        setErrorKey("missingIdentity");
        return;
      }

      if (!isLogin) await provider.signOut();

      setFeedback({ type: isLogin ? "signedIn" : "created", email: identity.email });
      if (isFirebase && isLogin && !isDeterministicFirebaseTest) router.replace("/onboarding");
    } catch (error) {
      const authError = toAuthError(error);
      setErrorKey(
        authError.code === AUTH_ERROR_CODES.INVALID_EMAIL
          ? "invalidEmail"
          : authError.code === AUTH_ERROR_CODES.MISSING_IDENTITY
            ? "missingIdentity"
          : "providerError",
      );
    } finally {
      if (!isLogin && isFirebase && firebaseConfig) {
        try {
          await signOutFirebaseUser(firebaseConfig);
        } catch (error) {
          setFeedback(null);
          toAuthError(error);
          setErrorKey("providerError");
        }
      }
    }
  };

  const handleGoogleSignIn = async () => {
    clearFeedback();

    try {
      if (isFirebase && !firebaseConfig) throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE);
      if (isFirebase) {
        const firebaseCredential = await signInWithFirebaseGoogle(firebaseConfig!);
        if (firebaseGoogleCompletionStarted.current) return;
        firebaseGoogleCompletionStarted.current = true;
        const identity = await signInWithFirebaseCredential(firebaseCredential, provider.signInWithGoogle);
        if (!identity) {
          firebaseGoogleCompletionStarted.current = false;
          setErrorKey("missingIdentity");
          return;
        }
        setFeedback({ type: "signedIn", email: identity.email });
        if (!isDeterministicFirebaseTest) router.replace("/onboarding");
        return;
      }
      const identity = await provider.signInWithGoogle();

      if (!identity) {
        setErrorKey("missingIdentity");
        return;
      }
      setFeedback({ type: "signedIn", email: identity.email });
      if (isFirebase) router.replace("/onboarding");
    } catch (error) {
      if (isFirebase) firebaseGoogleCompletionStarted.current = false;
      toAuthError(error);
      setErrorKey("providerError");
    }
  };

  return (
    <main className="auth-page">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8f4ec; color: #10283d; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        a { color: inherit; }
        .auth-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 15% 10%, rgba(49, 154, 145, .16), transparent 32%), #f8f4ec; }
        .auth-shell { width: min(100%, 1080px); min-height: 650px; display: grid; grid-template-columns: .9fr 1.1fr; overflow: hidden; border: 1px solid #d8ded8; border-radius: 28px; background: #fffdf8; box-shadow: 0 24px 70px rgba(16, 40, 61, .12); }
         .auth-aside { display: flex; flex-direction: column; justify-content: space-between; padding: 42px; background: #10283d; color: #f8f4ec; }
         .aside-top { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
          .brand { display: block; width: fit-content; }
          .brand-logo { display: block; width: 180px; height: 120px; object-fit: contain; }
         .home-link { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(101, 198, 186, .7); border-radius: 10px; color: #65c6ba; transition: background-color .18s ease, color .18s ease; }
         .home-link:hover { background: #65c6ba; color: #10283d; }
         .home-link svg { width: 19px; height: 19px; }
        .aside-note { max-width: 260px; color: #c6d5d5; font-size: .95rem; line-height: 1.65; }
        .aside-rule { width: 70px; height: 4px; margin-bottom: 22px; border-radius: 99px; background: #e47d6c; }
        .auth-panel { padding: 42px clamp(26px, 6vw, 74px); }
        .auth-toolbar { display: flex; justify-content: flex-end; align-items: center; gap: 12px; color: #4c6270; font-size: .8rem; }
        .locale-button { border: 0; border-radius: 7px; padding: 6px 7px; background: transparent; color: #4c6270; cursor: pointer; font: inherit; font-weight: 650; }
        .locale-button[aria-pressed="true"] { background: #d9eeea; color: #0b6663; }
        .auth-content { max-width: 480px; margin: 74px auto 0; }
        .eyebrow { margin: 0 0 14px; color: #0b7772; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
        h1 { max-width: 450px; margin: 0; color: #10283d; font-size: clamp(2.1rem, 5vw, 3.8rem); line-height: 1.03; letter-spacing: -.055em; }
        .description { max-width: 450px; margin: 20px 0 34px; color: #536572; font-size: 1rem; line-height: 1.65; }
        .auth-form { display: grid; gap: 12px; }
        label { color: #263f50; font-size: .86rem; font-weight: 750; }
        input { width: 100%; min-height: 50px; margin-top: 7px; padding: 0 15px; border: 1px solid #aabbb9; border-radius: 10px; background: #fff; color: #10283d; font: inherit; font-size: 1rem; }
        input[aria-invalid="true"] { border-color: #bb584b; }
        button, .secondary-link { min-height: 48px; border-radius: 10px; font: inherit; font-weight: 750; cursor: pointer; }
        .primary-button { border: 1px solid #0b7772; background: #0b7772; color: #fff; }
        .primary-button:hover { background: #095f5b; }
        .google-button { position: relative; border: 1px solid #aabbb9; background: #fffdf8; color: #173348; }
        .google-button:hover { border-color: #0b7772; background: #f1faf7; }
        .divider { display: flex; align-items: center; gap: 12px; margin: 12px 0; color: #73838a; font-size: .75rem; }
        .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: #d8ded8; }
        .feedback { margin: 16px 0 0; color: #0b6663; font-size: .86rem; line-height: 1.45; }
        .error { margin: 4px 0 0; color: #913f35; font-size: .84rem; line-height: 1.4; }
        .auth-footer { margin-top: 30px; color: #536572; font-size: .86rem; }
        .auth-footer a { color: #0b6663; font-weight: 750; text-decoration-thickness: 2px; text-underline-offset: 3px; }
        button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #e47d6c; outline-offset: 3px; }
        @media (max-width: 720px) {
          .auth-page { padding: 0; align-items: stretch; }
          .auth-shell { min-height: 100vh; grid-template-columns: 1fr; border: 0; border-radius: 0; box-shadow: none; }
          .auth-aside { min-height: 170px; padding: 28px 24px; }
          .aside-note { display: none; }
           .auth-panel { padding: 24px; }
           .brand-logo { width: 150px; height: 100px; }
          .auth-content { margin-top: 54px; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>
      <section className="auth-shell" aria-labelledby="auth-title">
         <aside className="auth-aside">
           <div className="aside-top">
              <div className="brand"><img className="brand-logo" src="/brand/ledgerharbour-logo.png" alt="LedgerHarbour" width={180} height={120} /></div>
             <Link className="home-link" href="/" aria-label={copy.login.homeLabel}>
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                 <path d="m3 10 9-7 9 7" />
                 <path d="M5 9.5V21h14V9.5M9 21v-6h6v6" />
               </svg>
             </Link>
           </div>
          <div>
            <div className="aside-rule" />
            <p className="aside-note">{copy.asideNote}</p>
          </div>
        </aside>
        <section className="auth-panel">
          <div className="auth-toolbar" aria-label={copy.languageLabel}>
            <span>{copy.languageLabel}</span>
            {(["en", "es"] as const).map((candidate) => (
              <button
                className="locale-button"
                key={candidate}
                type="button"
                aria-pressed={locale === candidate}
                onClick={() => setLocale(candidate)}
              >
                {candidate === "en" ? copy.localeEnglish : copy.localeSpanish}
              </button>
            ))}
          </div>
          <div className="auth-content">
            <p className="eyebrow">{authCopy.eyebrow}</p>
            <h1 id="auth-title">{authCopy.title}</h1>
            <p className="description">{authCopy.description}</p>
             <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
              <label htmlFor="email">{authCopy.emailLabel}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder={authCopy.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={errorKey === "invalidEmail"}
                aria-describedby={errorKey ? "auth-error" : undefined}
              />
              {isFirebase && (
                <label htmlFor="password">
                  Password
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              )}
              {errorKey && <p id="auth-error" className="error" role="alert">{copy[errorKey]}</p>}
              <button className="primary-button" type="submit">{authCopy.emailAction}</button>
            </form>
            {isLogin && (
              <>
                <div className="divider">{copy.separator}</div>
                <button className="google-button" type="button" onClick={handleGoogleSignIn}>
                   {loginCopy.googleAction}
                 </button>
               </>
            )}
            {feedback && (
              <p className="feedback" role="status" aria-live="polite">
                {interpolate(isLogin ? copy.login.signedIn : copy.register.created, feedback.email)}
              </p>
            )}
            <p className="auth-footer">
              {isLogin ? copy.login.registerPrompt : copy.register.loginPrompt}{" "}
              <Link href={isLogin ? "/register" : "/login"}>
                {isLogin ? copy.login.registerAction : copy.register.loginAction}
              </Link>
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
