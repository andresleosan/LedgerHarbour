# Development Task Tracking

**Fecha:** 2026-08-19
**Estado:** Implementado en `tasks.md`

## Objetivo

Crear una fuente canonica y mantenible para seguir el trabajo pendiente de LedgerHarbour. El archivo debe separar correcciones productivas, desarrollo funcional, operacion y trabajo futuro sin confundir tareas ya implementadas con especificaciones historicas desactualizadas.

La priorizacion equilibra a propietarios y administradores de negocio, revisores contables y operadores globales. Los riesgos productivos y de seguridad tienen precedencia sobre flujos incompletos, operacion manual y mejoras visuales.

## Ubicacion y formato

El backlog vivira en `tasks.md`, en la raiz del repositorio. Sera la fuente canonica para el estado del desarrollo; documentos de arquitectura, especificaciones y planes conservaran el detalle de cada decision, pero no reemplazaran el estado de `tasks.md`.

El archivo tendra estas secciones:

1. Reglas de seguimiento.
2. Resumen activo ordenado por prioridad y puntuacion.
3. P0: errores y riesgos productivos.
4. P1: flujos funcionales incompletos.
5. P2: operacion y documentacion.
6. P3: mejoras futuras.
7. Completadas recientemente.

Cada tarea activa incluira:

- ID estable `LH-NNN`.
- Prioridad `P0` a `P3`.
- Estado.
- Usuario afectado.
- Puntuacion RICE simplificada.
- Motivo y consecuencia de postergarla.
- Dependencias y limites de alcance.
- Criterios de aceptacion verificables.
- Evidencia requerida para aprobarla o desplegarla.

## Estados

- `pendiente`: alcance definido, trabajo no iniciado.
- `en progreso`: existe trabajo activo sobre la tarea.
- `revision`: implementacion terminada, aun bajo autocritica o revision independiente.
- `aprobada`: seguridad y pruebas pasaron con evidencia real.
- `desplegada`: commit publicado, deployment exitoso y verificacion productiva completada cuando aplica.
- `bloqueada`: falta una decision, credencial, autorizacion o correccion que impide avanzar.

Solo puede existir una tarea `en progreso` por agente coordinador. Una tarea no pasa a `aprobada` sin el comando y resultado real de sus pruebas. Un hallazgo critico de seguridad la mueve a `bloqueada`. Produccion, billing, migraciones y gasto requieren confirmacion explicita del operador.

## Priorizacion

Se usa RICE simplificado con valores del 1 al 5:

- Alcance: cantidad relativa de usuarios afectados.
- Impacto: efecto sobre seguridad, continuidad o valor del producto.
- Confianza: certeza de que el problema y la solucion estan entendidos.
- Esfuerzo: puntuacion inversa, donde 5 significa poco trabajo.

`RICE = (Alcance + Impacto + Confianza + Esfuerzo) / 4`.

La prioridad prevalece sobre el puntaje cuando hay un riesgo productivo o de seguridad. RICE ordena tareas dentro de un nivel y deja visible por que una mejora futura no desplaza una correccion urgente.

## Backlog inicial

| ID | Prioridad | Estado | Tarea | Usuario principal | RICE |
|---|---|---|---|---|---:|
| LH-001 | P0 | pendiente | Corregir hidratacion de fechas en `/admin` | Operador global | 4.50 |
| LH-002 | P0 | pendiente | Incorporar deteccion de errores de consola en E2E | Todos | 4.00 |
| LH-003 | P1 | pendiente | Crear verificacion productiva segura para usuario ordinario | Operador global | 4.25 |
| LH-004 | P2 | pendiente | Actualizar `README.md`, `docs/STACK.md` y estado productivo | Equipo tecnico | 3.75 |
| LH-005 | P2 | pendiente | Verificar alertas y limites de Document AI, R2 y Upstash | Operador global | 4.25 |
| LH-006 | P2 | pendiente | Resolver warning `allowedDevOrigins` del harness | Equipo tecnico | 3.50 |
| LH-007 | P3 | pendiente | Consolidar idioma en auth y onboarding | Usuarios finales | 3.25 |
| LH-008 | P3 | pendiente | Definir automatizacion opcional de vencimiento de servicio | Operador global | 2.75 |

### LH-001: hidratacion de fechas

Fijar una zona horaria determinista al formatear fechas en `PlatformAdminPanel`. El servidor de Vercel usa UTC y el navegador verificado usa `America/Bogota`; fechas tempranas en UTC actualmente producen texto distinto y React `#418`.

