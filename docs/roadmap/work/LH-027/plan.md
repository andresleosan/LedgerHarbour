# OCR de facturas en la VPS

El operador eligió la VPS existente el 20-nov-2026 para evitar el cargo por factura de Document AI. El worker actual ejecutará Tesseract en el mismo runtime de Next.js. Se conserva el adaptador de Google para los despliegues que lo elijan. El OCR local no requiere facturación de Google Cloud ni un servicio de OCR con puerto propio.

1. Añadir el proveedor local detrás de la factory existente. Preparar JPEG, PNG, HEIC, TIFF y PDF en un directorio temporal privado. Acotar páginas, resolución y tiempo. Normalizar con el parser de facturas y exigir revisión humana de los campos reconocidos.
2. Empaquetar las herramientas en una imagen para VPS con usuario sin privilegios. El control de producción admite el selector local sin credenciales de Document AI y mantiene Firebase, PostgreSQL, R2 y rate limiting.
3. Verificar la selección, la extracción y el flujo con facturas sintéticas. Medir la lectura de una factura real autorizada en una instancia con acceso restringido antes de la activación operativa.

## Preparar la instancia

Construir la imagen desde la raíz con `docker build -t ledgerharbour:local-ocr .`. Contiene Next.js, Tesseract, Poppler e ImageMagick. El proceso arranca como usuario `node` y lee las variables en runtime. Proporcionar la configuración de Firebase, PostgreSQL y R2 desde el entorno privado del servicio, fuera del contexto del build. El modo de OCR se fija con `OCR_PROVIDER=local-tesseract`.

En una instancia de prueba autorizada, limitar el puerto de la app a la red privada del proxy o a loopback. El worker necesita escritura en `/tmp` para el documento y las páginas rasterizadas. Montar ese directorio como almacenamiento temporal del contenedor y fijar límites de CPU y memoria. Antes de habilitar el acceso real, verificar Firebase en el dominio elegido y medir duración, memoria y concordancia de fecha, moneda e importes con una factura fotografiada autorizada. Registrar únicamente formatos y resultado de la revisión.

El parser local acepta hasta 15 páginas y deja todos los resultados en revisión. El coste de OCR por llamada es cero y el consumo de CPU y memoria se cubre con la VPS. La activación y el cambio de tráfico forman parte de la publicación operativa.
