# PROJECT TRACKER — e2studio-mcp

> **Ubicación:** `e2Studio_2024_workspace/e2studio-mcp/`
> **Stack:** Python + MCP SDK (`mcp` package), servidor stdio
> **Inicio:** Marzo 2026
> **Última actualización:** 2026-03-06 (Debug Nativo VS Code + ADM Console)

---

## Resumen del Proyecto

Servidor MCP (Model Context Protocol) que permite a editores de código (VS Code Copilot, Claude, etc.) controlar **e2 Studio / Renesas RX** para:
- Compilar/limpiar proyectos headless
- Inspeccionar configuración de proyectos (.cproject)
- Parsear archivos .map para análisis de memoria
- Grabar firmware al target via E2 Lite

### Arquitectura

```
VS Code Copilot ──MCP stdio──► e2studio-mcp (Python)
                                    │
                   ┌────────────────┼────────────────────┐
                   ▼                ▼                    ▼
             Build Module     Project Module        Flash Module
             (make / e2studioc)  (.cproject parser)  (e2-server-gdb)
                   │                │                    │
                   ▼                ▼                    ▼
             CCRX Toolchain   XML Config            E2 Lite HW
             (ccrx, rlink)    (.map, .project)      (GDB + target)
```

---

## Entorno Detectado

| Componente | Ruta | Versión |
|-----------|------|---------|
| e2 Studio | `C:\Renesas\e2_studio\eclipse\` | — |
| e2studioc (headless CLI) | `C:\Renesas\e2_studio\eclipse\e2studioc.exe` | — |
| CCRX Toolchain | `C:\Program Files (x86)\Renesas\RX\3_7_0\bin\` | v3.07.00 |
| CCRX Toolchain (alt) | `C:\Program Files (x86)\Renesas\RX\3_6_0\bin\` | v3.06.00 |
| e2-server-gdb | Referenciado en .launch: `${renesas.support.targetLoc:rx-debug}\e2-server-gdb` | — |
| Make | Generado en `HardwareDebug/makefile` por e2 Studio | — |

### Proyectos e2 Studio en el Workspace

| Proyecto | Device | Toolchain | Configuración |
|----------|--------|-----------|---------------|
| `headc-fw` | R5F5651E (RX651) | CCRX v3.07.00, RXv2, Big Endian | HardwareDebug |
| `headc_v2_fw` | R5F565NE (RX65N) | CCRX | HardwareDebug |
| `headc-v2-bloader` | — | CCRX | HardwareDebug |

### Launch Configs (headc-fw)

| Launch | Descripción |
|--------|-------------|
| `headc-fw HardwareDebug.launch` | Debug estándar via E2 Lite (RX) |
| `headc-fw BORRA-DATA-FLASH.launch` | Debug + borra data flash |
| `headc-fw NO BORRA-DATA-FLASH.launch` | Debug sin borrar data flash |
| `headc-fw SOLO_TEST.launch` | Solo test |

### Debug Config (E2 Lite)

| Parámetro | Valor |
|-----------|-------|
| JTAG Device | E2 Lite (RX) |
| Target Device | R5F5651E |
| GDB Executable | `rx-elf-gdb -rx-force-v2` |
| GDB Port | 61234 |
| Input Clock | 24 MHz (27 MHz en serverParam) |
| ID Code | `FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF` |
| Work RAM Address | 0x3fdd0 (size 0x230) |

---

## Estado General

| Categoría | Tool | Estado | Prioridad | Notas |
|-----------|------|--------|-----------|-------|
| **Scaffold** | Proyecto Python + pyproject.toml | ✅ Completado | P0 | `pyproject.toml` con hatchling |
| **Scaffold** | Config loader (e2studio-mcp.json) | ✅ Completado | P0 | `config.py` + `e2studio-mcp.json` |
| **Scaffold** | MCP server con stdio loop | ✅ Completado | P0 | FastMCP SDK, 13 tools registradas |
| **Scaffold** | `.vscode/mcp.json` para registro | ✅ Completado | P0 | `py -3 -m e2studio_mcp.server` |
| **Build** | `build_project` | ✅ Completado | P1 | make / e2studioc configurable |
| **Build** | `clean_project` | ✅ Completado | P1 | make clean / e2studioc headless |
| **Build** | `rebuild_project` | ✅ Completado | P1 | clean + build secuencial |
| **Build** | `get_build_status` | ✅ Completado | P1 | Parsear errores/warnings CCRX |
| **Build** | `get_build_size` | ✅ Completado | P1 | ROM/RAM/DataFlash desde .map |
| **Project** | `list_projects` | ✅ Completado | P2 | Detecta 3 proyectos reales |
| **Project** | `get_project_config` | ✅ Completado | P2 | Parser XML de .cproject (58 includes, 9 defines) |
| **Project** | `get_map_summary` | ✅ Completado | P2 | Parser de .map CCRX con ATTRIBUTE column |
| **Project** | `get_linker_sections` | ✅ Completado | P2 | ROM/RAM/DATA_FLASH clasificación |
| **Flash** | `flash_firmware` | ✅ Completado | P3 | Via e2-server-gdb + rx-elf-gdb |
| **Flash** | `debug_connect` | ✅ Completado | P3 | Levantar GDB server |
| **Flash** | `debug_disconnect` | ✅ Completado | P3 | Cerrar sesión debug |
| **Flash** | `debug_status` | ✅ Completado | P3 | Estado E2 Lite |
| **Resources** | `e2studio://build/log` | ✅ Completado | P4 | Último log compilación |
| **Resources** | `e2studio://project/memory` | ✅ Completado | P4 | ROM 24.5%, RAM 71.1%, DF 15.1% |
| **Resources** | `e2studio://project/config` | ✅ Completado | P4 | Config activa proyecto |

