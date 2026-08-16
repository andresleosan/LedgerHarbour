# Google Document AI Invoice OCR

**Fecha:** 2026-08-16  
**Estado:** Aprobado por el operador para planificacion

## Objetivo

Reemplazar el `FakeOcrProvider` de produccion por Google Cloud Document AI Invoice Parser y conectar la subida privada de documentos con el flujo existente de borrador y revision manual de facturas.

## Alcance

- Agregar un adapter `OcrProvider` para Google Document AI Invoice Parser.
- Mantener `FakeOcrProvider` para desarrollo y pruebas deterministas.
- Resolver el proveedor mediante `OCR_PROVIDER` sin fallback silencioso a OCR falso.
- Configurar credenciales y processor mediante variables de entorno privadas.
- Mapear entidades de Google a los campos actuales de `OcrResult`.
- Exponer errores genericos al cliente y conservar el detalle solo en logs seguros.
- Hacer que el usuario inicie el procesamiento con una accion explicita despues de subir el documento.
- Ejecutar el job existente en el endpoint de proceso para el prototipo, sin agregar infraestructura de colas.
- Reutilizar la pantalla y los endpoints existentes de revision manual.

## Fuera de alcance

- Crear automaticamente un proyecto, processor, cuenta de servicio o billing en Google Cloud.
- Guardar credenciales en el repositorio o en el navegador.
- Procesamiento batch asincrono para documentos de mas de 15 paginas.
- Extraccion de line items, proveedores aprendidos o entrenamiento de un modelo propio.
- Cambios de esquema o migraciones de base de datos.
- Activar el proveedor en produccion sin que existan las variables y credenciales configuradas.
- Aplicar cambios de produccion sin confirmacion explicita del operador.

## Arquitectura

### Contrato interno

`GoogleDocumentAiInvoiceProvider` implementara el contrato `OcrProvider` existente. El cliente de Google sera una dependencia del adapter y no se usara desde rutas, componentes ni servicios de facturas.

El worker seguira siendo responsable de:

1. Validar negocio, documento y membresia.
2. Leer los bytes desde el storage privado.
3. Invocar el provider.
4. Convertir el resultado a `InvoiceDraft` mediante `parseInvoice`.
5. Crear la factura y cambiar el estado del documento.
6. Reintentar el job como ya define el worker, con un maximo de tres intentos y mensaje publico generico.

Para el prototipo, el endpoint de proceso crea o reutiliza el job y ejecuta el worker antes de devolver el resultado. No se agregara un scheduler ni un servicio externo de workers. Si las mediciones muestran timeouts o latencia inaceptable, se tratara como una fase de escalabilidad separada.

### Configuracion

Produccion requerira:

```text
OCR_PROVIDER=google-document-ai
GOOGLE_CLOUD_PROJECT_ID=<project id>
GOOGLE_CLOUD_LOCATION=<us|eu>
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=<invoice parser id>
GOOGLE_SERVICE_ACCOUNT_JSON=<json privado de la cuenta de servicio>
```

Desarrollo mantendra:

```text
OCR_PROVIDER=fake
```

Si `OCR_PROVIDER=google-document-ai` y falta cualquier variable requerida, la factory fallara cerrado con un error de configuracion no sensible. Nunca se usara `FakeOcrProvider` como fallback automatico en ese caso.

La cuenta de servicio tendra solo los permisos necesarios para procesar documentos con Document AI. El JSON se almacenara unicamente en el gestor de secretos del entorno de ejecucion. Nunca se imprimira la respuesta completa de Google ni el contenido del documento en logs.

### Flujo de usuario

1. El usuario sube el archivo y el backend lo valida y guarda en R2 privado.
2. La pantalla confirma la subida y muestra `Procesar con OCR`.
3. El cliente llama al endpoint de proceso autenticado.
4. El endpoint valida el cuerpo estricto y la pertenencia al negocio.
5. El worker lee el objeto privado y llama a Document AI.
6. El adapter mapea el resultado al contrato interno.
7. El servicio crea un borrador de factura con sus confianzas.
8. La interfaz enlaza a la revision manual existente.
9. El usuario corrige los campos de baja confianza y aprueba con la capacidad actual.

