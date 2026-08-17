# Adaptador Firebase determinista para pruebas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el claim de plataforma sólo sea posible con una identidad Firebase verificada y permitir que Playwright pruebe ese flujo con un adapter Firebase determinista exclusivo de test.

**Architecture:** Mantener `FirebaseAuthProvider` como boundary único y seleccionar un `FirebaseAdminAuth` determinista sólo bajo `NODE_ENV=test`; el cliente de auth tendrá una credencial determinista equivalente sólo en ese bundle de test. El claim privado se ejecutará desde `requirePlatformMember`, enlazando el bootstrap por email con un update condicional, y toda autorización posterior consultará sólo el `user_id` local enlazado. La memoria y PostgreSQL conservarán la misma unicidad de email normalizado.

**Tech Stack:** Next.js 15 App Router, TypeScript, Firebase Admin/client adapters, Drizzle ORM, PostgreSQL/PGlite, Vitest, Playwright, pnpm.

## Global Constraints

- No agregar endpoint HTTP de claim.
- No autorizar por email, allowlist, rango de IDs o `LEDGERHARBOUR_TEST_MODE`.
- `DevAuthProvider` emite `provider: "development"` y nunca puede reclamar plataforma.
- `FirebaseAuthProvider` y el adapter determinista emiten `provider: "firebase"`.
- El adapter determinista sólo se puede seleccionar con `NODE_ENV=test`.
- No agregar paneles ni funcionalidad de projects.
- Usar RED/GREEN focalizado, regresión, E2E, `tsc`, lint, build y audit con evidencia real.

---

### Task 1: Discriminante de identidad y guards de runtime

**Files:**
- Modify: `src/modules/auth/auth-provider.ts`
- Modify: `src/modules/auth/firebase-auth-provider.ts`
- Modify: `src/modules/auth/dev-auth-provider.ts`
- Modify: `src/modules/auth/session.ts`
- Modify: fixtures y tests que construyan `AuthIdentity` sin provider, sólo donde el typecheck o el comportamiento de seguridad lo requiera
- Test: `tests/unit/auth-provider-firebase.test.ts`, `tests/unit/auth/dev-auth-provider.test.ts`

**Interfaces:**
- Produce `AuthProviderKind = "firebase" | "development"` y `AuthIdentity.provider?: AuthProviderKind` para no romper construcciones existentes; las identidades emitidas por providers siempre incluyen el valor.
- Produce una validación de sesión que conserve y valide `provider` cuando esté presente, rechazando valores desconocidos.

- [ ] **Step 1: Write the failing tests**

Agregar assertions para que el identity Firebase tenga `provider: "firebase"`, el identity Dev tenga `provider: "development"`, una sesión preserve el discriminante y una identidad `provider: "development"` no sea elegible para plataforma.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/auth-provider-firebase.test.ts tests/unit/auth/dev-auth-provider.test.ts`

Expected: FAIL por ausencia del campo `provider` en las identidades producidas.

- [ ] **Step 3: Write minimal implementation**

Agregar el tipo discriminante, incluirlo en ambos providers y aceptar/validar el campo en serialización de sesión sin cambiar cookies ni contratos no relacionados.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/auth-provider-firebase.test.ts tests/unit/auth/dev-auth-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth tests/unit/auth-provider-firebase.test.ts tests/unit/auth/dev-auth-provider.test.ts
git commit -m "feat: discriminate auth identity providers"
```

### Task 2: Adapter Firebase determinista aislado a test

**Files:**
- Create: `src/modules/auth/firebase-test-adapter.ts`
- Modify: `src/modules/auth/firebase-admin.ts`
- Modify: `src/modules/auth/firebase-client.ts`
- Modify: `src/modules/auth/runtime-mode.ts` sólo para exponer el guard exacto de `NODE_ENV=test` sin ampliar el alcance del provider Dev
- Test: `tests/unit/auth-provider-firebase.test.ts` o `tests/unit/auth/firebase-test-adapter.test.ts`

**Interfaces:**
- Produce `createDeterministicFirebaseAdminAuth(): FirebaseAdminAuth`, con token interno determinista `ledgerharbour-test-firebase:<encoded-email>` y validación de `NODE_ENV=test` en la factory.
- `createFirebaseAdminAuth()` selecciona el adapter sólo en test; fuera de test exige `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`.
- El cliente de test crea credenciales deterministas sólo cuando el bundle corre con `NODE_ENV=test`; el camino normal mantiene Firebase JS SDK.

- [ ] **Step 1: Write the failing tests**