---

## Detalle por Categoría

### 0. Scaffold — ✅ COMPLETADO

**Objetivo:** Crear estructura de proyecto Python MCP funcional con config y registro en VS Code.

#### Archivos a crear

```
e2studio-mcp/
├── pyproject.toml              # Dependencias: mcp, lxml
├── README.md
├── e2studio-mcp.json           # Config paths + modo build + flash
├── .gitignore
├── .vscode/
│   └── mcp.json                # Registro del servidor MCP en VS Code
├── src/
│   └── e2studio_mcp/
│       ├── __init__.py
│       ├── server.py           # MCP server principal (stdio)
│       ├── config.py           # Loader de e2studio-mcp.json
│       ├── build.py            # Build/clean via make o e2studioc
│       ├── project.py          # Parser de .cproject/.project
│       ├── mapfile.py          # Parser de .map CCRX
│       └── flash.py            # Flash via e2-server-gdb
└── tests/
    ├── test_build.py
    ├── test_mapfile.py
    └── test_project.py
```

#### Config (e2studio-mcp.json)

```json
{
  "workspace": "C:/Users/anton/Desktop/Proyectos/e2Studio_2024_workspace",
  "defaultProject": "headc-fw",
  "buildConfig": "HardwareDebug",
  "buildMode": "make",
  "toolchain": {
    "ccrxPath": "C:/Program Files (x86)/Renesas/RX/3_7_0/bin",
    "e2studioPath": "C:/Renesas/e2_studio/eclipse",
    "makePath": null
  },
  "flash": {
    "debugger": "E2Lite",
    "device": "R5F5651E",
    "gdbExecutable": "rx-elf-gdb",
    "gdbPort": 61234,
    "inputClock": "24.0",
    "idCode": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
  }
}
```

#### .vscode/mcp.json

```json
{
  "servers": {
    "e2studio-mcp": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "e2studio_mcp.server"],
      "cwd": "${workspaceFolder}/e2Studio_2024_workspace/e2studio-mcp/src",
      "env": {
        "E2STUDIO_MCP_CONFIG": "${workspaceFolder}/e2Studio_2024_workspace/e2studio-mcp/e2studio-mcp.json"
      }
    }
  }
}
```

---

### 1. Build Management — ✅ COMPLETADO

**Objetivo:** Compilar/limpiar proyectos e2 Studio headless desde VS Code.

#### 1.1 `build_project`

**Parámetros:**
- `project` (string, optional) — Nombre del proyecto. Default: `defaultProject` de config
- `config` (string, optional) — Configuración de build. Default: `HardwareDebug`
- `mode` (string, optional) — `"make"` | `"e2studioc"`. Default: de config

**Backend make:**
```powershell
# Desde el directorio del proyecto
make -C HardwareDebug all 2>&1
```
Requiere que `make` esté en PATH o usar el embebido en e2 Studio.

**Backend e2studioc:**
```powershell
e2studioc.exe --launcher.suppressErrors -nosplash `
  -application org.eclipse.cdt.managedbuilder.core.headlessbuild `
  -data "<workspace_path>" `
  -build "<project_name>/HardwareDebug"
