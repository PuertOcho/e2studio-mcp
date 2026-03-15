# PROJECT TRACKER - e2studio-mcp

- Proyecto: `e2Studio_2024_workspace/e2studio-mcp`
- Stack: Python (`mcp`) + VS Code Extension (TypeScript)
- Ultima actualizacion: 2026-03-15
- Estado global: `MVP funcional` — estabilizacion completada, pendiente proteccion comercial y publicacion

## 1. Estado Tecnico

### 1.1 Backend MCP (Python)

- Estado: `COMPLETADO`
- Distribucion actual: `.py` fuente directo — **sin proteccion**
- Tools disponibles:
  - Build: `build_project`, `clean_project`, `rebuild_project`, `get_build_status`, `get_build_size`
  - Project/Map: `list_projects`, `get_project_config`, `get_map_summary`, `get_linker_sections`
  - Debug: `debug_start`, `debug_stop`, `debug_status`
  - Console: `get_adm_log`
- Resources MCP:
  - `e2studio://build/log`
  - `e2studio://debug/adm/log`
  - `e2studio://project/memory`
  - `e2studio://project/config`
  - `e2studio://activity/log`

### 1.2 Extension VS Code (`vscode-extension`)

- Estado: `FUNCIONAL — ESTABILIZACION COMPLETADA`
- Distribucion actual: bundle JS con sourcemap — **sin proteccion**
- Licencia actual: `MIT` — **incompatible con modelo comercial**
- Incluye:
  - Panel lateral `E2 MCP`
  - Seleccion de proyecto/debugger/buildConfig/launchFile
  - Comandos registrados: `build`, `clean`, `rebuild`, `flash`, `stopDebug`, `openConsole`, `selectProject`, `selectDebugger`, `selectLaunch`
  - Flash firmware (build + flash via e2-server-gdb + RSP, `runAfterFlash: true`)
  - Debug con build automatica previa + deteccion de e2 Studio abierto
  - Consola virtual ADM en `Output`
  - Deteccion de probe USB y procesos `e2-server-gdb` zombie
  - Command Bridge HTTP (localhost) para backend MCP
  - Toggle MCP async con verificacion de liberacion de hardware
  - Watchdog 30s en UI para recuperacion de spinner
  - Memory con hints contextuales (cleaned/build-failed/none)

### 1.3 Documentacion

- Estado: `SINCRONIZADO` (2026-03-15)
- README, CHANGELOG y tracker alineados con codigo real.

### 1.4 Hito de Release

- Tag Git: `v0.1.0` — baseline funcional del MVP
- Siguiente objetivo: proteccion comercial + publicacion

### 1.5 Estabilizacion Funcional

- Estado: `COMPLETADA` (2026-03-15)
- Todos los requisitos de STABILIZATION_REQUIREMENTS.md implementados y verificados:
  - [x] MCP OFF verifica liberacion de hardware (async + waitForDebugSessionEnd + warning)
  - [x] Memory con semantica post-clean (hints contextuales + placeholders diferenciados)
  - [x] Debug auto-build (si falla, no continua)
  - [x] Deteccion e2 Studio abierto (Get-Process + dialogo confirmacion)
  - [x] Spinner recovery (watchdog 30s)
  - [x] Flash expuesto como comando (build + flash + run, sin sesion de debug)

---

## 2. Proteccion Comercial

### 2.1 Diagnostico Actual (2026-03-15)

| Superficie | Estado | Riesgo |
|------------|--------|--------|
| Backend Python | `.py` en claro | Copia directa trivial |
| Extension JS | Bundle esbuild legible | Ingenieria inversa facil |
| Sourcemap | Excluido del build de produccion y del `.vsix` | Sigue visible solo en desarrollo/watch |
| Licencia | Propietaria en package + LICENSE.txt | Riesgo legal mitigado; falta enforcement tecnico |
| Licenciamiento | No implementado | Sin trial, sin activacion, sin validacion |
| Secretos | No hay secretos en cliente | Correcto, pero sin logica de gating |

### 2.2 Arquitectura de Proteccion — Capas

**Principio**: no existe blindaje absoluto en cliente. Objetivo = `friccion razonable` + valor comercial protegido por capas.

