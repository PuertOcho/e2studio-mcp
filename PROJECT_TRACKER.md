# PROJECT TRACKER - e2studio-mcp

- Proyecto: `e2Studio_2024_workspace/e2studio-mcp`
- Stack: Python (`mcp`) + VS Code Extension (TypeScript)
- Ultima actualizacion: 2026-03-10
- Estado global: `MVP funcional` tagged como `v0.1.0` + fase de refinamiento/estabilizacion

## 1. Estado Tecnico

### 1.1 Backend MCP (Python)

- Estado: `COMPLETADO`
- Tools disponibles:
  - Build: `build_project`, `clean_project`, `rebuild_project`, `get_build_status`, `get_build_size`
  - Project/Map: `list_projects`, `get_project_config`, `get_map_summary`, `get_linker_sections`
  - Flash/Debug: `flash_firmware`, `debug_connect`, `debug_disconnect`, `debug_status`
  - Debug: `get_adm_log`
- Resources MCP:
  - `e2studio://build/log`
  - `e2studio://debug/adm/log`
  - `e2studio://project/memory`
  - `e2studio://project/config`

### 1.2 Extension VS Code (`vscode-extension`)

- Estado: `FUNCIONAL`
- Incluye:
  - Panel lateral `E2 MCP`
  - Seleccion de proyecto/debugger
  - Comandos build/clean/rebuild/flash
  - Integracion con debug `renesas-hardware`
  - Consola virtual ADM

### 1.3 Documentacion

- Estado: `ACTUALIZADO` (revisado 2026-03-10)
- README profesional publicado en `README.md`.
- CHANGELOG inicial creado en `CHANGELOG.md`.
- Estructura, ejemplo de config y notas sincronizados con código real.

## 1.4 Hito de Release

- Tag Git creado: `v0.1.0`
- Significado: baseline funcional del MVP para seguir refinando sin perder un punto estable de referencia
- Siguiente objetivo: endurecer packaging/documentacion y preparar cambios incrementales sobre la base `0.1.x`

## 2. Ultimas Decisiones (2026-03-06)

### 2.1 Publicacion publica en VS Code Marketplace

Decisiones confirmadas:

1. Publicar extension de forma publica con publisher oficial.
2. Flujo base de release:
   - `npm install`
   - `npm run compile`
   - `npx @vscode/vsce login <publisher>`
   - `npx @vscode/vsce publish`
3. Versionado por semver para updates (`patch/minor/major`).
4. Completar metadata antes de publicar:
   - `repository`, `homepage`, `bugs`, `keywords`
   - `README.md`, `CHANGELOG.md` en carpeta de extension

### 2.2 Modelo Comercial Freemium (sin costes cloud LLM)

Decisiones confirmadas:

1. Trial gratuito de `14 dias`.
2. Licencia perpetua objetivo: `40 EUR` (rango valido `39-49 EUR`).
3. Monetizacion de sostenibilidad: `upgrade de major version` (ej. v1 perpetua, upgrade opcional a v2).
4. Marketplace no cobra licencias directamente: la venta debe hacerse fuera.
5. Checkout recomendado: `Lemon Squeezy` o `Paddle` (VAT UE/facturacion/fraude).

## 3. Arquitectura de Licenciamiento Aprobada

### 3.1 Activacion

- Metodo: `email + license key`
- Validacion:
  - Online al activar
  - Cache local firmada para uso offline temporal

### 3.2 Offline / Revalidacion

- TTL recomendado para cache: `7 dias`
- Al expirar TTL: intentar revalidacion online
- Si falla conectividad: mantener modo degradado controlado

### 3.3 Trial

- Inicio automatico en primer uso
- Persistencia:
  - `globalState` de VS Code
  - respaldo local firmado
- UX requerida:
  - dias restantes visibles
  - CTA claro: `Activar licencia`

### 3.4 Segmentacion funcional

- Free:
  - funciones basicas de productividad
- Pro:
  - flash/debug avanzado
  - consola pro
  - reportes / extras avanzados

## 4. Riesgos y Mitigaciones

1. Licencia actual en extension: `MIT`.
- Riesgo: conflicto legal/comercial si hay funciones de pago.
- Accion: evaluar cambio a licencia propietaria o dual para la extension.

2. Manipulacion local de fechas/estado trial.
- Riesgo: bypass de trial.
- Accion: no depender solo de fecha local; usar firma + verificacion remota.

3. Secretos en cliente.
- Riesgo: exposicion de claves de firma o logica sensible.
- Accion: no embutir secretos criticos en frontend; usar backend minimo de validacion.

4. Pirateria inevitable en cliente local.
- Riesgo: cracks.
- Accion: objetivo de seguridad realista: `friccion razonable`, no blindaje absoluto.

## 5. Pricing Propuesto

- Early adopters: `29 EUR`
- Precio normal: `39-49 EUR` (objetivo actual: `40 EUR`)
- Upgrade major: `15-25 EUR`

## 6. Backlog Priorizado

### P0 - Publicacion Marketplace

1. Completar metadata de `vscode-extension/package.json`.
2. Completar assets de marketplace.
3. Crear publisher y PAT.
4. Publicar en Marketplace tomando `v0.1.0` como baseline tecnico.

### P0.1 - Estabilizacion post-MVP

1. Cerrar cambios de refinamiento sobre `master` y preparar `v0.1.1` si procede.
2. Evitar artefactos locales en Git (`stderr.txt` y logs similares).
3. Revisar smoke/integration flows del MCP server y de la extension.

### P1 - Licenciamiento MVP

1. Definir proveedor checkout (`Lemon Squeezy` o `Paddle`).
2. Implementar modulo de licencia en extension (`trial + activate + validate`).
3. Implementar endpoint minimo de validacion.
4. Pantalla UX de activacion y estado de trial.

### P2 - Hardening Comercial

1. Politica de upgrades mayores (v1 -> v2).
2. Telemetria opt-in minima para conversion/uso.
3. Pagina comercial/documentacion de planes.

## 7. Proximos Entregables

1. `GO_TO_MARKET_CHECKLIST.md` con pasos operativos de publicacion.
2. `LICENSING_TECH_SPEC.md` con flujo tecnico detallado (trial/activacion/cache/revalidacion).
3. Implementacion de comandos UI: `Activar licencia`, `Ver estado de licencia`, `Comprar`.