```
⚠️ Requiere que e2 Studio NO esté abierto.

**Output:** JSON con `success`, `errors[]`, `warnings[]`, `duration_ms`, `output_file` (.mot path)

#### 1.2 `clean_project`

**Parámetros:** `project`, `config` (mismos que build)

**Backend make:** `make -C HardwareDebug clean 2>&1`
**Backend e2studioc:** `-cleanBuild` en vez de `-build`

**Output:** JSON con `success`, `filesRemoved`

#### 1.3 `rebuild_project`

Ejecuta `clean_project` + `build_project` secuencialmente.

**Output:** JSON combinado de clean + build

#### 1.4 `get_build_status`

**Parámetros:** `project` (optional)

Parsea la salida capturada del último build buscando patrones CCRX:
- Error: `"<file>", line <n>: <Ennn>: <message>`
- Warning: `"<file>", line <n>: <Wnnn>: <message>`
- Fatal: `F<nnn>: <message>` (linker)

**Output:** JSON con `lastBuild` timestamp, `errors[]`, `warnings[]`, `totalErrors`, `totalWarnings`

#### 1.5 `get_build_size`

**Parámetros:** `project` (optional)

Lee el .map file y extrae:
- ROM total (Program + Const)
- RAM total (Data + BSS)
- Porcentaje de uso (contra capacidad del R5F5651E: 2MB ROM, 640KB RAM)

**Output:** JSON con `rom`, `ram`, `romPercent`, `ramPercent`, `sections[]`

---

### 2. Project Info — ✅ COMPLETADO

**Objetivo:** Leer y exponer la configuración de los proyectos e2 Studio.

#### 2.1 `list_projects`

**Lógica:** Escanear `workspace` buscando directorios con `.cproject` + `.project`

**Output por proyecto:**
```json
{
  "name": "headc-fw",
  "path": "...",
  "device": "R5F5651E",
  "deviceFamily": "RX651",
  "toolchain": "Renesas_RXC v3.07.00",
  "configs": ["HardwareDebug"],
  "hasMapFile": true,
  "lastBuildTime": "2026-03-03T10:00:00"
}
```

#### 2.2 `get_project_config`

**Parámetros:** `project` (optional)

**Parsea .cproject XML** extrayendo:
- Device name, family, ISA (RXv2)
- Toolchain id y versión
- Include paths
- Preprocessor defines
- Compiler options (optimization, debug, FPU, endian)
- Linker options (sections, libraries)
- Build artefact (artifactExtension, artifactName)

**Output:** JSON estructurado con toda la configuración

#### 2.3 `get_map_summary`

**Parámetros:** `project` (optional)

**Parsea el .map de CCRX rlink** extrayendo:
- Secciones con dirección inicio, tamaño, tipo (ROM/RAM)
- Símbolos globales más relevantes (stack, heap)
- Total ROM/RAM utilizado

*Nota: El formato .map de rlink CCRX es propietario. Requiere ingeniería inversa del formato. Se usará el archivo `HardwareDebug/headc-fw.map` como referencia.*

#### 2.4 `get_linker_sections`

**Parámetros:** `project` (optional)

Similar a `get_map_summary` pero enfocado en:
- Cada sección individual con ocupación
- Clasificación: ROM (FFF00000-FFFFFFFF), RAM (00000000-0009FFFF), DATA_FLASH (00100000-00107FFF)
- Porcentaje de llenado por región

---

### 3. Flash/Debug — ✅ COMPLETADO

**Objetivo:** Grabar firmware y controlar sesiones de debug via E2 Lite.

#### 3.1 `flash_firmware`

**Parámetros:**
- `project` (optional)
- `file` (optional) — Ruta al .mot. Default: auto-detect en HardwareDebug/
- `eraseDataFlash` (bool, default: false)

**Secuencia:**
1. Levantar `e2-server-gdb` con los parámetros del .launch
2. Conectar `rx-elf-gdb` al servidor
3. Enviar comandos GDB: `monitor flash_write <file>`
4. Desconectar

**Parámetros del servidor** (extraídos del .launch):
```
e2-server-gdb -g E2LITE -t R5F5651E 
  -uConnectionTimeout=30 
  -uInputClock="24.0" 
  -uIdCode="FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
  -uWorkRamAddress="0x3fdd0" -uhookWorkRamSize="0x230"
```

**Output:** JSON con `success`, `duration_ms`, `flashedFile`, `device`

#### 3.2 `debug_connect`

Levanta e2-server-gdb como proceso background y conecta rx-elf-gdb.

**Output:** JSON con `connected`, `port`, `device`, `pid`

#### 3.3 `debug_disconnect`

Mata el proceso e2-server-gdb y cierra rx-elf-gdb.

**Output:** JSON con `disconnected`

#### 3.4 `debug_status`

Verifica si e2-server-gdb está corriendo y el estado de la conexión.

**Output:** JSON con `serverRunning`, `gdbConnected`, `device`, `port`

---

### 4. Resources MCP — ✅ COMPLETADO

**Objetivo:** Exponer datos como resources MCP que el LLM puede leer sin tool calls.

#### 4.1 `e2studio://build/log`