#### Capa 1: Licencia legal (imprescindible, sin codigo)

- Cambiar `MIT` a licencia propietaria o `BSL-1.1` (Business Source License) antes de publicar.
- Definir terminos claros: uso personal gratuito, uso comercial requiere licencia Pro.
- Registrar copyright en README y package.json.

#### Capa 2: Eliminacion de sourcemaps (inmediata, sin coste)

- Quitar `--sourcemap` del script `compile` de esbuild para produccion.
- Mantener sourcemaps solo en modo `watch`/desarrollo.
- Excluir `*.map` en `.vscodeignore` para que no entren en el `.vsix`.

#### Capa 3: Ofuscacion del bundle JS (friccion media)

- Usar `esbuild-plugin-obfuscator` o `javascript-obfuscator` como paso post-build.
- Scope: minify + mangle + control flow flattening en el bundle de produccion.
- No es defensa definitiva pero sube el coste de analisis de horas a dias.

#### Capa 4: Empaquetado del backend Python (friccion alta)

- Compilar `src/e2studio_mcp/` a binario con `Nuitka` (produce `.exe` standalone).
- El MCP server se invocaria como `e2studio-mcp.exe` en vez de `py -m e2studio_mcp`.
- Elimina acceso directo al codigo fuente Python.
- Alternativa menor: `PyInstaller` (mas facil, menos proteccion).

#### Capa 5: Licenciamiento con backend remoto (proteccion real)

- Trial de 14 dias con inicio automatico en primer uso.
- Activacion: `email + license key` validados contra backend remoto.
- Cache local firmada (HMAC) con TTL de 7 dias para uso offline.
- Revalidacion online al expirar TTL. Si falla: modo degradado (solo funciones Free).
- Checkout externo via `Lemon Squeezy` o `Paddle` (VAT/facturacion/fraude).
- **Ningun secreto critico en el cliente**. La clave de firma/validacion vive en el backend.

#### Capa 6: Segmentacion funcional Free/Pro (gating)

- **Free** (sin limite de tiempo):
  - Build/Clean/Rebuild
  - Panel lateral (proyecto, config, memory)
  - `list_projects`, `get_project_config`, `get_build_size`, `get_map_summary`
- **Pro** (requiere licencia activa):
  - Flash
  - Debug (build + flash + debug session)
  - Consola virtual ADM
  - `debug_start`, `debug_stop`, `get_adm_log`
  - `get_linker_sections` (detalle avanzado de secciones)
- **Gating**: las funciones Pro comprueban estado de licencia antes de ejecutar. Si no hay licencia activa, muestran CTA de activacion.

### 2.3 Prioridad de Implementacion

| Orden | Capa | Esfuerzo | Impacto |
|-------|------|----------|---------|
| 1 | Licencia legal (cambiar MIT) | Minimo | Bloquea publicacion |
| 2 | Eliminar sourcemaps en produccion | Minimo | Elimina reconstruccion trivial |
| 3 | Licenciamiento con backend (trial + activacion + gating) | Alto | Proteccion real del modelo de negocio |
| 4 | Ofuscacion del bundle JS | Bajo | Sube coste de ingenieria inversa |
| 5 | Empaquetado Python a binario | Medio | Protege backend de copia directa |

---

## 3. Modelo Comercial

### 3.1 Pricing

| Segmento | Precio |
|----------|--------|
| Early adopters | 29 EUR |
| Precio normal | 40 EUR (rango valido 39-49 EUR) |
| Upgrade major (v1→v2) | 15-25 EUR |

### 3.2 Publicacion Marketplace

- [x] Cambiar licencia a propietaria/BSL antes de publicar.
- [ ] Completar metadata: `repository`, `homepage`, `bugs`, `keywords`.
- [ ] Completar assets: icono, banner, screenshots.
- [ ] Crear publisher `PuertOcho` y PAT en Azure DevOps.
- [ ] Actualizar entorno de release a Node >= 18 (con Node 16.13.0 `vsce package` falla por `ReadableStream is not defined`).
- [ ] Ejecutar flujo de release: `npm run compile:prod` → `vsce package` → `vsce publish`.
- [ ] Mantener versionado semver para updates.

