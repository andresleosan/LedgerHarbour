# ADR-004: Cloudflare R2 para Documentos Privados

Fecha: 2026-08-12  
Estado: propuesta; fuera de implementacion actual

## Contexto

El storage local no es durable ni adecuado para un filesystem efímero como el de un hosting gestionado. Los documentos originales deben mantenerse privados y con acceso autorizado.

## Decisión

Usar Cloudflare R2 Standard mediante el `StorageAdapter` existente, con object keys generadas por el servidor y URLs de descarga autorizadas.

## Alternativas consideradas

- Vercel Blob: integración sencilla, pero la cuota/costo de objetos debe compararse con el patrón de documentos privados antes de adoptarlo.
- Firebase Storage: integración natural con Firebase, pero acoplaría storage y auth y sus límites de operaciones/región requieren validar billing.
- Filesystem local: descartado por no durabilidad en despliegues gestionados.

## Consecuencias

El egreso sin cargo de R2 favorece descargas de bajo volumen. Se deben controlar tamaño, operaciones, ciclo de vida, permisos del bucket, credenciales S3-compatible y alertas. No se habilitará acceso público al bucket.