Contenido: Último log de compilación capturado (stdout+stderr del build).

#### 4.2 `e2studio://project/memory`

Contenido: Resumen formateado de memoria del .map (tabla ROM/RAM con secciones).

#### 4.3 `e2studio://project/config`

Contenido: Configuración activa del proyecto en formato legible.

---

## Decisiones de Diseño

### Build Backend: make vs e2studioc

| Aspecto | `make` directo | `e2studioc` headless |
|---------|---------------|---------------------|
| ¿Funciona con e2 Studio abierto? | ✅ Sí | ❌ No |
| ¿Genera .mot correctamente? | ✅ Sí (usa mismos rules) | ✅ Sí |
| ¿Requiere PATH configurado? | Sí (make + CCRX) | Sí (e2studioc) |
| ¿Detecta cambios en .cproject? | ❌ No (makefile estático) | ✅ Sí (regenera) |
| Velocidad | Más rápido | Más lento (JVM startup) |
| Fiabilidad | Puede desfasarse si cambia .cproject | Siempre correcto |

**Default recomendado:** `make` para el día a día, `e2studioc` cuando se necesite regenerar makefiles.

### Parser de errores CCRX

Patrones regex para parsear salida del compilador/linker CCRX:

```python
# Compiler error
r'"(.+?)",\s*line\s+(\d+):\s+(E\d+):\s+(.+)'

# Compiler warning  
r'"(.+?)",\s*line\s+(\d+):\s+(W\d+):\s+(.+)'

# Linker error
r'(F\d+):\s+(.+)'

# Linker warning
r'(W\d+):\s+(.+)'

# Build summary
r'(\d+)\s+Error\(s\),\s+(\d+)\s+Warning\(s\)'
```

### Flash via GDB

Secuencia GDB para flash:
```
target remote localhost:61234
monitor reset
load
monitor verify
disconnect
quit
```

Se puede simplificar usando `monitor flash_write_image erase <file>` si e2-server-gdb lo soporta.

---

## Dependencias Python

```toml
[project]
requires-python = ">=3.10"
dependencies = [
    "mcp>=1.0.0",       # MCP SDK oficial
    "lxml>=5.0.0",      # Parser XML para .cproject
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
]
```

---

## Plan de Implementación (Orden)

### Fase 0: Scaffold (P0)
1. Crear estructura de directorios
2. `pyproject.toml` con dependencias
3. `config.py` — loader de `e2studio-mcp.json`
4. `server.py` — MCP server mínimo con `initialize` + `tools/list`
5. `.vscode/mcp.json` para registro
6. Verificar que VS Code detecta el servidor

### Fase 1: Build (P1)
7. `build.py` — backend make (`make -C HardwareDebug all`)
8. `build.py` — backend e2studioc (headless build)
9. `build.py` — parser de errores/warnings CCRX
10. Registrar tools: `build_project`, `clean_project`, `rebuild_project`, `get_build_status`
11. `mapfile.py` — parser básico de .map para `get_build_size`
12. Test: build real de headc-fw y validar output

### Fase 2: Project Info (P2)
13. `project.py` — scanner de proyectos (buscar .cproject)
14. `project.py` — parser XML de .cproject
15. `mapfile.py` — parser completo de .map CCRX
16. Registrar tools: `list_projects`, `get_project_config`, `get_map_summary`, `get_linker_sections`
17. Test: leer config de headc-fw, headc_v2_fw, headc-v2-bloader

### Fase 3: Flash/Debug (P3)
18. `flash.py` — localizar e2-server-gdb y rx-elf-gdb
19. `flash.py` — levantar servidor GDB y conectar
20. `flash.py` — flash via GDB commands
21. Registrar tools: `flash_firmware`, `debug_connect`, `debug_disconnect`, `debug_status`
22. Test: flash a headc real con E2 Lite

### Fase 4: Resources (P4)
23. Implementar `e2studio://build/log`
24. Implementar `e2studio://project/memory`
25. Implementar `e2studio://project/config`
26. Test: verificar resources desde VS Code Copilot