Una llamada OCR no se hara automaticamente al cargar la pagina. La accion explicita reduce llamadas accidentales y hace visible el costo potencial al operador.

## Mapeo de datos

El adapter extraera `mentionText`, `confidence` y valores normalizados cuando existan. El mapeo inicial sera:

| Entidad Document AI | Campo interno |
|---|---|
| `supplier_name` | `supplier` |
| `invoice_id` | `invoiceNumber` |
| `invoice_date` | `invoiceDate` |
| `due_date` | `dueDate` |
| `net_amount` | `subtotal` |
| `total_tax_amount` | `taxAmount` |
| `total_amount` | `total` |
| `currency` | `currencyReference` |

Los campos no presentes en la respuesta quedan en `null` con confianza `0`. `expenseCategoryReference` y `notes` no se inventan y quedan en `null` salvo que el contrato del processor entregue una fuente segura para ellos.

Las fechas se normalizaran a `YYYY-MM-DD`; los importes a strings decimales compatibles con `parseInvoice`. Si el resultado no cumple el contrato, el worker marca el job y documento como fallidos sin crear una factura parcial.

## Errores, reintentos y degradacion

- Respuestas 4xx de configuracion o formato: error controlado y no reintentable; el job se marca fallido sin volver a cobrar la misma solicitud.
- Respuestas 429, 5xx o timeout del SDK: el job usa el limite existente de tres intentos.
- No se agregaran reintentos internos al adapter, para no multiplicar llamadas ni costos sin control.
- El cliente recibe solo codigos y mensajes publicos genericos.
- El job conserva `OCR processing failed.` como resumen publico.
- El documento se mantiene disponible para descarga privada y queda en estado `failed` cuando el procesamiento no converge.
- El usuario puede volver a intentar mediante el flujo de proceso existente solo mientras el job no haya agotado los tres intentos.

## Costo y operacion

La pagina oficial de precios de Google Document AI publica `US$0.10` por documento de hasta 10 paginas para Invoice Parser. Orden de magnitud:

- 100 documentos/mes: aproximadamente `US$10`.
- 1.000 documentos/mes: aproximadamente `US$100`.

El costo real depende de paginas, cuotas, creditos y moneda de la cuenta. Antes de habilitar produccion se documentara el proyecto, processor, billing y una alerta presupuestaria de Google Cloud. Una alerta no es un limite duro; el operador conserva la decision de habilitar billing y desplegar.

## Pruebas y aceptacion

- Unitarias del adapter con respuestas representativas de Document AI, incluyendo campos ausentes, fechas normalizadas, importes y confianza baja.
- Unitarias de la factory para `fake`, `google-document-ai` y configuracion incompleta.
- Integracion del worker con provider inyectado: exito, fallo, reintentos, autorizacion y no filtrado de detalles.
- Regresion de las rutas de proceso y revision manual.
- E2E local con `FakeOcrProvider` para subida, proceso, revision y aprobacion.
- E2E real de produccion solo despues de configurar el processor y las credenciales, usando un documento de prueba no sensible.

La tarea no se considera aprobada hasta que pasen tests, lint, TypeScript, build, audit y una prueba real del flujo cuando el entorno de Google este configurado.

## Riesgos conocidos

- El procesamiento sincrono puede exceder el timeout de Vercel para documentos grandes; el limite inicial sera el de procesamiento online de Document AI y se medira antes de ampliar alcance.
- Una cuenta con billing habilitado puede generar gasto aunque la alerta presupuestaria no bloquee consumo.
- La calidad de los campos depende del formato y lenguaje de las facturas; la revision manual continua siendo obligatoria para baja confianza.
