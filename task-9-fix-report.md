# Task 9 — Informe de ronda de correcciones

Fecha: 2026-08-11  
Proyecto: LedgerHarbour  
Alcance: `F:\Proyectos\LedgerHarbour\Dev`

## Cambios realizados

- Las rutas de categorías y monedas devuelven `409` para `CATEGORY_REPOSITORY_CONFLICT` y `CURRENCY_REPOSITORY_CONFLICT`, con el contrato estable `{ error: { code, message } }`.
- `setCurrency` valida nombre e ISO dentro de `repository.transaction`, y la comprobación y creación son una sola operación serializada. La siembra de GBP/EUR/USD también queda dentro de una transacción.
- `SetCurrencyInput.isStandard: true` se rechaza para impedir monedas personalizadas estándar. GBP, EUR y USD siguen siendo las semillas estándar de `listCurrencies`.
- Se conservó la validación server-side previa existente: ningún campo obligatorio con confianza menor a `0.8` puede aprobarse.
- `listInvoices` devuelve `InvoiceListItem` con `documentStatus`. El filtro `Failed` usa exclusivamente `documentStatus === "failed"`; no se agregó un estado financiero `failed` ni una migración.
- Los fallos del worker OCR marcan el documento como `failed`, sin alterar el `reviewState` financiero.
- Las cuatro páginas nuevas incluyen estilos `prefers-reduced-motion`, foco visible y layout móvil. Categorías y monedas usan etiquetas localizadas asociadas con `htmlFor`, mensajes `role="alert"` y mapeo localizado de códigos API mediante i18n.
- La cobertura E2E ahora ejecuta mutaciones reales de categorías y monedas, conflictos localizados, renombrado/desactivación y rechazo de aprobación por baja confianza antes de la aprobación corregida.

## Archivos modificados

- `src/app/api/businesses/[businessId]/categories/route.ts`
- `src/app/api/businesses/[businessId]/currencies/route.ts`
- `src/app/(app)/business/[businessId]/invoices/page.tsx`
- `src/app/(app)/business/[businessId]/invoices/[invoiceId]/page.tsx`
- `src/app/(app)/business/[businessId]/settings/categories/page.tsx`
- `src/app/(app)/business/[businessId]/settings/currencies/page.tsx`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/modules/accounting/currency-service.ts`
- `src/modules/documents/document-service.ts`
- `src/modules/invoices/invoice-review-service.ts`
- `src/modules/invoices/invoice-service.ts`
- `src/modules/jobs/ocr-worker.ts`
- `tests/integration/invoices/review.test.ts`
- `tests/integration/invoices/ocr-workflow.test.ts`
- `tests/unit/accounting/currency-service.test.ts`
- `tests/e2e/invoices/review.spec.ts`
- `task-9-fix-report.md`

## Verificación exacta

| Comando | Resultado |
|---|---|
| `npm test` | Exit 0; 15 archivos, 206 tests, 206 pasan |
| `npm run lint` | Exit 0; sin errores |
| `npx tsc --noEmit` | Exit 0; sin salida |
| `npm run build` | Exit 0; build Next.js exitoso, rutas de categorías, monedas e invoices compiladas |
| `$env:AUTH_MODE = 'development'; npm run test:e2e -- tests/e2e/invoices/review.spec.ts` | Exit 0; 4 tests pasan |
| `$env:AUTH_MODE = 'development'; npm run test:e2e` | 15 pasan, 1 falla y 1 no se ejecuta por timeout en la prueba existente de administración de miembros |

El E2E específico mostró únicamente el warning no bloqueante de Next.js sobre `allowedDevOrigins` al usar `127.0.0.1`.

## Revisión de seguridad

- Se conservan autenticación, autorización por membership/capability, validación Zod estricta y aislamiento por business.
- El DTO de lista sólo agrega `documentStatus`; no expone `privateObjectKey` ni bytes privados.
- No se agregaron secretos, proveedores externos, dependencias ni endpoints sin autorización.
- No se detectó un hallazgo crítico nuevo.

## Límites diferidos

- Persistencia durable, garantías multi-proceso y restricciones únicas reales de PostgreSQL siguen fuera de este alcance; las garantías verificadas pertenecen a los repositorios in-memory.
- Firebase, OCR externo, rate limiting, despliegue y migraciones siguen fuera de alcance.
- La suite E2E completa conserva una sensibilidad conocida al estado global de autenticación en desarrollo cuando varias pruebas corren en paralelo. La prueba nueva de Task 9 es estable de forma aislada y pasó 4/4.
- El API mantiene mensajes canónicos en inglés para su contrato estable; la localización se aplica en la UI mediante códigos de error e i18n.