---

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| `make` no encontrado en PATH | Build falla | Auto-detectar make embebido en e2 Studio o incluir path en config |
| Formato .map de rlink difícil de parsear | Project Info incompleto | Analizar .map real de headc-fw, fallback a regex básico |
| e2-server-gdb path desconocido | Flash no funciona | Buscar recursivamente en e2 Studio install, o parsear de .launch |
| e2studioc requiere e2 Studio cerrado | No se puede build con IDE abierto | Usar `make` como default, e2studioc solo cuando sea necesario |
| MCP SDK Python cambios de API | Server no arranca | Pinear versión en pyproject.toml |
| CCRX en `Program Files (x86)` con espacios | Paths rotos | Siempre quotear paths en subprocess calls |

---

---

## Fase 5: Extensión VS Code — e2studio-rx

> **Estado:** 🟡 Planificado (MVP)
> **Repo:** `e2studio-mcp/vscode-extension/` (mismo repo, subfolder)
> **Stack:** TypeScript + VS Code Extension API
> **Nombre publicación:** `e2studio-rx`
> **ID:** `PuertOcho.e2studio-rx`

### Objetivo

Extensión ligera de VS Code que **orquesta todo lo que ya funciona** (MCP server Python, ADM console, launch.json) y lo presenta con una UX nativa integrada. No reimplementa lógica — llama al backend Python existente y se engancha a eventos del debug adapter de Renesas.

### Arquitectura MVP

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code                                                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Status Bar   │  │  Output Channel  │  │  Tree View    │ │
│  │  [headc-fw]   │  │  "Renesas        │  │  (Sidebar)    │ │
│  │  [E2 Lite]    │  │   Virtual        │  │  Projects     │ │
│  │  [Build ✓]    │  │   Console"       │  │  Memory Map   │ │
│  └──────┬───────┘  └────────┬─────────┘  └───────┬───────┘ │
│         │                   │                     │          │
│  ┌──────┴───────────────────┴─────────────────────┴───────┐ │
│  │              Extension Host (TypeScript)                │ │
│  │                                                         │ │
│  │  ProjectManager    ADMConsole      BuildRunner          │ │
│  │  (scan .cproject)  (spawn Python   (spawn make/        │ │
│  │                     adm_console)    e2studioc)          │ │
│  └─────────┬──────────────┬───────────────┬───────────────┘ │
│            │              │               │                  │
└────────────┼──────────────┼───────────────┼──────────────────┘
             │              │               │
             ▼              ▼               ▼
        .cproject      e2-server-gdb    make / CCRX
        .launch XML    ADM port (TCP)   HardwareDebug/
```

### Funcionalidades MVP (v0.1.0)

#### F1 — Virtual Console (OutputChannel) ⭐ Prioridad máxima

La funcionalidad estrella. Replica la "Renesas Debug Virtual Console" de e2 Studio.

| Aspecto | Detalle |
|---------|---------|
| **Trigger** | Auto-start al detectar `vscode.debug.onDidStartDebugSession` con `type === "renesas-hardware"` |
| **Mecanismo** | Spawn `py scripts/adm_console.py` como child process, capturar stdout |
| **Visualización** | `vscode.window.createOutputChannel("Renesas Virtual Console")` — se muestra como pestaña en panel Output |
| **Stop** | Auto-kill del child process en `vscode.debug.onDidTerminateDebugSession` |
| **Auto-detección** | El script Python ya detecta el puerto ADM via `tasklist` + `netstat` |
| **Fallback** | Si el puerto no se detecta en 15s, mostrar warning con opción de reintentar |

**Implementación:**
```typescript
// Pseudocódigo — ciclo de vida de la consola
debug.onDidStartDebugSession(session => {
    if (session.type !== "renesas-hardware") return;
    
    const channel = window.createOutputChannel("Renesas Virtual Console");
    channel.show(true);  // Show but don't steal focus
    
    const proc = spawn("py", [admConsolePath, "--raw"]);
    proc.stdout.on("data", chunk => channel.append(chunk.toString()));
    proc.stderr.on("data", chunk => channel.append(`[ERR] ${chunk}`));
    
    // Store for cleanup
    activeConsole = { proc, channel };
});

