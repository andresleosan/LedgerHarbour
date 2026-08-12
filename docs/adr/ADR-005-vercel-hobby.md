# ADR-005: Vercel Hobby para Hosting del Prototipo

Fecha: 2026-08-12  
Estado: propuesta; no despliega por si sola

## Contexto

La aplicación ya es Next.js y necesita una forma reversible de probarla con bajo consumo sin administrar servidores.

## Decisión

Usar Vercel Hobby solo para el prototipo no comercial, con variables de entorno gestionadas en el proyecto y preview deployments protegidos.

## Alternativas consideradas

- Firebase App Hosting: puede requerir billing y añade acoplamiento con Google Cloud.
- VPS: costo y operación permanente desproporcionados para tráfico bajo.

## Consecuencias

La integración y los previews son rápidos y reversibles. Hobby no debe interpretarse como hosting comercial; funciones dinámicas, almacenamiento efímero y limites de uso requieren PostgreSQL/R2 externos y revisión antes de cualquier exposición pública.
