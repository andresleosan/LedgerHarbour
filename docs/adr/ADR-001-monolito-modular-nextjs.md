# ADR-001: Monolito Modular Next.js

Fecha: 2026-08-12  
Estado: aceptada

## Contexto

LedgerHarbour tiene un flujo integrado de tenancy, documentos, OCR, invoices, contabilidad y auditoria. El proyecto es un prototipo de bajo consumo y no tiene equipos ni modulos que requieran despliegues independientes.

## Decisión

Mantener un monolito modular Next.js con boundaries de dominio explícitos y adaptadores para infraestructura.

## Alternativas consideradas

- Microservicios: descartados porque agregan despliegues, observabilidad y comunicación distribuida sin una necesidad medida.
- Backend separado desde el inicio: descartado porque duplicaría autenticación y contratos antes de validar el producto.

## Consecuencias

Se reduce la operación y se conserva una ruta simple desde el MVP local. La aplicación debe vigilar que los módulos no compartan estado mutable sin boundaries y podrá extraer un servicio cuando exista una presión real de escala o ownership.
