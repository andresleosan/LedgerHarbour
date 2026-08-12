# LedgerHarbour MVP Performance Baseline

## Alcance

Baseline local, sin optimización especulativa. Las mediciones se toman antes de cualquier cambio de rendimiento y no son gates arbitrarios: no existe una referencia histórica comparable en este entorno.

## Método

- Script: `tests/performance/baseline.ps1`
- Reloj: `System.Diagnostics.Stopwatch`
- Servidor: Next.js local en `http://127.0.0.1:3100`
- Solicitudes: cliente HTTP sin redirects automáticos a login, con URL final, `Location`, status y contenido esperado validados
- Rutas privadas: se mide explícitamente el redirect anónimo `307 -> /login`; no se presenta como carga autenticada de portfolio/dashboard/upload/invoice list
- Datos: rutas sintéticas locales; no se imprimen cookies, tokens ni variables secretas
- Timestamp de la corrida final: `2026-08-12T05:00:34.5141013Z`

## Resultados

| Ruta | Tiempo ms | HTTP | Observación |
|---|---:|---:|---|
| `/login` | 53.95 | 200 | contenido esperado: `Bring clarity to every ledger.` |
| `/register` | 373.96 | 200 | contenido esperado: `Start with a clear workspace.` |
| `/portfolio` | 555.68 | 307 | redirect explícito a `/login`; sin cookie de sesión |
| `/business/demo-business` | 861.00 | 307 | redirect explícito a `/login`; sin cookie de sesión |
| `/business/demo-business/upload` | 844.31 | 307 | redirect explícito a `/login`; sin cookie de sesión |
| `/business/demo-business/invoices` | 905.44 | 307 | redirect explícito a `/login`; sin cookie de sesión |

## Decisión

Esta corrida es un baseline HTTP anónimo válido. No mide el render autenticado de las rutas privadas porque no se configuró una sesión de desarrollo para PowerShell; por tanto no se declara rendimiento optimizado ni se comparan estas rutas con una carga autenticada. No existe comparación antes/después ni cuello de botella reproducible.
