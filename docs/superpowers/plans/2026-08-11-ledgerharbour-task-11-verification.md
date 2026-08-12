# Task 11: Verificacion de Release del MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verificar y documentar la seguridad, accesibilidad, flujo critico y rendimiento del MVP local sin declarar disponibilidad para produccion.

**Architecture:** La verificacion usa los boundaries server-side existentes y repositorios in-memory inyectables. Las pruebas de seguridad ejercitan servicios y rutas reales; Playwright cubre el flujo critico del navegador; la medicion de rendimiento registra baselines sin optimizacion especulativa.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Playwright, PowerShell 5.1, repositorios in-memory existentes y build de Next.js.

## Global Constraints

- No desplegar ni aplicar migraciones destructivas.
- No leer secretos reales ni agregar credenciales.
- No integrar Firebase Auth, OCR pago, servicios externos ni nuevas dependencias.
- El tenant es el limite de autorizacion; toda lectura, descarga, edicion y aprobacion debe validarse server-side.
- Los documentos originales son privados y `privateObjectKey` nunca debe aparecer en DTOs publicos.
- El resultado solo puede aprobar un MVP local; PostgreSQL durable, Firebase Auth, rate limiting, OCR real y auditoria reproducible de dependencias siguen siendo gates de produccion.
- Cada prueba nueva debe escribirse antes de la implementacion auxiliar y observar un fallo correcto antes de pasar a verde.

---

### Task 1: Pruebas de aislamiento tenant

**Files:**
- Create: `tests/security/tenant-isolation.spec.ts`
- Modify: `src/modules/documents/document-service.ts` only if an existing service boundary lacks the required assertion
- Modify: `src/modules/invoices/invoice-service.ts` only if an existing service boundary lacks the required assertion

**Interfaces:**
- Consume `getInvoice`, `updateInvoice`, `approveInvoice`, `getInvoiceReview`, document download service y `getBusinessDashboard` existentes.
- Produce una matriz reproducible que pruebe lectura, descarga, edicion y aprobacion cruzadas.

- [ ] **Step 1: Escribir las pruebas de aislamiento.** Crear dos negocios, dos usuarios y documentos/facturas con IDs conocidos. Probar que el usuario A no puede leer, descargar, editar ni aprobar datos del negocio B y que el dashboard A no cuenta datos B.
- [ ] **Step 2: Ejecutar solo la suite nueva.** Ejecutar `npm test -- tests/security/tenant-isolation.spec.ts`. Confirmar que cada caso falla si se elimina la comprobacion tenant correspondiente, no por un error de setup.
- [ ] **Step 3: Corregir solo los boundaries que fallen.** Mantener los errores publicos genericos y no exponer IDs o `privateObjectKey` innecesarios.
- [ ] **Step 4: Ejecutar la suite dirigida nuevamente.** Confirmar todos los casos verdes y revisar que los repositorios compartidos no contaminen otros casos.

### Task 2: Pruebas de escalamiento de permisos

**Files:**
- Create: `tests/security/permission-escalation.spec.ts`

**Interfaces:**
- Consume `requireCapability`, servicios de members, ownership transfer, lifecycle, category/currency mutation e invoice approval existentes.
- Produce evidencia de limites para `owner_admin`, `general_admin` y `administrator`.

- [ ] **Step 1: Escribir la matriz de permisos.** Cubrir lectura financiera, edicion financiera, aprobacion de administrador, gestion de General Admin, retiro de Administrador, transferencia de ownership y lifecycle.
- [ ] **Step 2: Ejecutar la matriz en rojo.** Ejecutar `npm test -- tests/security/permission-escalation.spec.ts` y verificar que cada assertion detecta el bypass si se desactiva la capability correspondiente.
- [ ] **Step 3: Añadir solo correcciones necesarias.** Si aparece un bypass, corregir el servicio server-side, no ocultar botones como sustituto de autorizacion.
- [ ] **Step 4: Ejecutar la matriz y las pruebas previas.** Ejecutar `npm test -- tests/security/permission-escalation.spec.ts tests/unit/permissions/authorize.test.ts tests/unit/tenancy/membership-service.test.ts`.

### Task 3: Pruebas de seguridad de uploads y descargas

**Files:**
- Create: `tests/security/upload-security.spec.ts`

**Interfaces:**
- Consume `validateUpload`, `createDocument`, rutas de upload/download y el storage adapter local existentes.
- Produce evidencia para MIME spoofing, path traversal, tamaño, corrupción, documentos vacíos y descarga no autorizada.

- [ ] **Step 1: Escribir fixtures mínimos seguros.** Usar bytes sintéticos ya presentes en los tests para PDF, JPEG, PNG, TIFF y entradas malformadas; no descargar fixtures externos.
- [ ] **Step 2: Escribir las pruebas negativas.** Cubrir extensión falsa, contenido incompatible, archivo corrupto, archivo vacío, tamaño mayor a 10 MiB, nombres con `..`/separadores y usuario de otro negocio.
- [ ] **Step 3: Ejecutar la suite en rojo.** Ejecutar `npm test -- tests/security/upload-security.spec.ts` y distinguir fallos de producto de errores de fixture.
- [ ] **Step 4: Corregir boundaries y repetir.** Solo modificar validación, generación de object key o autorización de descarga cuando una assertion demuestre el defecto.
- [ ] **Step 5: Confirmar que no hay fuga.** Asegurar que respuestas y errores no contienen rutas absolutas, bytes privados, secreto ni `privateObjectKey`.

