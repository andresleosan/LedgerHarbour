# ADR-002: Neon Free como PostgreSQL del Prototipo

Fecha: 2026-08-12  
Estado: propuesta para implementacion local; no aprovisiona recursos

## Contexto

Los repositorios in-memory pierden datos al reiniciar y no ofrecen garantías entre procesos. Se necesita PostgreSQL gestionado con costo cero inicial y una migración compatible con Drizzle.

## Decisión

Diseñar el adaptador PostgreSQL sobre Neon Free, manteniendo el contrato de repositorios independiente del proveedor.

## Alternativas consideradas

- Supabase Free: ofrece PostgreSQL y auth, pero puede pausar proyectos inactivos y mezclaría más primitives de infraestructura de las necesarias.
- Cloud SQL/Firebase SQL Connect: el trial de PostgreSQL no es gratuito permanente.
- PostgreSQL autogestionado: descartado para este prototipo por operación, backups y mantenimiento.

## Consecuencias

Se obtiene PostgreSQL real con cuota gratuita y posibilidad de cambiar de proveedor por el adaptador. Neon Free no reemplaza backups productivos, SLA ni spending controls de un plan pago; cuotas y suspensión deben monitorearse.
