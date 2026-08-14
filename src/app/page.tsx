import styles from "./page.module.css";

const capabilities = [
  {
    number: "01",
    title: "Revisa con contexto",
    description: "Cada factura conserva su documento, estado y decisión en una vista lista para operar.",
  },
  {
    number: "02",
    title: "Automatiza lo repetitivo",
    description: "El flujo OCR propone datos para que tu equipo revise excepciones, no transcriba cada campo.",
  },
  {
    number: "03",
    title: "Separa cada negocio",
    description: "Cambia de negocio sin mezclar documentos, miembros ni permisos entre espacios.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.backgroundGrid} aria-hidden="true" />

      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="LedgerHarbour, inicio">
          <span className={styles.brandMark} aria-hidden="true">LH</span>
          <span>LedgerHarbour</span>
        </a>
        <nav className={styles.nav} aria-label="Navegacion principal">
          <a href="#flujo">Como funciona</a>
          <a href="#capacidades">Capacidades</a>
          <a className={styles.navAction} href="/login">Entrar</a>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Control financiero por negocio</p>
          <h1 id="hero-title">Menos bandeja de entrada. Mas control.</h1>
          <p className={styles.heroDescription}>
            LedgerHarbour convierte facturas dispersas en decisiones claras: revisa documentos,
            automatiza la captura y trabaja con cada negocio en su propio espacio.
          </p>
          <div className={styles.actions}>
            <a className={styles.primaryAction} href="/login">Entrar al workspace <span aria-hidden="true">-&gt;</span></a>
            <a className={styles.secondaryAction} href="/register">Crear cuenta</a>
          </div>
          <p className={styles.localNote}>Demo local con datos sinteticos. Sin credenciales reales.</p>
        </div>

        <div className={styles.controlCard} aria-label="Flujo de control de una factura">
          <div className={styles.cardHeader}>
            <span>Flujo de control</span>
            <span className={styles.liveStatus}><span aria-hidden="true" /> Activo</span>
          </div>
          <div className={styles.flow}>
            <div className={styles.flowStep}>
              <span className={styles.flowIndex}>01</span>
              <div>
                <strong>Factura recibida</strong>
                <small>proveedor_abril.pdf</small>
              </div>
              <span className={styles.check} aria-label="Completado">OK</span>
            </div>
            <div className={styles.flowLine} aria-hidden="true" />
            <div className={`${styles.flowStep} ${styles.highlightedStep}`}>
              <span className={styles.flowIndex}>02</span>
              <div>
                <strong>OCR propone datos</strong>
                <small>Importe, moneda y categoria</small>
              </div>
              <span className={styles.processing}>OCR</span>
            </div>
            <div className={styles.flowLine} aria-hidden="true" />
            <div className={styles.flowStep}>
              <span className={styles.flowIndex}>03</span>
              <div>
                <strong>Lista para revisar</strong>
                <small>1 decision pendiente</small>
              </div>
              <span className={styles.pending}>01</span>
            </div>
          </div>
          <div className={styles.cardFooter}>
            <span>Negocio activo</span>
            <strong>Harbour Studio</strong>
          </div>
        </div>
      </section>

      <section className={styles.flowSection} id="flujo" aria-labelledby="flow-title">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Un flujo, no otra bandeja</p>
          <h2 id="flow-title">De documento a decision sin perder el hilo.</h2>
        </div>
        <p className={styles.sectionIntro}>
          El equipo ve que llego, que fue detectado y que necesita atencion. Cada paso deja una
          senal para que el cierre sea rapido y verificable.
        </p>
      </section>

      <section className={styles.capabilities} id="capacidades" aria-labelledby="capabilities-title">
        <div className={styles.capabilityIntro}>
          <p className={styles.eyebrow}>Hecho para operar</p>
          <h2 id="capabilities-title">La claridad que tu equipo necesita.</h2>
        </div>
        <div className={styles.capabilityList}>
          {capabilities.map((capability) => (
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
        <p>Workspace local para revisar y ordenar operaciones financieras.</p>
        <a href="/login">Abrir demo <span aria-hidden="true">-&gt;</span></a>
      </footer>
    </main>
  );
}
