# ADR-003: Firebase Authentication para Identidad Productiva

Fecha: 2026-08-12  
Estado: propuesta; fuera de implementacion actual

## Contexto

El provider actual es solo de desarrollo y la cookie HMAC local no es una identidad productiva. El prototipo necesita un proveedor gestionado con email y futura posibilidad de proveedores sociales.

## Decisión

Preparar un adapter de Firebase Authentication detrás de la interfaz `AuthProvider`, sin acoplar los módulos de negocio al SDK.

## Alternativas consideradas

- Supabase Auth: buena alternativa, pero elegir Neon como base separada y mantener el provider de identidad reemplazable conserva más independencia.
- Auth propio: descartado por riesgo y mantenimiento criptográfico.

## Consecuencias

Se delega login, sesiones y recuperación al proveedor. Se deben validar tokens server-side, mapear usuarios por `provider_id`, mantener secretos solo en el entorno y probar revocación/expiración. Phone Auth queda fuera por costo variable.