debug.onDidTerminateDebugSession(session => {
    if (activeConsole) {
        activeConsole.proc.kill();
        activeConsole = null;
    }
});
```

**Cambio necesario en `adm_console.py`:** Añadir flag `--raw` que desactiva los mensajes de diagnóstico y solo imprime texto del target (sin `[*] Connecting...`, sin `[idle]`). La extensión parsea el stream limpio.

#### F2 — Project Selector (StatusBar)

Botón en la barra inferior que muestra/cambia el proyecto activo.

| Aspecto | Detalle |
|---------|---------|
| **Visualización** | `$(circuit-board) headc-fw` en StatusBar (izquierda, prioridad 100) |
| **Click** | `vscode.window.showQuickPick()` con lista de proyectos escaneados |
| **Scan** | Lee todos los `.cproject` en el workspace configurado (reutiliza lógica de `list_projects` del MCP) |
| **Persistencia** | Guarda selección en `workspaceState` |
| **Efecto** | Cambia el proyecto activo para Build, Flash y Debug |

**Datos por proyecto (del .cproject):**
- Nombre, Device (R5F5651E), Family (RX651), Toolchain (CCRX v3.07.00)
- Configs de build disponibles (HardwareDebug, etc.)
- Archivos .launch disponibles

#### F3 — Debugger Selector (StatusBar)

Botón que selecciona el emulador hardware.

| Aspecto | Detalle |
|---------|---------|
| **Visualización** | `$(plug) E2 Lite` en StatusBar |
| **Opciones** | `E2 Lite`, `E1`, `E2`, `J-Link`, `Simulator` — filtrado según extensiones Renesas instaladas |
| **Efecto** | Modifica `debuggerType` en el launch.json dinámico |
| **Valores** | `E2LITE`, `E1`, `E2`, `JLINK`, según el `configurationAttributes` de la extensión Renesas |

#### F4 — Build Task Integration

Comandos de build accesibles desde Command Palette y atajos.

| Comando | Acción | Atajo sugerido |
|---------|--------|----------------|
| `e2studio-rx.build` | `make -C HardwareDebug all` del proyecto activo | `Ctrl+Shift+B` (default build) |
| `e2studio-rx.clean` | `make -C HardwareDebug clean` | — |
| `e2studio-rx.rebuild` | clean + build secuencial | — |
| `e2studio-rx.flash` | Flash .mot al target (usa `flash.py` via Python subprocess) | — |

**Implementación:** Registrar como `TaskProvider` de VS Code para que aparezcan en "Run Task" y se puedan asignar a keybindings.

**Diagnóstico:** Parsear la salida del build con los mismos regex de CCRX que ya tiene `build.py` y publicar como `vscode.DiagnosticCollection` → las líneas con error/warning aparecen subrayadas en rojo/amarillo en el editor.

#### F5 — Dynamic Launch Config (DebugConfigurationProvider)

En lugar de mantener un `launch.json` estático, generarlo dinámicamente.

| Aspecto | Detalle |
|---------|---------|
| **Mecanismo** | Registrar `vscode.debug.registerDebugConfigurationProvider("renesas-hardware", provider)` |
| **Trigger** | Al pulsar F5 sin launch.json, o al seleccionar "e2studio-rx: Debug" |
| **Genera** | La misma config que ahora está hardcodeada en launch.json, pero con valores dinámicos según proyecto y debugger seleccionados |
| **Fuente de datos** | Parsea el `.launch` de e2 Studio del proyecto activo (reutiliza `parse_launch_file()` de `flash.py`) |

Esto elimina la necesidad de editar `launch.json` manualmente.

### Estructura del Proyecto

```
e2studio-mcp/
├── ... (Python MCP server existente)
└── vscode-extension/
    ├── package.json
    ├── tsconfig.json
    ├── .vscodeignore
    ├── README.md
    ├── CHANGELOG.md
    ├── resources/
    │   └── icon.png
    └── src/
        ├── extension.ts          # activate/deactivate, registros
        ├── projectManager.ts     # Escaneo .cproject, selección proyecto
        ├── admConsole.ts         # Spawn adm_console.py, OutputChannel
        ├── buildRunner.ts        # Spawn make, TaskProvider, DiagnosticCollection
        ├── debugProvider.ts      # DebugConfigurationProvider dinámico
        ├── launchParser.ts       # Parser de .launch XML de e2 Studio
        ├── statusBar.ts          # StatusBarItems (proyecto, debugger, build)
        └── config.ts             # Lectura de e2studio-mcp.json