### Task 4: Flujo crítico E2E

**Files:**
- Create: `tests/e2e/critical-path.spec.ts`
- Modify: `playwright.config.ts` only if the existing serial test-server configuration cannot run the critical flow reliably

**Interfaces:**
- Consume las pantallas actuales de login, onboarding, upload, invoices/review, portfolio y business shell.
- Produce un recorrido browser reproducible con usuario de desarrollo y sin credenciales de produccion.

- [ ] **Step 1: Escribir el escenario E2E.** Cubrir login, crear negocio, navegar al dashboard, verificar conteos sin totales inventados, subir documento valido, abrir revisión, cambiar a español, comprobar foco/reduced motion en mobile y verificar que otro business no sea accesible.
- [ ] **Step 2: Ejecutar el escenario.** Ejecutar `$env:AUTH_MODE='development'; npm run test:e2e -- tests/e2e/critical-path.spec.ts`. El reporte HTML debe conservarse en la ubicacion configurada por Playwright y no debe versionarse.
- [ ] **Step 3: Investigar cualquier fallo por capa.** Separar fallo de auth, routing, tenant, UI, fixture o estado in-memory antes de tocar codigo.
- [ ] **Step 4: Corregir y repetir solo tras reproducir.** Mantener assertions sobre datos y estados, no solo visibilidad de `main` o headings.
- [ ] **Step 5: Ejecutar toda la suite E2E.** Ejecutar `$env:AUTH_MODE='development'; npm run test:e2e` y registrar warnings esperados por separado de fallos.

### Task 5: Baseline de rendimiento

**Files:**
- Create: `docs/verification/ledgerharbour-mvp-performance.md`
- Create: `tests/performance/baseline.ps1`

**Interfaces:**
- Consume `npm run build`, Playwright y las rutas locales existentes.
- Produce mediciones antes de optimizar para build, carga inicial, portfolio, dashboard, invoice list y business switcher.

- [ ] **Step 1: Definir las mediciones y umbrales informativos.** Registrar timestamp, comando, ruta, entorno y resultado; no convertir los números en gates arbitrarios sin una referencia previa.
- [ ] **Step 2: Escribir el script PowerShell.** Usar `System.Diagnostics.Stopwatch` y `Invoke-WebRequest` contra el servidor local; no leer variables secretas ni imprimir cookies.
- [ ] **Step 3: Ejecutar el baseline.** Ejecutar `npm run build`, iniciar el servidor local de forma controlada y ejecutar `powershell -ExecutionPolicy Bypass -File tests/performance/baseline.ps1`.
- [ ] **Step 4: Analizar resultados.** Documentar tiempos observados, tamaño de build reportado por Next y cualquier cuello de botella real. No optimizar si no hay un problema medido.

### Task 6: Documento de verificacion y README

**Files:**
- Create: `docs/verification/ledgerharbour-mvp-verification.md`
- Create: `README.md`

**Interfaces:**
- Consume resultados de Tasks 1-5 y la matriz de riesgos acumulada en `.superpowers/sdd/2026-08-11-ledgerharbour-mvp/progress.md`.
- Produce un registro auditable de comandos, resultados, limites y decision de release.

- [ ] **Step 1: Escribir el README local.** Documentar requisitos, `npm install`, `npm run dev`, `AUTH_MODE=development`, `DEV_SESSION_SECRET`, storage local, pruebas unitarias, lint, TypeScript, build y Playwright.
- [ ] **Step 2: Escribir la verificacion.** Incluir fecha, commit no disponible porque el directorio no es repositorio Git, comandos exactos, resultados, cobertura de seguridad, accesibilidad y rendimiento.
- [ ] **Step 3: Registrar riesgos abiertos.** Marcar como bloqueos de produccion PostgreSQL durable, Firebase Auth, rate limiting, OCR real, auditoria de dependencias y despliegue.
- [ ] **Step 4: Emitir decision.** La decision esperada es `MVP LOCAL VERIFICADO - NO LISTO PARA PRODUCCION` salvo evidencia contraria real y aprobacion explicita del operador para cualquier cambio de alcance.

### Task 7: Verificacion final y autocrítica

**Files:**
- Modify: `.superpowers/sdd/2026-08-11-ledgerharbour-mvp/progress.md`
- Modify: `docs/verification/ledgerharbour-mvp-verification.md`

- [ ] **Step 1: Ejecutar la suite completa.** Ejecutar `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` y `$env:AUTH_MODE='development'; npm run test:e2e` secuencialmente.
- [ ] **Step 2: Ejecutar sombrero de seguridad.** Revisar endpoints sin auth, exposición de datos privados, secretos, validación, rate limiting y dependencias; cualquier hallazgo crítico bloquea el cierre.
- [ ] **Step 3: Ejecutar sombrero de rendimiento.** Adjuntar las mediciones reales del baseline y no declarar optimización sin comparación antes/después.
- [ ] **Step 4: Actualizar el ledger.** Registrar comandos, conteos, findings corregidos, findings diferidos y veredicto de Task 11.
- [ ] **Step 5: Cerrar solo con evidencia.** Marcar Task 11 como verificada localmente únicamente si todas las pruebas aplicables pasan; mantener explícito el bloqueo de producción.