---

## 4. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Copia directa del codigo Python | Alta (`.py` en claro) | Nuitka a binario (Capa 4) |
| Ingenieria inversa del JS | Media (bundle legible) | Quitar sourcemaps (Capa 2) + ofuscar (Capa 3) |
| Bypass de trial por manipulacion de fechas | Media | Firma HMAC + revalidacion remota (Capa 5) |
| Crack local del gating | Baja-media | Gating en backend para funciones criticas si viable |
| Redistribucion del `.vsix` | Baja | Licencia legal + license key por maquina (Capa 1+5) |
| Secretos expuestos en cliente | Nula actualmente | No embutir secretos. Validacion vive en backend |
| Copia/redistribucion pese a licencia propietaria | Media | Licencia legal + license key + gating (Capas 1+5) |

---

## 5. Backlog Priorizado

### P0 — Proteccion Pre-Publicacion (bloquea Marketplace)

- [x] Cambiar licencia de `MIT` a propietaria/BSL en `package.json`, README y LICENSE.txt.
- [x] Eliminar sourcemaps del build de produccion (script `compile:prod` sin `--sourcemap`, con `--minify`).
- [x] Añadir `*.map` a `.vscodeignore` (ya estaba desde el inicio).
- [ ] Completar metadata de `package.json` (`repository`, `homepage`, `bugs`, `keywords`).
- [ ] Completar assets de marketplace (icono, banner, screenshots para listing).
- [ ] Crear publisher `PuertOcho` y PAT en Azure DevOps.

### P1 — Licenciamiento MVP

- [ ] Implementar modulo de licencia en extension (`licenseManager.ts`):
  - [ ] Trial 14 dias con inicio automatico.
  - [ ] Activacion por email + license key.
  - [ ] Cache local firmada (HMAC) con TTL 7 dias.
  - [ ] Revalidacion online al expirar.
  - [ ] Modo degradado (Free) si no hay licencia.
- [ ] Implementar backend minimo de validacion (endpoint `POST /validate`).
- [ ] Implementar gating Free/Pro en comandos de la extension.
- [ ] UX de licencia en panel:
  - [ ] Dias restantes de trial visibles.
  - [ ] CTA `Activar licencia` / `Comprar`.
  - [ ] Estado de licencia en status bar.
- [ ] Definir proveedor checkout (`Lemon Squeezy` o `Paddle`).

### P2 — Hardening de Distribucion

- [ ] Ofuscar bundle JS de produccion (esbuild + javascript-obfuscator).
- [ ] Empaquetar backend Python con Nuitka a `.exe` standalone.
- [ ] Actualizar `mcp.json` template para invocar binario en vez de `py -m`.
- [ ] Crear script de build de release: compile → ofuscar → package → publish.

### P3 — Hardening Comercial

- [ ] Definir politica de upgrades mayores (v1 → v2).
- [ ] Implementar telemetria opt-in minima para conversion/uso.
- [ ] Crear pagina comercial/landing con documentacion de planes.
- [ ] Vincular license key a maquina (machine fingerprint).

### P0.1 — Estabilizacion post-MVP (COMPLETADO)

Todos los items cerrados a 2026-03-15:

- [x] Toggle MCP OFF verifica liberacion HW — async + waitForDebugSessionEnd.
- [x] Memory semantica tras clean — hints contextuales.
- [x] Debug auto-build — si falla, no continua.
- [x] Deteccion e2 Studio abierto — Get-Process + dialogo.
- [x] Spinner recovery — watchdog 30s.
- [x] Flash expuesto como comando — build + flash + run.
- [ ] Validacion en HW: Flash con `runAfterFlash`, smoke test multi-proyecto.

---

## 6. Proximos Pasos Inmediatos

- [x] Cambiar licencia y eliminar sourcemaps (P0, items 1-3).
- [ ] Actualizar Node del entorno release a >= 18 para que `vsce package` funcione.
- [ ] Una vez P0 cerrado: implementar licenciamiento (P1) antes de publicar.
- [ ] Publicar en Marketplace solo cuando P0 + P1 esten cerrados.