```

### package.json (contributes)

```jsonc
{
  "name": "e2studio-rx",
  "displayName": "e2 Studio RX — Build, Flash & Debug",
  "publisher": "PuertOcho",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Debuggers", "Other"],
  "activationEvents": [
    "workspaceContains:**/.cproject",
    "onDebugResolve:renesas-hardware"
  ],
  "extensionDependencies": [
    "renesaselectronicscorporation.renesas-debug"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "e2studio-rx.selectProject",  "title": "Select Project",    "category": "e2 Studio RX" },
      { "command": "e2studio-rx.selectDebugger", "title": "Select Debugger",   "category": "e2 Studio RX" },
      { "command": "e2studio-rx.build",          "title": "Build Project",     "category": "e2 Studio RX" },
      { "command": "e2studio-rx.clean",          "title": "Clean Project",     "category": "e2 Studio RX" },
      { "command": "e2studio-rx.rebuild",        "title": "Rebuild Project",   "category": "e2 Studio RX" },
      { "command": "e2studio-rx.flash",          "title": "Flash Firmware",    "category": "e2 Studio RX" },
      { "command": "e2studio-rx.openConsole",    "title": "Open Virtual Console", "category": "e2 Studio RX" }
    ],
    "configuration": {
      "title": "e2 Studio RX",
      "properties": {
        "e2studio-rx.configPath": {
          "type": "string",
          "default": "",
          "description": "Path to e2studio-mcp.json configuration file"
        },
        "e2studio-rx.pythonPath": {
          "type": "string",
          "default": "py",
          "description": "Python executable (py, python3, python)"
        },
        "e2studio-rx.consolePollMs": {
          "type": "number",
          "default": 500,
          "description": "Virtual console polling interval in milliseconds"
        }
      }
    },
    "taskDefinitions": [
      {
        "type": "e2studio-rx",
        "required": ["task"],
        "properties": {
          "task": { "type": "string", "enum": ["build", "clean", "rebuild", "flash"] },
          "project": { "type": "string" },
          "config": { "type": "string", "default": "HardwareDebug" }
        }
      }
    ]
  }
}
```

### APIs de VS Code utilizadas

| API | Uso | Módulo |
|-----|-----|--------|
| `vscode.debug.onDidStartDebugSession` | Detectar inicio de debug Renesas → lanzar consola ADM | `admConsole.ts` |
| `vscode.debug.onDidTerminateDebugSession` | Limpiar child process consola | `admConsole.ts` |
| `vscode.debug.registerDebugConfigurationProvider` | Generar launch config dinámico | `debugProvider.ts` |
| `vscode.window.createOutputChannel` | Panel "Renesas Virtual Console" | `admConsole.ts` |
| `vscode.window.createStatusBarItem` | Botones proyecto/debugger/build | `statusBar.ts` |
| `vscode.window.showQuickPick` | Selector de proyecto/debugger | `projectManager.ts` |
| `vscode.tasks.registerTaskProvider` | Build/Clean/Flash como Tasks | `buildRunner.ts` |
| `vscode.languages.createDiagnosticCollection` | Errores CCRX en editor | `buildRunner.ts` |
| `child_process.spawn` | Ejecutar `py adm_console.py`, `make`, etc. | Varios |
| `vscode.workspace.getConfiguration` | Settings de la extensión | `config.ts` |
| `context.workspaceState` | Persistir proyecto/debugger seleccionado | `projectManager.ts` |
| `xml2js` o DOM parser | Parsear .cproject/.launch XML | `launchParser.ts` |

### Dependencias npm

```json
"dependencies": {
  "fast-xml-parser": "^4.3.0"
},
"devDependencies": {
  "@types/vscode": "^1.85.0",
  "@types/node": "^20.0.0",
  "typescript": "^5.3.0",
  "esbuild": "^0.20.0",
  "@vscode/vsce": "^2.24.0"
}
```

*Nota: `fast-xml-parser` en lugar de `lxml` — necesitamos parsear .cproject y .launch desde TypeScript sin depender del Python backend para esto.*

### Plan de Implementación (por fases)

#### Sprint 1: Scaffold + Virtual Console (Core MVP)

| # | Tarea | Detalle |
|---|-------|---------|
| 1 | Scaffold | `yo code` o manual: package.json, tsconfig, esbuild, .vscodeignore |
| 2 | `extension.ts` | activate/deactivate básico, logging |
| 3 | `config.ts` | Leer `e2studio-mcp.json` (paths, workspace, devices) |
| 4 | `admConsole.ts` | Spawn `adm_console.py --raw`, OutputChannel, lifecycle hooks |
| 5 | Modificar `adm_console.py` | Añadir flag `--raw` (solo texto target, sin diagnósticos) |
| 6 | Hooks de debug session | `onDidStart` → lanzar consola, `onDidTerminate` → cerrar |
| 7 | Test manual | F5 debug → consola aparece automáticamente con printf output |

**Entregable:** Al pulsar F5 para debug Renesas, aparece automáticamente una pestaña "Renesas Virtual Console" con el output del target.

#### Sprint 2: Project + Debugger Selector

| # | Tarea | Detalle |
|---|-------|---------|
| 8 | `projectManager.ts` | Escaneo de .cproject, QuickPick, persistencia |
| 9 | `launchParser.ts` | Parser de .launch XML en TypeScript |
| 10 | `statusBar.ts` | StatusBarItems para proyecto y debugger |
| 11 | `debugProvider.ts` | DebugConfigurationProvider dinámico |
| 12 | Test manual | Cambiar proyecto en StatusBar → F5 usa el proyecto correcto |

**Entregable:** F5 funciona sin launch.json manual. StatusBar muestra proyecto activo.

#### Sprint 3: Build Integration

| # | Tarea | Detalle |
|---|-------|---------|
| 13 | `buildRunner.ts` | TaskProvider con make backend, output parsing |
| 14 | Diagnostics | CCRX error/warning regex → DiagnosticCollection |
| 15 | StatusBar build | Indicador de último build (✓/✗) + ROM/RAM % |
| 16 | Flash command | `e2studio-rx.flash` usando `flash.py` subprocess |
| 17 | Test E2E | Build → Flash → Debug → Console — ciclo completo sin e2 Studio |

**Entregable:** Ctrl+Shift+B compila, errores aparecen en editor, Flash desde command palette.

### Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| `adm_console.py` depende de Python instalado | Extensión no funciona sin Python | Verificar `py` en activate(), mostrar error claro con link a instalar |
| Puerto ADM variable (no siempre el mismo) | Consola no conecta | Auto-detección ya funciona (tasklist+netstat). Añadir retry con backoff |
| Extensión Renesas Debug no instalada | F5 no funciona | `extensionDependencies` en package.json fuerza instalación |
| .cproject XML varía entre versiones e2 Studio | Parser falla | Parser defensivo con fallbacks (ya probado en project.py) |
| Conflicto si e2 Studio y VS Code usan E2 Lite simultáneamente | Debug falla | Detectar proceso e2-server-gdb previo y avisar usuario |
| `make` no en PATH | Build falla | Leer `makePath` de e2studio-mcp.json, añadir al PATH del subprocess |

### Criterio de MVP Completado

- [ ] F5 en VS Code → debug session conecta al target via E2 Lite
- [ ] OutputChannel "Renesas Virtual Console" muestra printf del target automáticamente
- [ ] StatusBar muestra proyecto activo y permite cambiar
- [ ] Build desde Command Palette, errores visibles en editor
- [ ] Flash desde Command Palette  
- [ ] Cero dependencia de e2 Studio abierto para el workflow diario

---

## Changelog

### 2026-03-06 (Debug nativo VS Code y Virtual Console)
- **VS Code Debug:** Creación de `.vscode/launch.json` funcional para RX651 + E2 Lite, usando extensión `renesaselectronicscorporation.renesas-debug`. Interrumpe correctamente en `PowerON_Reset_PC`.
- **ADM Virtual Console:** Ingeniería inversa del protocolo binario ADM (`ISimulatedIO`) usado en los plugins Java de e2 Studio.
- **Python Client:** Creación de `scripts/adm_console.py` que se conecta a la sesión de GDB, interactúa con el buffer de memoria del E2 Lite (0x84080) y decodea los printfs para visualizarlos en texto plano en terminal.

### 2026-03-03 (Implementación completa)
- **Fase 0 — Scaffold:** pyproject.toml, e2studio-mcp.json, config.py, server.py, .vscode/mcp.json, .gitignore
- **Fase 1 — Build:** build.py con backends make/e2studioc, parser errores CCRX (regex E/W/F), 5 tools registradas
- **Fase 2 — Project Info:** project.py (.cproject XML parser con lxml), mapfile.py (.map CCRX con ATTRIBUTE column), 4 tools
- **Fase 3 — Flash:** flash.py (e2-server-gdb + rx-elf-gdb, session tracking), 4 tools
- **Fase 4 — Resources:** 3 resources MCP (build/log, project/memory, project/config)
- **Tests:** 13 unit tests (build parser, mapfile parser, project parser) — todos pasan
- **Smoke test real:** 3 proyectos detectados, headc-fw config parseada (58 includes, 9 defines), mapfile: ROM 24.5%, RAM 71.1%, DataFlash 15.1%
- **MCP SDK:** FastMCP v1.26.0, transport stdio, 13 tools + 3 resources registrados
- Dependencias: mcp>=1.0.0, lxml>=5.0.0, pytest>=8.0, pytest-asyncio>=0.23

### 2026-03-03 (Scope definido)
- Scope definido: Build + Project Info + Flash via e2-server-gdb
- Stack: Python + MCP SDK
- Ubicación: `e2Studio_2024_workspace/e2studio-mcp/`
- Build backends: make directo (default) + e2studioc headless (configurable)
- Flash via e2-server-gdb (nativo e2 Studio)
- Entorno detectado: CCRX v3.6.0+v3.7.0, e2studioc.exe, 3 proyectos en workspace
- Tracker creado
