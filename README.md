# LedgerHarbour

MVP local de revisión de documentos e invoices. El estado de este repositorio es:

**MVP LOCAL VERIFICADO - NO LISTO PARA PRODUCCION**

## Requisitos

- Node.js compatible con Next.js 15.
- npm.
- PowerShell 5.1 para el baseline.
- Navegador Chromium instalado por Playwright para E2E.

## Desarrollo local

```powershell
npm install
$env:AUTH_MODE='development'
$env:DEV_SESSION_SECRET='solo-desarrollo-local'
npm run dev
```

El almacenamiento local de documentos usa el adapter privado del proyecto. No uses credenciales reales ni datos productivos.

## Verificación

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
$env:AUTH_MODE='development'; npm run test:e2e -- tests/e2e/critical-path.spec.ts
$env:AUTH_MODE='development'; npm run test:e2e
powershell -ExecutionPolicy Bypass -File tests/performance/baseline.ps1
```

Las matrices de seguridad viven en `tests/security/`; cubren servicios y rutas HTTP reales, incluyendo multipart/DTO seguro, currency mutation y mutaciones de miembros. El flujo browser crítico está en `tests/e2e/critical-path.spec.ts` y cubre upload real, review, corrección, aprobación, estado aprobado, inmutabilidad y navegación cross-tenant. El reporte de performance está en `docs/verification/ledgerharbour-mvp-performance.md`.

El baseline PowerShell no sigue redirects automáticamente: las rutas públicas se validan como `200` con contenido esperado y las rutas privadas se registran explícitamente como `307` a `/login` sin sesión. No debe interpretarse como medición autenticada de pantallas privadas.

## Límites

La autenticación de desarrollo y los repositorios in-memory solo sirven para verificación local. La producción sigue bloqueada hasta contar con PostgreSQL durable, Firebase Auth, rate limiting, OCR real, auditoría reproducible de dependencias y un proceso de despliegue aprobado.
