# Google Document AI para facturas

Este documento describe la configuracion operativa del adapter de Google Document AI Invoice Parser. No crea recursos, no activa billing y no contiene credenciales.

## Preparacion de Google Cloud

1. Crea o selecciona un proyecto de Google Cloud dedicado al entorno que procesara facturas.
2. Habilita la API **Document AI API** en ese proyecto.
3. Crea un processor **Invoice Parser** en la misma region que usara el runtime: `us` o `eu`.
4. Registra el processor ID. No confundas el ID con el nombre completo del processor.
5. Crea una cuenta de servicio dedicada para este adapter y asignale el rol predefinido `roles/documentai.apiUser`.

`roles/documentai.apiUser` permite procesamiento online y batch, sin permisos de administracion de processors. No asignes roles de propietario, editor ni administrador de Document AI a esta cuenta.

## Variables de runtime

Configura estas cuatro variables de Google antes de activar el proveedor:

| Variable | Valor esperado |
|---|---|
| `GOOGLE_CLOUD_PROJECT_ID` | ID del proyecto de Google Cloud |
| `GOOGLE_CLOUD_LOCATION` | `us` o `eu`, igual que la region del processor |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | ID del Invoice Parser |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de la cuenta de servicio, almacenado como secreto |

En Vercel, guarda el JSON como el secreto de runtime `GOOGLE_SERVICE_ACCOUNT_JSON`. Nunca lo guardes en Git, en un archivo `.env` versionado, en un navegador, en logs ni en tickets. Usa el gestor de secretos del entorno para produccion; `.env.example` solo contiene placeholders.

Mantén `OCR_PROVIDER=fake` en desarrollo local y en pruebas deterministas. Cambia a `OCR_PROVIDER=google-document-ai` solamente cuando las cuatro variables anteriores existan y hayan sido validadas por el operador. La factory falla cerrado si falta una variable, el JSON no es valido o la configuracion no cumple el contrato; no cambia silenciosamente a `FakeOcrProvider`.

## Limites y comportamiento

El flujo usa procesamiento online sincrono. El limite operativo inicial es de 15 paginas por documento. No habilites documentos mayores sin una decision y una medicion separadas.

El worker conserva estos resultados operativos:

- Errores 4xx son terminales y no deben reintentarse, excepto `429`, que el adapter clasifica como transitorio por rate limiting.
- Errores transitorios, como `429`, `500`, `502`, `503`, `504` y los codigos gRPC equivalentes, se reintentan de forma acotada; el worker no supera tres intentos.
- Los errores genericos del cliente, de configuracion, autenticacion o permisos son terminales y se exponen solo como un resumen publico generico.
- `FakeOcrProvider` es el fallback explicito para desarrollo y pruebas locales. No es un fallback automatico para produccion.

La primera activacion real requiere una prueba operativa controlada con un documento permitido, credenciales validas y el processor correcto. Esa prueba no forma parte de esta configuracion documental.

## Costos y control

El precio oficial de referencia para Invoice Parser es **US$0.10 por conteo de Invoice Parser de hasta 10 paginas**. El costo mensual depende del volumen procesado y de los precios vigentes de Google Cloud.

Antes de activar `OCR_PROVIDER=google-document-ai` en produccion, configura y verifica una alerta de presupuesto de Google Cloud. La alerta no establece por si sola un tope duro de consumo; el operador debe revisar tambien los permisos, el volumen esperado y el comportamiento del worker.

Estado actual: `billing alert: required/not verified`. La configuracion de la alerta y cualquier activacion de billing quedan fuera de este trabajo y requieren accion explicita del operador.
