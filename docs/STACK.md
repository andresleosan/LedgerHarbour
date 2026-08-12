# LedgerHarbour Stack

## Estado

Prototipo local/no comercial. El objetivo de la siguiente fase es una prueba desplegable de bajo consumo, no una release comercial.

## Aplicacion

- Next.js 15 App Router
- TypeScript
- React 19
- Drizzle ORM
- Zod
- Vitest
- Playwright
- Monolito modular; no se separan servicios hasta que una necesidad medida lo justifique.

## Arquitectura de prototipo desplegable

- Hosting: Vercel Hobby.
- PostgreSQL: Neon Free.
- Auth: Firebase Authentication Spark.
- Storage privado: Cloudflare R2 Standard.
- OCR: Fake OCR local; proveedor externo pendiente de aprobacion.

## Costo

Objetivo inicial: `US$0/mes` mientras el proyecto sea un prototipo no comercial y permanezca dentro de las cuotas gratuitas.

| Servicio | Cuota/no-cost observada | Costo inicial estimado | Limite o alerta |
|---|---|---:|---|
| Neon Free | 0.5 GB/proyecto, 100 CU-horas, 5 GB egress | US$0 | Revisar cuotas; el plan Free no ofrece spending limit de pago |
| Firebase Auth Spark | Hasta 50.000 MAU para auth no telefonica | US$0 | Phone Auth cobra por SMS; revisar cuotas y billing antes de activar Blaze |
| Cloudflare R2 Standard | 10 GB-month, 1M Class A, 10M Class B; egress sin cargo | US$0 | Configurar alertas de cuenta; sobrecuota pasa a cobro |
| Vercel Hobby | Cuotas gratuitas de requests, funciones y transferencia | US$0 | Solo prototipo/no comercial; revisar limites y suspension antes de publicar |
| OCR real | No integrado | US$0 ahora | Requiere cotizacion, limite de gasto y fallback antes de integrarse |

Las cuotas y precios cambian. Antes de crear cuentas o activar billing se debe volver a verificar la pagina oficial del proveedor y obtener confirmacion del operador.

## Datos y persistencia

La aplicacion migra los repositorios in-memory a PostgreSQL mediante adaptadores Drizzle. El esquema relacional existente en `src/db/schema` y `src/db/migrations/0001_initial.sql` es la fuente inicial, sujeto a validacion contra PostgreSQL real.

El storage de documentos se migra por separado a R2; las claves de objetos permanecen privadas y nunca forman parte de DTOs publicos.

## Seguridad y produccion

- Firebase reemplaza el provider de desarrollo solo despues de probar el boundary de identidad.
- Rate limiting sigue siendo obligatorio antes de exposicion publica.
- Las migraciones productivas requieren backup verificado, rollback probado y confirmacion explicita.
- Este documento no autoriza despliegue ni gasto.

## Decisiones de arquitectura

- Monolito modular: ver ADR-001.
- PostgreSQL gestionado: ver ADR-002.
- Firebase Auth: ver ADR-003.
- R2: ver ADR-004.
- Vercel Hobby: ver ADR-005.
- Fake OCR inicial: ver ADR-006.
