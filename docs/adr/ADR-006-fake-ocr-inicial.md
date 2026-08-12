# ADR-006: Fake OCR hasta Aprobar Proveedor

Fecha: 2026-08-12  
Estado: aceptada para prototipo

## Contexto

El producto necesita validar el flujo de revisión sin generar gasto por APIs de OCR ni comprometer datos de facturas a un tercero antes de conocer volumen, privacidad y costo.

## Decisión

Mantener Fake OCR para desarrollo, E2E y prototipo. Un proveedor real se seleccionará en una decisión separada con pruebas de calidad, límites, reintentos y costo.

## Alternativas consideradas

- Integrar OCR pago ahora: descartado porque no existe presupuesto ni volumen medido.
- OCR local adicional: pospuesto porque aumenta complejidad operativa y no es necesario para validar el flujo.

## Consecuencias

El prototipo no representa todavía la calidad real de extracción. El adapter `OcrProvider` permite reemplazar el fake sin cambiar la lógica de invoices; cualquier integración real deberá manejar timeouts, backoff limitado, errores y datos sensibles.