Cubrir emisión/validación determinista de email y Google, `email_verified: true`, `provider: "firebase"`, rechazo del adapter con `NODE_ENV=development`/`production`, y ausencia de selección por `LEDGERHARBOUR_TEST_MODE`.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/auth/firebase-test-adapter.test.ts tests/unit/auth-provider-firebase.test.ts`

Expected: FAIL porque el módulo y la selección determinista no existen.

- [ ] **Step 3: Write minimal implementation**

Implementar el adapter sin rutas ni estado global de usuarios: decodificar únicamente tokens generados por el cliente determinista, rechazar tokens malformados y delegar la cookie de sesión al `FirebaseAuthProvider` existente. Mantener los secretos Firebase reales fuera del camino de test.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/auth/firebase-test-adapter.test.ts tests/unit/auth-provider-firebase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth tests/unit/auth-provider-firebase.test.ts tests/unit/auth/firebase-test-adapter.test.ts
git commit -m "test: add deterministic firebase auth adapter"
```

### Task 3: Claim privado y autorización sólo por enlace

**Files:**
- Modify: `src/modules/platform/platform-repository.ts`
- Modify: `src/modules/platform/platform-service.ts`
- Delete: no se crea `src/app/api/platform/claim/route.ts`; verificar que siga ausente
- Test: `tests/unit/platform/business-approval.test.ts`, `tests/security/platform-authorization.test.ts`, `tests/integration/tenancy/business-approval.test.ts`

**Interfaces:**
- Produce `PlatformRepository.claimMemberByEmail(normalizedEmail, userId): Promise<PlatformMember | null>`, con filtro `is_active = true` y `user_id IS NULL`; PostgreSQL lo implementa con un solo `UPDATE ... WHERE ... RETURNING` y memoria bajo su lock transaccional.
- `claimPlatformMember(actor: AuthIdentity)` rechaza cualquier provider distinto de `firebase` o `emailVerified !== true`; devuelve un enlace ya existente sólo para el mismo usuario local y nunca por email.
- `requirePlatformMember` intenta el claim privado sólo para una identidad Firebase verificada y después autoriza únicamente el miembro activo encontrado por `user_id`.

- [ ] **Step 1: Write the failing tests**

Agregar casos para: DevAuthProvider con email bootstrap denegado; identidad con `LEDGERHARBOUR_TEST_MODE`/provider ausente denegada; Firebase verificado reclama por email; primer claim concurrente tiene un ganador; usuario ya enlazado autoriza; email coincidente pero `user_id` distinto no autoriza; no existe ruta pública de claim.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/platform/business-approval.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts`

Expected: FAIL por claim sin provider guard, falta de claim desde `requirePlatformMember` y ausencia del método atómico.

- [ ] **Step 3: Write minimal implementation**

Añadir el método de repositorio y reemplazar la secuencia find-then-link por el update condicional. Resolver el usuario local una sola vez, ejecutar claim sólo cuando corresponde y volver a leer el miembro enlazado antes de conceder la autorización. No reintroducir endpoint.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/platform/business-approval.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/platform tests/unit/platform/business-approval.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts
git commit -m "fix: restrict platform claims to linked firebase users"
```

### Task 4: Unicidad de email en memoria y PostgreSQL

**Files:**
- Modify: `src/modules/tenancy/business-service.ts`
- Modify: `src/modules/tenancy/postgres-tenancy-repository.ts`
- Modify: `src/modules/tenancy/types.ts` only if an existing domain error type needs to be reused
- Modify: `src/db/schema/users.ts` only if the ORM unique index needs alignment
- Modify: `src/db/migrations/0001_initial.sql` only if the SQL unique index is missing from the current contract
- Test: `tests/unit/tenancy/business-service.test.ts`, `tests/integration/postgres/tenancy-repository.test.ts`, `tests/integration/postgres/schema-execution.test.ts`

**Interfaces:**
- Memory keeps provider-to-user and normalized-email-to-user indexes; same provider remains updatable, different provider with an occupied normalized email returns the existing repository conflict rather than creating a duplicate.
- PostgreSQL keeps `users_normalized_email_unique`; upsert remains targeted by provider ID and maps a normalized-email conflict to the existing repository error.

- [ ] **Step 1: Write the failing tests**

