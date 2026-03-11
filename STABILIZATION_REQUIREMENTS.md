# Stabilization Requirements

Documento de consolidacion de bugs, requisitos y dudas abiertas detectadas durante la fase post-MVP.

- Fecha: `2026-03-11`
- Estado: `BORRADOR DE REQUISITOS`
- Alcance: comportamiento funcional y UX de la extension VS Code + integracion MCP.
- Fuera de alcance por ahora: implementacion, soluciones tecnicas cerradas y cambios comerciales/licenciamiento.

## 1. Objetivo

Convertir incidencias observadas en requisitos verificables antes de tocar codigo.

## 2. Principios de Documentacion

- No afirmar comportamientos como cerrados si todavia no estan validados.
- Separar claramente `problema observado`, `requisito objetivo`, `criterios de aceptacion` y `preguntas abiertas`.
- Priorizar liberacion segura del hardware y recuperacion limpia de estados UI.

## 3. Requisitos en Definicion

### R1. Toggle MCP OFF debe liberar el hardware de verdad

Problema observado:

- Al desactivar MCP aparece una indicacion visual de que MCP esta deshabilitado, pero el hardware no queda realmente liberado.
- Esto impide usar e2 Studio para depurar si la sesion previa desde VS Code/MCP mantiene el probe o la conexion abierta.

Requisito objetivo:

- Desactivar MCP debe dejar el sistema en un estado en el que el hardware pueda ser usado por e2 Studio sin conflicto, o bien informar explicitamente que la liberacion no se ha completado.

Decision confirmada (2026-03-11):

- `MCP OFF` debe intentar liberar siempre el hardware, aunque para ello tenga que cerrar cualquier sesion de debug abierta por la extension.

Criterios de aceptacion propuestos:

1. Si existe sesion debug/hardware activa iniciada por MCP/extension, `Toggle MCP OFF` debe intentar cerrarla.
2. La UI no debe mostrar `MCP deshabilitado` como estado final si la desconexion real no se ha completado.
3. Si la desconexion falla, el usuario debe recibir un mensaje claro con el motivo y con el estado final real.
4. Tras una desconexion correcta, el estado del plugin no debe retener indicadores ambiguos de sesion activa.

Preguntas abiertas:

1. Si la liberacion falla, preferimos mantener MCP en `ON`, dejarlo en `OFF con warning`, o usar un estado intermedio?
2. Debe existir una accion explicita separada tipo `Release hardware` o el toggle debe cubrir siempre ese caso?

### R2. Definir cuando aparece la seccion Memory

Problema observado:

- No esta definido con precision cuando debe mostrarse la seccion `Memory`.
- No esta claro si depende de `build`, `clean`, `debug`, si debe aparecer siempre, o si debe mostrarse un error cuando no hay datos.

Requisito objetivo:

- La seccion `Memory` debe tener reglas de visibilidad y de estado de datos previsibles para el usuario.

Decision confirmada (2026-03-11):

- La seccion `Memory` debe mostrarse en el panel con estados explicitamente representados.
- Debe mostrarse tambien vacia cuando todavia no haya datos disponibles.
- Como minimo, su presencia y actualizacion deben quedar bien definidas tras `build` y `debug`.

Criterios de aceptacion propuestos:

1. Debe existir una definicion unica de estados posibles: por ejemplo `sin datos`, `datos disponibles`, `datos obsoletos` y `error`.
2. El usuario debe poder distinguir entre `no hay build previa`, `la build fue limpiada`, `fallo al leer el .map` y `datos correctos`.
3. La UI no debe mostrar porcentajes o bytes aparentemente validos cuando los datos reales no lo son.
4. El comportamiento despues de `build`, `clean`, `rebuild` y `debug` debe quedar documentado de forma explicita.

Preguntas abiertas:

1. Tras `clean`, preferimos borrar la informacion anterior o mantenerla marcada como `obsoleta`?
2. `Debug` debe recalcular o refrescar memoria, o solo debe consumir el ultimo resultado de build valido?

### R3. Definir comportamiento de Debug sin build previa

Problema observado:

- No esta cerrado el flujo cuando el usuario lanza `Debug` sin haber hecho antes una build valida.

Requisito objetivo:

- La accion `Debug` debe comportarse de forma determinista cuando no existe artefacto valido para depurar.

Decision confirmada (2026-03-11):

- Si no hay build valida, `Debug` debe lanzar primero una build automatica.
- Si esa build falla, entonces se debe avisar al usuario y no continuar con el flujo de debug.
- Incluso cuando ya exista una build correcta, la estrategia preferida es lanzar build automatica antes de `Debug`.

Criterios de aceptacion propuestos:

1. Antes de iniciar debug, el sistema debe lanzar una build automatica previa y comprobar si el artefacto requerido queda utilizable.
2. Si la build automatica falla, el usuario debe recibir una respuesta clara y el debug no debe continuar.
3. Si la build automatica finaliza correctamente, el flujo de debug puede continuar.
4. Si la precondicion o la build previa fallan, la UI debe volver a estado interactivo normal sin spinner colgado.

Preguntas abiertas:

1. La decision debe ser configurable por usuario/proyecto o fija para todos?

### R4. Deteccion de e2 Studio abierto

Problema observado:

- Existe la necesidad de saber si e2 Studio esta abierto para advertir posibles conflictos de uso del hardware.
- Aun no esta claro si es factible detectarlo de forma robusta o solo de manera heuristica.

Requisito objetivo:

- Si la deteccion es tecnicamente viable, el sistema debe avisar al usuario antes de operaciones con riesgo de conflicto.

Decision confirmada (2026-03-11):

- Si se detecta e2 Studio abierto, el flujo debe pedir confirmacion antes de continuar.
- Para esta fase, la deteccion base recomendada es por proceso abierto de e2 Studio, tratada como `best effort`.

Criterios de aceptacion propuestos:

1. La documentacion debe distinguir entre `deteccion fiable` y `best effort`.
2. Si se implementa una deteccion no fiable al 100%, el mensaje al usuario no debe presentarla como certeza absoluta.
3. En esta fase, el criterio minimo de deteccion sera la presencia del proceso de e2 Studio abierto.
4. El aviso debe dispararse en los puntos de mayor riesgo: al conectar debug, al usar hardware, o al activar MCP si procede.
5. La confirmacion debe permitir al usuario cancelar o continuar conscientemente.
6. La existencia de e2 Studio abierto no debe bloquear acciones automaticamente salvo que se confirme un conflicto real.

Preguntas abiertas:

1. Si e2 Studio esta abierto pero no usa hardware en ese momento, debe avisarse igualmente?

### R5. Los errores no deben dejar la UI bloqueada

Problema observado:

- Cuando hay errores de `Debug`, `Build` u otras acciones, la barra de acciones puede quedarse cargando y los botones quedan bloqueados.

Requisito objetivo:

- Toda accion asincrona debe finalizar siempre en un estado consistente de UI, tanto en exito como en error o cancelacion.

Criterios de aceptacion propuestos:

1. Cualquier accion debe cerrar su estado de carga al terminar, incluso si falla internamente.
2. Los botones deben reactivarse tras error, salvo que exista una razon funcional valida para mantenerlos deshabilitados.
3. El usuario debe ver un mensaje de error resumido y accionable.
4. El fallo de una accion no debe impedir iniciar una accion nueva despues de que la UI vuelva a estado estable.

Preguntas abiertas:

1. Quereis un unico mecanismo global de recuperacion UI o estados separados por accion?
2. Cuando una accion falle, debe conservarse algun contexto visible del error en el panel o basta con notificacion temporal?

## 4. Priorizacion Operativa Propuesta

Orden sugerido de cierre funcional antes de implementar:

1. `R1 Toggle MCP OFF`.
2. `R5 Recuperacion de UI tras errores`.
3. `R3 Debug sin build previa`.
4. `R2 Ciclo de vida de Memory`.
5. `R4 Deteccion de e2 Studio abierto`.

Motivo:

- `R1` y `R5` afectan directamente a control de hardware y recuperacion del flujo.
- `R3` evita estados ambiguos o errores previsibles en debug.
- `R2` impacta UX y confianza en datos.
- `R4` depende mas de viabilidad tecnica y puede requerir enfoque heuristico.

## 5. Decisiones Necesarias del Usuario/Producto

Antes de implementar conviene cerrar, como minimo:

1. Si `Memory` debe mostrarse siempre desde el primer render del panel o basta con garantizarla tras `build`/`debug`.
2. Que semantica exacta debe tener `Memory` despues de `clean`.
3. Si la build automatica previa a `Debug` sera un comportamiento fijo o configurable.
4. Si la deteccion por proceso abierto debe avisar siempre o solo al entrar en operaciones con hardware.

## 6. Recomendacion de Alcance Inicial

- Para la primera implementacion, conviene detectar solo el proceso de e2 Studio abierto.
- Motivo: es una senal barata, entendible y suficientemente util para prevenir conflictos sin introducir heuristicas fragiles sobre workspace o uso real del probe.
- La UX debe presentarlo como aviso preventivo `best effort`, no como prueba concluyente de conflicto.
- Si mas adelante hace falta mayor precision, se puede evaluar una segunda fase orientada a correlacion de workspace o bloqueo real del hardware.