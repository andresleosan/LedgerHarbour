# LH-039 · Interfaz con referencias de Mobbin

Plan de una página. Fecha: 2026-11-24. Datos de las capturas: sintéticos («Synthetic Harbour Ltd»), servidor de pruebas.

## Inventario (capturas a 390 px y 1280 px)

| Zona | Pantallas | Estado antes | Problema principal |
| --- | --- | --- | --- |
| Acceso | `/login`, `/register` | Bien resuelto | Ninguno grave |
| Onboarding | `/onboarding`, crear y unirse a negocio | Coherente con acceso | Ninguno grave |
| Administración | `/admin` y subpáginas (`PlatformShell`) | Barra propia en una línea | Ninguno grave |
| Navegación del negocio | `AppShell` en todas las páginas `/business/*` | 8 enlaces arriba | En 1280 px se parte en dos líneas; en 390 px se corta («Invoices / revie…») y hay que desplazar de lado; ningún enlace marca la página actual |
| Resumen | `/business/[id]` | Tarjetas de cifras | Sin acción principal; vacío pobre («No recent uploads.») |
| Facturas, documentos, movimientos, ejercicio | listas y formularios | Coherentes | Bien |
| Ajustes | miembros, cuentas, monedas, categorías, libro, zona de peligro | Cada página suelta | No hay menú de ajustes: «Settings» lleva a miembros y el resto solo se alcanza por enlaces sueltos |
| Carga y error | todas | — | No existe ningún `loading.tsx`, `error.tsx` ni `not-found.tsx` |

## Referencias de Mobbin y decisión

| Flujo | Referencias | Decisión |
| --- | --- | --- |
| Navegación en escritorio | [Mercury](https://mobbin.com/screens/18f7213d-0beb-4436-ad3d-0891b5bd5efe), [Monarch](https://mobbin.com/screens/7d9b297a-6ea4-43cb-8da9-5902d0d129ec), [Contra](https://mobbin.com/screens/edffa2dc-27dd-410c-ace9-32d13acfee9d) | Menú vertical en la columna izquierda, debajo del selector de negocio; cabecera fina con logo, idioma y usuario. |
| Navegación en móvil | [Crumbl](https://mobbin.com/screens/5bc8157a-91be-432d-a921-9587a47d0b6f), [Wealthfront](https://mobbin.com/screens/401c6c9f-5ada-41bb-b8dd-f885bf14f357), [Neo Financial](https://mobbin.com/screens/fd0bc623-bb4a-4e6e-a50c-4540b8eaaa95) | Barra de pestañas fija abajo con icono y texto. Las referencias usan 5; aquí hay hasta 8: la barra oculta los enlaces desactivados y «Portfolio» (el logo ya lleva allí) y reparte el ancho entre los que quedan, sin desplazarse de lado. |
| Resumen y vacío | [WeTransfer](https://mobbin.com/screens/ca81503e-bccd-4e5e-abf4-b74d5a9b8937), [Monarch recibos](https://mobbin.com/screens/6d18837d-1154-4f61-8b1b-27a45afc5139), [Square](https://mobbin.com/screens/0dbdbd96-a81f-4a37-a7bf-71ec511aef95) | Cifras que enlazan a su lista, acción principal «subir fotos de facturas» en la cabecera, vacío con título, frase y acción. |
| Ajustes | [Square, ajustes con menú lateral](https://mobbin.com/screens/f81d4ed0-2517-42fe-95fe-f4cfaf316328) | Menú de ajustes como pestañas sobre cada página de ajustes; en el móvil las pestañas pasan a varias líneas en vez de cortarse. |
| Acceso | [Basecamp](https://mobbin.com/screens/b783a5be-7141-4857-a321-c4fba170b3ca), [Square](https://mobbin.com/screens/d3fa9846-a3d7-4a43-aa05-ebe84657161d), [Canny](https://mobbin.com/screens/87cc9229-f674-4af6-82e5-5660fecedec9) | Sin cambios: ya tiene correo, Google y el separador «o» del mismo patrón. |
| Onboarding | [Jitter](https://mobbin.com/screens/bb7aa21e-b25a-42fc-8597-0ec3a1b77b6c), [Stripe](https://mobbin.com/screens/a8484f94-acd5-4f8c-8757-db362b227437) | Sin cambios: dos opciones claras (crear o unirse) y un formulario corto por paso. |
| Administración | [Canva](https://mobbin.com/screens/5bc6bcff-a204-4f8f-a674-f065e5ce2c1c), [Square](https://mobbin.com/screens/5c4fc389-2d59-4ea6-abe4-82408cec0b11) | Sin cambios: tabla con estado en etiqueta y acción por fila, como las referencias. |
| Revisión de factura | [Stripe](https://mobbin.com/screens/4a5c78a0-5152-461a-8f01-15563c488cfa), [Contra](https://mobbin.com/screens/7c710e9e-89bb-4969-8105-332a47e686ce) | Sin cambios: ya pone campos y vista previa en dos columnas, una sola en el móvil. |
| Movimientos y vacíos de lista | [Square](https://mobbin.com/screens/0dbdbd96-a81f-4a37-a7bf-71ec511aef95), [Meetup](https://mobbin.com/screens/6c41ffc7-e6a4-4d5e-b4c1-288a9b015ebc) | Sin cambios en la página: ya explica qué falta y enlaza a dónde arreglarlo. |
| Cierre de ejercicio | [QuickBooks](https://mobbin.com/screens/6bf4a941-f2eb-4d78-b23d-f589405436f8), [Xero](https://mobbin.com/screens/240ea8ec-768b-421d-9ebc-3e47fed5130c) | Sin cambios: tarjetas con cifras y bloqueos con enlace para arreglarlos. |

Las hojas de contacto de las 32 capturas «después» (16 por ancho) muestran el mismo sistema visual en acceso, onboarding, administración y todas las páginas del negocio. Por eso no hizo falta otra pasada de colores ni de tipografía.

## Construcción, en orden

1. `AppShell`: un solo `<nav aria-label="Workspace">` fuera de `<main>` (las pruebas lo exigen), vertical en escritorio, barra inferior en móvil, `aria-current` en la página actual, iconos SVG en línea.
2. Menú de ajustes (`<nav>` propio) solo en `/business/*/settings/*`.
3. `loading.tsx` y `error.tsx` en `(app)` y `(platform)`. El `not-found.tsx` propio se descartó: las páginas sin acceso ya redirigen al portfolio y queda la página 404 de Next.
4. Resumen: acción principal, cifras enlazadas, vacío con acción.
5. Prueba de navegador nueva que fija lo anterior a 390 y 1280 px.

Fuera de alcance (no se toca): la arquitectura de estilos en línea, el acceso y el panel de administración, que ya cumplen.
