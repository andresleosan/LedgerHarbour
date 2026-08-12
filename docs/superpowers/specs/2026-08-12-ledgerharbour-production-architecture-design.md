# Arquitectura Productiva de Bajo Costo: Diseño y Migracion

Fecha: 2026-08-12  
Estado: propuesta aprobada para documentacion; pendiente de implementacion

## Objetivo

Preparar LedgerHarbour para un prototipo desplegable no comercial con Vercel Hobby, Neon Free, Firebase Auth y Cloudflare R2, sin desplegar ni activar facturacion durante esta fase.

## Contratos de infraestructura

La aplicacion conserva estos boundaries:

- `AuthProvider`: el dominio recibe `AuthIdentity`; Firebase reemplazara el provider de desarrollo sin que tenancy dependa del SDK.
- `StorageAdapter`: documentos usan object keys privadas generadas por servidor; R2 reemplazara `LocalPrivateStorage`.
- Repositorios de tenancy, documentos, invoices, contabilidad, jobs y auditoria: los servicios de negocio consumen interfaces, no Drizzle directamente.
- `OcrProvider`: Fake OCR permanece por defecto; un proveedor real requiere ADR y presupuesto separado.

## Migracion PostgreSQL

### Orden seguro

1. Levantar PostgreSQL local/efímero para pruebas; no usar una instancia productiva.
2. Validar el SQL existente contra el motor real y corregir cualquier diferencia antes de migrar datos.
3. Implementar adaptadores Drizzle por módulo, empezando por users/businesses/memberships y siguiendo por documentos/invoices, contabilidad, jobs y auditoría.
4. Añadir pruebas contractuales que ejecuten los mismos casos que hoy usan repositories in-memory.
5. Ejecutar doble lectura o migración controlada solo en entorno de prueba; no mantener dos fuentes de verdad silenciosas.
6. Migrar el flujo de escritura módulo por módulo y repetir seguridad/E2E.
7. Retirar repositorios in-memory únicamente cuando el adapter PostgreSQL tenga cobertura equivalente.

### Reglas de tenant y concurrencia

- Cada consulta de lectura y escritura recibe `businessId` validado por el servicio, nunca por una query construida desde UI sin autorización.
- Las foreign keys compuestas existentes se conservan para documento, invoice, currency, category, membership y auditoría.
- Aprobación de invoice y cambios de membresía usan transacciones PostgreSQL reales y controles de versión/estado para conflictos.
- Unicidad de categorías, monedas, jobs e invoice-document se delega a índices/constraints, con errores traducidos a contratos públicos estables.
- Auditoría permanece append-only y los eventos de usuario requieren membership válida y activa.
- Si se adopta RLS posteriormente, será defensa adicional y no reemplazará la autorización de servicios.

## Rollback

Cada migración debe tener:

- SQL `up` versionado.
- procedimiento `down` o rollback manual explícito si PostgreSQL no permite revertir sin pérdida.
- prueba en una base descartable.
- criterio de abortar ante fallo parcial.

Para cambios no destructivos iniciales, el rollback será revertir el adapter a in-memory y dejar las tablas intactas. No se ejecutarán `DROP`, `TRUNCATE` ni conversiones destructivas en producción durante este trabajo.

Antes de cualquier aplicación productiva se exige:

- backup reciente verificado y restauración probada;
- ventana de cambio y plan de rollback aprobado;
- migración probada sobre snapshot representativo;
- comprobación de integridad tenant y conteos antes/después;
- confirmación explícita del operador.

## Storage R2

R2 se implementará después de validar PostgreSQL, con bucket privado, credenciales de mínimo privilegio, límite de tamaño, object key server-side, descarga autorizada y migración verificable de objetos. El procedimiento debe permitir conservar el storage local hasta comprobar cada objeto migrado; no se borran originales durante una primera migración.

## Auth Firebase

Firebase se integrará después de definir el adapter de identidad. El servidor verificará tokens y resolverá `provider_id` a un usuario local. La cookie HMAC de desarrollo seguirá aislada por `AUTH_MODE=development`; no se mezclan sesiones ni secretos entre ambientes.

## Costos y gates

- Objetivo: US$0 mientras se permanezca en free tiers y prototipo no comercial.
- No se crea una cuenta de proveedor ni se activa billing desde este documento.
- Antes de una integración externa se vuelve a consultar la página oficial de precios, cuotas, retención, alertas y términos de uso.
- El primer servicio que pueda generar facturación variable, especialmente OCR o SMS, requiere límite de gasto y confirmación explícita.

## No incluido

No incluye implementación de adaptadores, creación de bases remotas, migraciones productivas, despliegue Vercel, configuración Firebase/R2 real, OCR externo, rate limiting ni compra de dominios.