Criterios de aceptacion:

- Servidor y cliente renderizan el mismo dia para los mismos valores ISO.
- Existe una prueba que falla si reaparece la diferencia por zona horaria.
- `/admin` no registra errores de hidratacion en desarrollo ni produccion.

### LH-002: consola como gate E2E

Hacer que los recorridos E2E criticos fallen ante `console.error` o `pageerror`, con una lista explicita y minima de excepciones si alguna biblioteca externa lo exige.

Criterios de aceptacion:

- Login, onboarding, shell autenticado y panel global capturan errores de navegador.
- La prueba demuestra que un error sintetico provoca fallo.
- El reporte identifica URL y mensaje sin exponer datos sensibles.

### LH-003: usuario ordinario productivo

Definir una cuenta de prueba dedicada y un procedimiento reversible para comprobar que un usuario autenticado sin membresia global termina en `/onboarding` y no puede abrir `/admin`.

Criterios de aceptacion:

- No se usan credenciales personales ni se guardan secretos en Git.
- La cuenta no obtiene `platform_members` ni permisos globales.
- La verificacion registra resultados sin conservar cookies o tokens.
- Existe un procedimiento de limpieza o reutilizacion controlada de la identidad.

### LH-004: documentacion del estado real

Actualizar documentos que aun describen un MVP exclusivamente local o providers pendientes, contrastandolos con la configuracion productiva efectivamente verificada.

Criterios de aceptacion:

- `README.md` distingue desarrollo, test y produccion actual.
- `docs/STACK.md` refleja Firebase, Neon, Vercel y Document AI sin afirmar activaciones no verificadas.
- `docs/production-activation.md` separa pasos completados de controles operativos recurrentes.

### LH-005: controles operativos de proveedores

Verificar, sin activar gasto nuevo, limites de cuota, alertas y minimo privilegio para Document AI, R2 y Upstash.

Criterios de aceptacion:

- Cada proveedor tiene estado de alerta, cuota y responsable documentado.
- No se cambia de plan ni se activa billing sin confirmacion explicita.
- Cualquier credencial innecesariamente amplia se rota mediante un procedimiento aprobado.

### LH-006: origen del harness

Configurar el origen de desarrollo usado por Playwright para eliminar el warning futuro de Next.js sin ampliar origenes productivos.

Criterios de aceptacion:

- El E2E completo no muestra el warning de `allowedDevOrigins`.
- Produccion no agrega origenes de desarrollo.
- El cambio se limita al entorno del harness.

### LH-007: idioma en auth y onboarding

Extender la consolidacion del selector global de idioma a las superficies excluidas del primer pase visual, conservando rutas, query params y accesibilidad.

Criterios de aceptacion:

- Solo existe un selector visible por pantalla.
- Login, registro y onboarding conservan idioma durante su flujo.
- Desktop y mobile no presentan overflow ni errores de consola.

### LH-008: vencimiento de servicio

Realizar discovery de producto antes de decidir si `serviceExpiresAt` debe seguir informativo, emitir avisos o suspender automaticamente. No se implementa suspension automatica sin aprobar reglas, tolerancias y recuperacion.

Criterios de aceptacion:

- Se documentan usuario afectado, metricas, reglas temporales y casos limite.
- La propuesta incluye avisos, auditoria, rollback y comportamiento ante fallos.
- El operador aprueba una alternativa antes de crear un plan de implementacion.

## Historial inicial

La seccion de completadas registrara el cambio de navegacion post-login como desplegado:

- Ruta server-side `/auth/continue`.
- Administradores globales enviados a `/admin`; usuarios ordinarios a `/onboarding`.
- Commit `4f2f325` publicado en `main`.
- Vercel y GitHub Actions completados correctamente.

## Mantenimiento

- Cada tarea nueva recibe el siguiente ID y no reutiliza IDs archivados.
- Cambiar prioridad requiere actualizar la justificacion o RICE.
- La evidencia se agrega como comando, resultado, commit o URL de deployment; no como una afirmacion sin verificar.
- Una tarea grande se divide antes de pasar a `en progreso` si mezcla subsistemas independientes.
- Las ideas sin criterios de aceptacion quedan fuera del backlog activo hasta completar discovery.

## Fuera de alcance

- Convertir GitHub Issues en la fuente primaria.
- Generar sincronizacion automatica entre documentos e issues.
- Reescribir especificaciones o planes historicos.
- Marcar como pendiente una especificacion antigua sin contrastarla con codigo, pruebas y commits actuales.
