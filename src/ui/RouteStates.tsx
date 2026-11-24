"use client";

import { useSearchParams } from "next/navigation";

const styles = `.route-state{display:grid;gap:14px;width:min(100%,980px);margin:0 auto}.route-skeleton{height:18px;border-radius:9px;background:linear-gradient(90deg,#e4ece9 0,#f3f7f5 50%,#e4ece9 100%);background-size:200% 100%;animation:route-shimmer 1.2s ease-in-out infinite}.route-skeleton-hero{height:150px;border-radius:16px}.route-skeleton-row{height:64px;border-radius:12px}@keyframes route-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}.route-error{padding:clamp(22px,4vw,34px);border:1px solid #e1b9a8;border-radius:16px;background:#fff6ef;color:#6e382f}.route-error h1{margin:0 0 8px;color:#17313b;font-size:clamp(1.4rem,4vw,2rem)}.route-error p{margin:0 0 16px;line-height:1.55}.route-error button{min-height:44px;border:1px solid #0b7772;border-radius:9px;padding:0 16px;background:#0b7772;color:#fff;cursor:pointer;font:inherit;font-weight:800}.route-error button:focus-visible{outline:3px solid #8b452f;outline-offset:3px}@media(prefers-reduced-motion:reduce){.route-skeleton{animation:none}}`;

function useSpanish() {
  return useSearchParams()?.get("locale") === "es";
}

export function RouteLoading() {
  const es = useSpanish();
  return (
    <div className="route-state" role="status" aria-live="polite">
      <style>{styles}</style>
      <span className="sr-only">{es ? "Cargando…" : "Loading…"}</span>
      <div className="route-skeleton route-skeleton-hero" aria-hidden="true" />
      <div className="route-skeleton" style={{ width: "40%" }} aria-hidden="true" />
      <div className="route-skeleton route-skeleton-row" aria-hidden="true" />
      <div className="route-skeleton route-skeleton-row" aria-hidden="true" />
    </div>
  );
}

export function RouteError({ reset }: { reset: () => void }) {
  const es = useSpanish();
  return (
    <section className="route-state" aria-labelledby="route-error-title">
      <style>{styles}</style>
      <div className="route-error" role="alert">
        <h1 id="route-error-title">{es ? "No se pudo cargar esta página" : "This page could not load"}</h1>
        <p>{es ? "No se ha perdido nada de lo que ya guardaste. Vuelve a intentarlo; si sigue fallando, recarga la página." : "Nothing you already saved is lost. Try again; if it keeps failing, reload the page."}</p>
        <button type="button" onClick={reset}>{es ? "Reintentar" : "Try again"}</button>
      </div>
    </section>
  );
}
