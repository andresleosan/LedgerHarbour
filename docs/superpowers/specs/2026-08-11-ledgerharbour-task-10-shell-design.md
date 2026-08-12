# LedgerHarbour Task 10: Shell Multiempresa y Portfolio

Fecha: 2026-08-11  
Estado: diseño aprobado por el operador, pendiente de revisión del documento

## Objetivo

Añadir el shell autenticado de la aplicación, el portfolio multiempresa y el dashboard inicial sin crear una nueva frontera de seguridad ni inventar métricas financieras.

## Seguridad de sesión

La sesión de desarrollo seguirá usando una cookie `HttpOnly`, `SameSite=Lax`, con expiración corta y disponible solo cuando `AUTH_MODE=development`. Su contenido será validado con una firma HMAC derivada de un secreto de entorno de desarrollo. Una cookie manipulada, malformada, expirada o firmada con otro secreto se tratará como sesión ausente.

La clave de firma no se incluirá en el código ni en documentación con valores reales. Si falta la configuración necesaria, la sesión no se aceptará. El proveedor Firebase continúa fuera de alcance.

## Portfolio y dashboard

`src/modules/tenancy/portfolio-service.ts` será la frontera de lectura multiempresa:

- `listUserBusinesses(userId, dependencies)` devuelve únicamente negocios con membresía activa del usuario.
- Cada resumen incluye `id`, `name`, `isActive` y `role`.
- `getBusinessDashboard(businessId, userId, dependencies)` verifica membresía, capacidad `read_finance`, ciclo operativo y `businessId` en cada consulta.
- El dashboard expone solo cantidad de documentos, cantidad de facturas `needs_review` y cargas recientes.
- Las cargas recientes no incluyen `privateObjectKey`.
- No se calculan totales monetarios, balances ni conversiones.

Los repositorios podrán recibir métodos de listado tenant-scoped cuando sea necesario; no se dependerá de listas enviadas por el navegador como autoridad.

## Shell y navegación

Se crearán:

- `AppShell`: navegación consistente a portfolio, upload, invoices/review, documents y settings, identidad visible y salida.
- `BusinessSwitcher`: enlaces server-rendered a negocios autorizados; negocios inactivos se marcan y no son seleccionables.
- `LanguageSwitcher`: conserva pathname y parámetros y cambia únicamente `locale=en|es`.
- `StatusBadge`: componente visual que recibe una etiqueta ya localizada.
- `src/app/(app)/layout.tsx`: gate server-side de identidad y carga de negocios autorizados.
- `src/app/(app)/portfolio/page.tsx`: listado de negocios autorizados.
- `src/app/(app)/business/[businessId]/page.tsx`: dashboard del negocio.

El `businessId` de la URL solo controla navegación. Cada lectura real vuelve a validar tenant y permisos en el servidor. El shell no convierte estado del navegador en autoridad.

Mientras no exista una página específica de documentos o settings raíz, esos enlaces apuntarán a rutas funcionales existentes o se presentarán como navegación no destructiva claramente marcada; no se crearán endpoints ficticios.

## Localización y accesibilidad

El locale se resolverá desde la query `locale`, con `en` como valor predeterminado y `es` como alternativa. Las páginas nuevas y el shell usarán el mismo valor para evitar que el selector cambie solo una parte de la interfaz.

La interfaz será responsive, navegable por teclado, con foco visible, contraste mínimo de texto de 4.5:1, `prefers-reduced-motion`, nombres accesibles y sin iconos emoji.

## Pruebas

Se añadirán pruebas de integración para:

- aislar negocios por usuario y membresía;
- impedir acceso cruzado e inactivo;
- contar documentos e invoices solo del tenant solicitado;
- ordenar cargas recientes;
- excluir `privateObjectKey` y totales financieros.

Se añadirá E2E para:

- autenticación y acceso al portfolio;
- cambio entre dos negocios;
- dashboard con negocio correcto;
- negocio inactivo no seleccionable;
- cambio de idioma conservando ruta;
- uso móvil y foco de teclado.

## Límites

Persistencia PostgreSQL, Firebase Auth productivo, rate limiting, OCR real, auditoría de dependencias y despliegue permanecen fuera de Task 10.
