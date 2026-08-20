# LH-003 Verificacion segura de usuario ordinario en produccion

**Fecha:** 2026-08-20
**Estado:** Aprobada para planificacion documental

## Objetivo

Definir un runbook repetible y seguro para comprobar en produccion que una identidad ordinaria autenticada no obtiene privilegios globales. Esta fase documenta el procedimiento; no crea cuentas, no cambia secretos, no inicia sesion en produccion y no ejecuta migraciones.

## Alcance aprobado

La futura ejecucion verificara, en este orden:

1. El operador confirma una identidad dedicada y una ventana de prueba.
2. Una consulta read-only comprueba que la identidad no tiene una membresia activa en `platform_members`.
3. El operador inicia sesion manualmente con la identidad aprobada.
4. La aplicacion continua a `/onboarding`.
5. Una navegacion directa a `/admin` es denegada y no expone detalles internos.
6. Se registra evidencia redactada.
7. Se cierra la sesion y se aplica la politica elegida de reutilizacion controlada o desactivacion.

Queda fuera de esta fase:

- Crear, editar, promover o eliminar identidades de produccion.
- Cambiar secretos, permisos, membresias o configuracion de hosting.
- Ejecutar migraciones, acciones de escritura o solicitudes pagas.
- Automatizar credenciales o almacenar sesiones persistentes.
- Usar cuentas personales o credenciales de produccion no dedicadas.

## Datos y seguridad

- La identidad debe ser dedicada a pruebas y aprobada explicitamente por el operador.
- La contrasena se introduce manualmente o mediante un gestor temporal; nunca se escribe en chat, Git, logs o reportes.
- La consulta de membresia registra solo identidad redactada, existencia o ausencia de membresia y, si es necesario, rol/estado sin valores sensibles.
- La evidencia browser conserva unicamente timestamp UTC, entorno, deployment/commit verificado, rutas relevantes, resultado de redireccion y estado de denegacion.
- No se guardan cookies, tokens Firebase, `storageState`, HTML, screenshots con datos personales, headers ni cuerpos completos de API.
- La sesion se cierra al terminar. El runbook exige elegir y registrar una politica de reutilizacion controlada o desactivacion manual, sin ejecutar ninguna de las dos automaticamente.

## Flujo operativo futuro

### Prerrequisitos

- Identidad de prueba dedicada aprobada.
- Ventana de prueba y entorno de produccion confirmados.
- Acceso read-only para comprobar `platform_members`.
- Destino seguro y redactado para la evidencia.
- Confirmacion de que no se usaran cuentas personales ni credenciales compartidas.

### Verificacion

- Confirmar el deployment y entorno objetivo sin registrar secretos.
- Consultar read-only la membresia de la identidad y detenerse si existe una membresia global activa.
- Iniciar sesion manualmente.
- Confirmar que el flujo termina en `/onboarding`.
- Navegar directamente a `/admin`.
- Confirmar denegacion generica, ausencia de panel global y ausencia de detalles de autorizacion.
- Cerrar sesion y verificar que la sesion del navegador no se conserva.

### Detencion inmediata

Detener la prueba y no corregir en caliente si ocurre cualquiera de estos casos:

- La identidad no coincide con la aprobada.
- La consulta read-only no puede confirmar la ausencia de membresia.
- La identidad obtiene acceso a `/admin`.
- La respuesta o interfaz revela detalles internos de autorizacion.
- Se detectan cookies, tokens o datos personales en la evidencia.
- La limpieza de sesion no puede confirmarse.

## Evidencia

El reporte redactado debe contener:

- Fecha y hora UTC.
- Entorno y deployment/commit verificado.
- Identidad redactada, nunca el secreto.
- Resultado de la consulta read-only de `platform_members`.
- Resultado de login y ruta final `/onboarding`.
- Resultado de acceso directo a `/admin`.
- Resultado de cierre y limpieza de sesion.
- Incidencias y clasificacion, sin bodies, headers, cookies, tokens ni HTML.

La evidencia no debe afirmar que una prueba fue ejecutada si solo se reviso el procedimiento. La ejecucion real requiere un checkpoint separado y confirmacion explicita del operador.

## Reutilizacion y limpieza

El operador debe elegir una de estas politicas antes de ejecutar:

- **Reutilizacion controlada:** conservar la identidad dedicada, documentar propietario, proposito y fecha de proxima revision; no conservar sesiones ni credenciales en el repositorio.
- **Desactivacion manual:** desactivar la identidad y verificar que no quede acceso; registrar solo el resultado redactado.

El runbook no ejecuta automaticamente ninguna politica porque ambas cambian estado de produccion.

## Criterios de aceptacion

- Una persona operadora puede ejecutar el procedimiento sin pasos ambiguos.
- La identidad es dedicada y no personal.
- La ausencia de membresia activa se verifica read-only.
- El login continua a `/onboarding`.
- `/admin` queda denegado sin detalles internos.
- No se almacenan contrasenas, cookies, tokens ni storage state.
- La politica de reutilizacion o limpieza queda elegida antes de la ejecucion.
- La ejecucion real permanece bloqueada hasta una confirmacion explicita separada.

## Dependencias y riesgos

- Requiere identidad y ventana aprobadas por el operador.
- Requiere un mecanismo read-only de consulta a produccion con minimo privilegio.
- El acceso manual reduce automatizacion, pero evita persistencia de secretos y sesiones.
- Una futura automatizacion solo debe considerarse despues de demostrar que la verificacion sera recurrente y definir un gestor de secretos temporal, retencion y revocacion.
