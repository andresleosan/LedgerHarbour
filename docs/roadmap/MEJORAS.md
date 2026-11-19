# Mejoras que no bloquean un cierre

Formato: `- [ID] qué mejorar · por qué · fecha`. Cuando no quede nada construible, lo que valga la pena pasa a ser una ficha y el resto se borra.

- [LH-017] Un importe leído con más de dos decimales (por ejemplo «1,2345») debería ir a revisión · hoy se guarda tal cual y la base lo redondea · 2026-11-19
- [LH-016] Tras leer una factura, enlazar a su revisión y no a la lista · la respuesta de lectura solo trae el trabajo, no la factura · 2026-11-19
- [LH-018] En la pantalla de revisión, los mensajes de error de la carga inicial no siguen un cambio de idioma hecho después · el efecto solo depende del identificador de la factura · 2026-11-19
- [LH-019] Una forma solo de pruebas de provocar una lectura fallida en el navegador · hoy «Leer de nuevo» y «Rellenar a mano» no se ejercitan en e2e · 2026-11-19
- [LH-016] La prueba de subida aún simula el 409 del duplicado · LH-019 arregló el 500 del servidor de desarrollo; falta ver si la puerta de consola admite un 409 real · 2026-11-19
- [LH-014] native-schema.test.ts fija el orden de dos tablas que una base real con otra colación puede ordenar al revés · solo se ha corrido en PGlite · 2026-11-19
- [LH-014] Los documentos que citan la migración 0007 como la última (docs/STACK.md, rate-limiting, production-activation) no nombran 0008 ni 0009 · 2026-11-19
- [LH-019] La ruta de rellenar a mano no tiene límite de peticiones propio · las demás acciones de lectura sí · 2026-11-19
- [LH-020] Guardar un borrador de factura no comprueba el permiso de finanzas, solo la pertenencia al negocio · hoy los tres roles lo tienen; si aparece un rol sin él sería un fallo de permisos · 2026-11-19
- [LH-020] La ruta antigua PATCH /api/invoices/{id} lee el cuerpo sin límite de tamaño · la de revisión sí lo tiene · 2026-11-19
- [LH-015] Dos ediciones simultáneas de fechas en ejercicios cerrados podrían solaparse · no hay bloqueo · 2026-11-19
- [LH-015] Los eventos de auditoría nuevos guardan como tipo de entidad el nombre de la acción · falta mapearlos en el repositorio de tenencia · 2026-11-19
- [LH-024] La ruta del informe de control ejecuta la escritura completa y no tiene límite de peticiones · la descarga sí · 2026-11-19
- [LH-024] Los atributos spans de las filas se conservan tal cual; una celda nueva puede quedar fuera · no ocurre con el libro real; Excel lo trata como pista opcional, sin confirmar · 2026-11-19
- [LH-031] Reimportar la plantilla cuenta todos los rótulos como «actualizados» aunque no cambien · 2026-11-19
