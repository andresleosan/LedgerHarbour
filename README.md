# LedgerHarbour

MVP local de revisión de documentos e invoices.

## Estado del repositorio

- Desarrollo local y pruebas deterministas: respaldados por evidencia local documentada; esta linea no implica una nueva ejecucion ni evidencia productiva.
- Integraciones de proveedores: adapters y contratos implementados donde se indica en `docs/STACK.md`.
- Operacion productiva: activacion y estado externo no revalidados por este repositorio; requieren evidencia del operador.

## Requisitos

- Node.js compatible con Next.js 15.
- pnpm 11.21.0 (Corepack recomendado).
- PowerShell 5.1 para el baseline.
- Navegador Chromium instalado por Playwright para E2E.

## Desarrollo local

```powershell
corepack pnpm install --frozen-lockfile
$env:AUTH_MODE='development'
$env:DEV_SESSION_SECRET='solo-desarrollo-local'
corepack pnpm dev
```

El almacenamiento local de documentos usa el adapter privado del proyecto. No uses credenciales reales ni datos productivos.

## Demo local presentable

Con el servidor levantado, abre `http://localhost:3000/` para ver la entrada
presentable. El recorrido funcional empieza en `http://localhost:3000/login`:

1. Usa `admin@admin.com` como cuenta sintetica de desarrollo.
2. Entra a onboarding y crea un negocio de prueba.
3. Desde el negocio, prueba upload, OCR, revision y configuracion.

La landing publica tambien enlaza directamente a `/login` y `/register`.

La cuenta sintetica, los adapters locales y las URLs `localhost` del demo son exclusivamente para desarrollo y no representan activacion productiva.

## Verificación

```powershell
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm test:e2e tests/e2e/critical-path.spec.ts
corepack pnpm test:e2e
powershell -ExecutionPolicy Bypass -File tests/performance/baseline.ps1
```

## Vista manual de expiración

Con `DATABASE_URL` configurada, el operador puede ejecutar una vista de solo lectura que emite un
único JSON agregado. No programa trabajos, modifica datos, suspende negocios ni envía notificaciones:

```powershell
corepack pnpm db:service-expiration-dry-run --as-of=2026-08-21T00:00:00Z
```
Las matrices de seguridad viven en `tests/security/`; cubren servicios y rutas HTTP reales, incluyendo multipart/DTO seguro, currency mutation y mutaciones de miembros. El flujo browser crítico está en `tests/e2e/critical-path.spec.ts` y cubre upload real, review, corrección, aprobación, estado aprobado, inmutabilidad y navegación cross-tenant. El reporte de performance está en `docs/verification/ledgerharbour-mvp-performance.md`.

El harness Playwright usa `NODE_ENV=test`, `AUTH_MODE=firebase` y el adapter Firebase determinista; no necesita credenciales Firebase reales. El baseline PowerShell no sigue redirects automáticamente: las rutas públicas se validan como `200` con contenido esperado y las rutas privadas se registran explícitamente como `307` a `/login` sin sesión. No debe interpretarse como medición autenticada de pantallas privadas.

## Límites

La autenticación de desarrollo y los repositorios in-memory solo sirven para verificación local. La producción sigue bloqueada hasta contar con PostgreSQL durable, Firebase Auth, rate limiting, OCR real, auditoría reproducible de dependencias y un proceso de despliegue aprobado.
