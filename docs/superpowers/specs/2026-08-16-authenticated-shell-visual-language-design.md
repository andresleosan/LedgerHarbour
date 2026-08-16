# Authenticated Shell Visual And Language Pass

**Fecha:** 2026-08-16  
**Estado:** Aprobado por el operador para agregar al backlog

## Objetivo

Crear una interfaz autenticada mas minimalista y consistente, eliminando la duplicacion del selector de idioma y unificando las superficies visuales principales de LedgerHarbour.

## Referencias consultadas

- [shadcn/ui](https://ui.shadcn.com): composicion por primitives, superficies sobrias, estados claros y densidad de dashboard.
- [Magic UI](https://magicui.design): microinteracciones y estados de feedback usados con moderacion.
- [Aceternity UI](https://ui.aceternity.com): jerarquia de secciones, cards con foco visual y motion como acento, no como fondo constante.
- [shadcn.io](https://www.shadcn.io): catalogo de bloques reutilizables y consistencia entre componentes.
- [Next.js Ecommerce Starter](https://nextjsecommercestarter.com): navegacion compacta, jerarquia comercial clara y responsive sin sobrecargar el viewport.

Las referencias se usan para extraer patrones estructurales, no para copiar contenido, assets o layouts protegidos.

## Problema actual

`AppShell` ya renderiza `LanguageSwitcher`, mientras upload, invoices, review y varias paginas de settings agregan toolbars locales. Esto produce dos controles de idioma visibles, estilos distintos y mas superficie para perder el parametro `locale`.

## Alcance

- Rediseñar la zona autenticada compuesta por `AppShell`, upload, invoices/review y settings.
- Mantener auth y onboarding fuera de este primer pase porque no usan `AppShell`.
- Convertir `LanguageSwitcher` en el unico selector de idioma de la zona autenticada y ubicarlo en la cabecera global.
- Eliminar selectores y toolbars de idioma duplicados en paginas internas.
- Mantener `locale` en la URL al cambiar idioma, navegar, filtrar invoices o volver a una pagina.
- Unificar primitives visuales para botones, cards, inputs, badges, enlaces, focus states y estados de carga.
- Mantener responsive desktop/mobile, contraste accesible y `prefers-reduced-motion`.

## Design DNA

- **Paleta:** navy `#17313B` para texto y navegacion; teal `#0B7772` para acciones y estado activo; off-white `#F7F8F5` para fondo; coral `#D46D42` para foco, advertencias y errores.
- **Tipografia:** sans limpia del sistema existente, con jerarquia moderada y menos titulos gigantes en pantallas operativas.
- **Tono:** calmado, preciso y operativo.
- **Composicion:** cards claras, bordes finos, radios consistentes, espacios previsibles y una sola llamada a la accion primaria por superficie.
- **Motion:** solo hover, focus, carga y transiciones cortas; ninguna animacion decorativa continua en pantallas de trabajo.

## Reglas de idioma

- `AppShell` es la fuente visual del selector global en la zona autenticada.
- Las paginas internas pueden seguir usando `useUrlLocale` o leer `locale` para resolver copy, pero no deben renderizar otro control de cambio.
- El cambio de idioma conserva pathname, filtros y query params funcionales.
- Los labels accesibles del selector se mantienen traducidos sin mostrar una etiqueta `Language/Idioma` repetida en cada pagina.
- Auth y onboarding conservan sus controles propios hasta una tarea posterior de consolidacion.

## Assets de marca

- La fuente aprobada es `F:\Proyectos\LedgerHarbour\Img\Logo.png`.
- El logo completo se usara en cabecera y login, conservando el nombre accesible `LedgerHarbour`.
- El favicon y el `apple-touch-icon` usaran un recorte cuadrado del emblema del faro, no el wordmark completo, para conservar legibilidad en tamanos pequenos.
- Las copias optimizadas viviran dentro del repositorio en `public/brand/` y los iconos estaticos de Next.js en `src/app/`.
- No se sobrescribira el archivo fuente externo ni se agregaran servicios de terceros para servir los assets.

## Criterios de aceptacion

- Existe un unico selector de idioma visible en cualquier ruta autenticada.
- Cambiar idioma desde la cabecera conserva ruta, filtro de invoices y otros query params no sensibles.
- Upload, invoices, review y settings comparten la misma escala de controles y estados.
- La interfaz no genera overflow horizontal en desktop ni mobile.
- Los estados `hover`, `focus-visible`, `loading`, `error`, `empty` y `disabled` son distinguibles y accesibles.
- `prefers-reduced-motion` reduce las transiciones sin eliminar feedback funcional.
- Playwright verifica el cambio de idioma y no registra errores de consola en las rutas principales.
- El logo completo y el favicon se sirven con formato PNG valido, texto alternativo accesible y sin romper el layout responsive.

## Fuera de alcance

- Reemplazar el stack por Tailwind, shadcn/ui, Magic UI o Aceternity UI como dependencias obligatorias.
- Rediseñar auth/onboarding en la misma tarea.
- Introducir animaciones 3D, fondos generativos o efectos que distraigan del trabajo financiero.
- Cambiar contratos de API, persistencia o permisos.
