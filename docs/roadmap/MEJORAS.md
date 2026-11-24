# Mejoras que no bloquean un cierre

Formato: `- [ID] qué mejorar · por qué · fecha`. Cuando no quede nada construible, lo que valga la pena pasa a ser una ficha y el resto se borra.

Repasada el 2026-11-20, dos veces. La primera pasó a LH-035, LH-036, LH-037 y LH-038. La segunda no dejó nada pendiente: lo que quedó sin hacer está anotado en la evidencia de LH-036 y LH-037 y en lo que falta de LH-029 y LH-033.

Repasada el 2026-11-21: la mejora de fotos pequeñas pasó a LH-040.

- [LH-039] `tests/e2e/invoices/payment.spec.ts` se cae siempre en el mismo paso (Chromium «Target crashed» al elegir el código de la factura), también sobre el código anterior a LH-039 · el flujo de pago queda sin prueba de navegador hasta saber por qué · 2026-11-24
- [LH-039] No hay forma de provocar a propósito la pantalla de error en una prueba de navegador · la pantalla de error solo está probada por su prueba unitaria · 2026-11-24
- [LH-039] Un administrador de plataforma en el móvil y en español ve 7 pestañas abajo; «Movimientos» puede partirse en dos líneas · solo afecta a administradores · 2026-11-24
