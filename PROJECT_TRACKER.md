# PROJECT TRACKER — e2studio-mcp

> **Ubicación:** `e2Studio_2024_workspace/e2studio-mcp/`
> **Stack:** Python + MCP SDK (`mcp` package), servidor stdio
> **Inicio:** Marzo 2026
> **Última actualización:** 2026-03-03 (Implementación completa — Fases 0-4)

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

## Changelog

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
