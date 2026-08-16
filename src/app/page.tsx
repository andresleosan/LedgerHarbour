import { defaultLocale, messages, type SupportedLocale } from "@/i18n/config";

import styles from "./page.module.css";

type HomeProps = {
  searchParams?: Promise<{ locale?: string }>;
};

function resolveLocale(value: string | undefined): SupportedLocale {
  return value === "es" ? "es" : defaultLocale;
}

function localizedPath(path: string, locale: SupportedLocale): string {
  return `${path}${path.includes("?") ? "&" : "?"}locale=${locale}`;
}

function localizedSection(section: string, locale: SupportedLocale): string {
  return `/?locale=${locale}#${section}`;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const locale = resolveLocale(params?.locale);
  const copy = messages[locale].landing;

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGrid} aria-hidden="true" />

      <header className={styles.header}>
        <a className={styles.brand} href={localizedPath("/", locale)} aria-label="LedgerHarbour, inicio">
          <span className={styles.brandMark} aria-hidden="true">LH</span>
          <span>LedgerHarbour</span>
        </a>
        <nav className={styles.nav} aria-label={copy.languageLabel}>
          <a href={localizedSection("flujo", locale)}>{copy.nav.howItWorks}</a>
          <a href={localizedSection("capacidades", locale)}>{copy.nav.capabilities}</a>
          <div className={styles.localeNav} aria-label={copy.languageLabel}>
            <a className={styles.localeLink} aria-current={locale === "en" ? "page" : undefined} href="/?locale=en">EN</a>
            <a className={styles.localeLink} aria-current={locale === "es" ? "page" : undefined} href="/?locale=es">ES</a>
          </div>
          <a className={styles.navAction} href={localizedPath("/login", locale)}>{copy.nav.enter}</a>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="hero-title">{copy.heroTitle}</h1>
          <p className={styles.heroDescription}>
            {copy.heroDescription}
          </p>
          <div className={styles.actions}>
            <a className={styles.primaryAction} href={localizedPath("/login", locale)}>{copy.primaryAction} <span aria-hidden="true">-&gt;</span></a>
            <a className={styles.secondaryAction} href={localizedPath("/register", locale)}>{copy.secondaryAction}</a>
          </div>
          <p className={styles.localNote}>{copy.localNote}</p>
        </div>

        <div className={styles.controlCard} aria-label={copy.flowAriaLabel}>
          <div className={styles.cardHeader}>
            <span>{copy.flowTitle}</span>
            <span className={styles.liveStatus}><span aria-hidden="true" /> {copy.active}</span>
          </div>
          <div className={styles.flow}>
            <div className={styles.flowStep}>
              <span className={styles.flowIndex}>01</span>
              <div>
                <strong>{copy.received}</strong>
                <small>{copy.receivedFile}</small>
              </div>
              <span className={styles.check} aria-label={copy.completed}>OK</span>
            </div>
            <div className={styles.flowLine} aria-hidden="true" />
            <div className={`${styles.flowStep} ${styles.highlightedStep}`}>
              <span className={styles.flowIndex}>02</span>
              <div>
                <strong>{copy.ocrProposes}</strong>
                <small>{copy.ocrDetails}</small>
              </div>
              <span className={styles.processing}>OCR</span>
            </div>
            <div className={styles.flowLine} aria-hidden="true" />
            <div className={styles.flowStep}>
              <span className={styles.flowIndex}>03</span>
              <div>
                <strong>{copy.readyToReview}</strong>
                <small>{copy.pendingDecision}</small>
              </div>
              <span className={styles.pending}>01</span>
            </div>
          </div>
          <div className={styles.cardFooter}>
            <span>{copy.activeBusiness}</span>
            <strong>{copy.businessName}</strong>
          </div>
        </div>
      </section>

      <section className={styles.flowSection} id="flujo" aria-labelledby="flow-title">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>{copy.flowEyebrow}</p>
          <h2 id="flow-title">{copy.flowHeading}</h2>
        </div>
        <p className={styles.sectionIntro}>{copy.flowDescription}</p>
      </section>

      <section className={styles.capabilities} id="capacidades" aria-labelledby="capabilities-title">
        <div className={styles.capabilityIntro}>
          <p className={styles.eyebrow}>{copy.capabilitiesEyebrow}</p>
          <h2 id="capabilities-title">{copy.capabilitiesHeading}</h2>
        </div>
        <div className={styles.capabilityList}>
          {copy.capabilities.map((capability) => (
            <article className={styles.capability} key={capability.number}>
              <span className={styles.capabilityNumber}>{capability.number}</span>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <div>
          <span className={styles.brandMark} aria-hidden="true">LH</span>
          <strong>LedgerHarbour</strong>
        </div>
        <p>{copy.footerDescription}</p>
        <a href={localizedPath("/login", locale)}>{copy.openDemo} <span aria-hidden="true">-&gt;</span></a>
      </footer>
    </main>
  );
}