Agregar una prueba de memoria que intenta dos providers con `Owner@Example.com`/`owner@example.com` y verifica un solo usuario/conflicto, y una integración PostgreSQL que verifica el índice y el conflicto normalizado.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/tenancy/business-service.test.ts tests/integration/postgres/tenancy-repository.test.ts tests/integration/postgres/schema-execution.test.ts`

Expected: FAIL en la memoria por duplicación y, si el contrato ORM/SQL no coincide, en la comprobación de índice.

- [ ] **Step 3: Write minimal implementation**

Normalizar con el mismo criterio `trim().toLocaleLowerCase("en-US")`, mantener ambos mapas durante rollback de transacciones y no cambiar el índice SQL existente salvo que la prueba demuestre una discrepancia.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/tenancy/business-service.test.ts tests/integration/postgres/tenancy-repository.test.ts tests/integration/postgres/schema-execution.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tenancy src/db/schema/users.ts src/db/migrations/0001_initial.sql tests/unit/tenancy/business-service.test.ts tests/integration/postgres/tenancy-repository.test.ts tests/integration/postgres/schema-execution.test.ts
git commit -m "fix: enforce normalized user email uniqueness"
```

### Task 5: Harness Playwright con Firebase determinista

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/auth/login.spec.ts`
- Modify: `tests/e2e/platform/business-approval.spec.ts`
- Modify: otros tests E2E que dependan de `AUTH_MODE=development`, sólo para migrar el login al adapter Firebase de test
- Test: `tests/e2e/auth/login.spec.ts`, `tests/e2e/platform/business-approval.spec.ts`

**Interfaces:**
- Web server usa `NODE_ENV=test`, `AUTH_MODE=firebase`, configuración pública sintética y `PLATFORM_ADMIN_EMAILS` como bootstrap por email; elimina `LEDGERHARBOUR_TEST_MODE` y `PLATFORM_ADMIN_USER_IDS`.
- Los tests continúan usando el formulario real y no llaman a ningún endpoint de claim.

- [ ] **Step 1: Write the failing E2E assertions**

Cambiar el flujo de login para comprobar cookie `ledgerharbour_firebase_session`, provider Firebase en el recorrido de plataforma y ausencia de copy de desarrollo/demo; agregar un caso donde el admin se enlaza por email sin ID preconfigurado.

- [ ] **Step 2: Run E2E to verify RED**

Run: `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/platform/business-approval.spec.ts`

Expected: FAIL porque el harness todavía selecciona DevAuthProvider y la UI usa Firebase JS real.

- [ ] **Step 3: Write minimal implementation/configuration**

Actualizar variables del web server, hacer que el cliente de auth use credencial determinista sólo bajo test y eliminar toda configuración de IDs de usuario. Mantener las pruebas de copy y navegación existentes.

- [ ] **Step 4: Run E2E to verify GREEN**

Run: `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/platform/business-approval.spec.ts`

Expected: PASS sin endpoint de claim ni red Firebase real.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e src/modules/auth/firebase-client.ts
git commit -m "test: run playwright through deterministic firebase auth"
```

### Task 6: Regresión, Fix Round 3 y cierre

**Files:**
- Modify: `task-8-security-report.md`
- Modify: `README.md` sólo para corregir comandos/configuración de verificación si quedaron obsoletos
- Test: suite completa y checks de release

- [ ] **Step 1: Run focalized GREEN after all tasks**

Run: `corepack pnpm exec vitest run tests/unit/auth tests/unit/platform tests/unit/tenancy/business-service.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts tests/integration/postgres/tenancy-repository.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `corepack pnpm test`

Run: `corepack pnpm exec playwright test`

Run: `corepack pnpm exec tsc --noEmit`

Run: `corepack pnpm lint`

Run: `corepack pnpm build`

Run: `corepack pnpm audit --json`

Expected: all commands exit 0; audit reports zero known vulnerabilities at each severity.

- [ ] **Step 3: Perform security self-review**

Buscar `LEDGERHARBOUR_TEST_MODE`, `PLATFORM_ADMIN_USER_IDS`, `api/platform/claim`, `DevAuthProvider` en rutas de claim y `findMemberForClaimByEmail` en autorización. Confirmar que no haya endpoint, rango de IDs, allowlist de IDs o autorización por email.

- [ ] **Step 4: Record Fix Round 3 evidence**

Agregar a `task-8-security-report.md` el finding, RED/GREEN focalizado, regresión, E2E, typecheck, lint, build y audit con sus salidas reales. No declarar aprobación sin resultados observados.

- [ ] **Step 5: Inspect and commit final implementation**

```bash
git status --short
git add src tests playwright.config.ts task-8-security-report.md README.md
git commit -m "fix: harden deterministic firebase platform claims"
```

No incluir `tests/integration/postgres/native-schema.test.ts` si continúa siendo untracked preexistente y no forma parte de este trabajo.
