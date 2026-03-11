# e2studio-mcp

Servidor MCP e integración con VS Code para desarrollo **Renesas RX con e2 Studio**.

Este proyecto ofrece un flujo de trabajo orientado a firmware para:

- compilar proyectos e2 Studio en modo headless (`make` o `e2studioc`)
- inspeccionar configuración de proyecto y uso de memoria desde `.map`
- grabar firmware `.mot` usando `e2-server-gdb` mediante protocolo RSP directo
- exponer herramientas y recursos MCP para automatización asistida por IA
- usar una extensión opcional de VS Code para build/flash/debug

## Arquitectura

```text
VS Code / Cliente MCP
        |
        | stdio (MCP)
        v
e2studio_mcp.server (Python)
  |- Build tools (make / e2studioc)
  |- Parser de proyectos (.cproject)
  |- Parser de mapas (.map)
  |- Gestor de flash/debug (e2-server-gdb + RSP)
        |
        v
Toolchain Renesas + hardware objetivo (E2 Lite / E1 / E2 / J-Link)
```

## Capacidades Principales

- Build pipeline: `build_project`, `clean_project`, `rebuild_project`, `get_build_status`
- Análisis de memoria: `get_build_size`, `get_map_summary`, `get_linker_sections`
- Metadatos de proyecto: `list_projects`, `get_project_config`
- Flash/debug: `flash_firmware`, `debug_connect`, `debug_disconnect`, `debug_status`
- Consola ADM: `get_adm_log`
- Recursos MCP:
  - `e2studio://build/log`
  - `e2studio://debug/adm/log`
  - `e2studio://project/memory`
  - `e2studio://project/config`

## Requisitos

- Windows (target principal)
- Python `>= 3.10`
- Instalación de Renesas e2 Studio
- Toolchain RX (`CCRX`, `make`, `e2-server-gdb`, `rx-elf-gdb`)
- Workspace e2 Studio con proyectos que incluyan `.cproject`

## Estructura del Repositorio

```text
e2studio-mcp/
  src/e2studio_mcp/
    server.py          # Servidor MCP y registro de tools/resources
    build.py           # Backends de compilación y parsing de diagnósticos
    project.py         # Parsing de .cproject y discovery de proyectos
    mapfile.py         # Parsing de .map y resúmenes de memoria
    flash.py           # Sesión e2-server-gdb y grabación por RSP
    adm.py             # Cliente ADM / consola virtual SimulatedIO
    config.py          # Carga de configuración JSON
  tests/               # Tests unitarios + smoke test
  scripts/             # Utilidades de soporte
  vscode-extension/    # Extensión VS Code opcional (UI + comandos)
  e2studio-mcp.json    # Configuración de ejecución
```

## Instalación

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m pip install -e .
```

Dependencias de desarrollo (opcional):

```powershell
py -3 -m pip install -e .[dev]
```

## Configuración

El servidor resuelve la configuración en este orden:

1. ruta explícita (si se usa programáticamente)
2. variable de entorno `E2STUDIO_MCP_CONFIG`
3. archivo local `e2studio-mcp.json` en la raíz del proyecto

### Ejemplo mínimo

```json
{
  "workspace": "C:/Users/anton/Desktop/Proyectos/e2Studio_2024_workspace",
  "defaultProject": "headc-fw",
  "buildConfig": "HardwareDebug",
  "buildMode": "make",
  "buildJobs": 0,
  "toolchain": {
    "ccrxPath": "C:/Program Files (x86)/Renesas/RX/3_7_0/bin",
    "e2studioPath": "C:/Renesas/e2_studio/eclipse",
    "makePath": "C:/Renesas/e2_studio/eclipse/plugins/.../mk"
  },
  "flash": {
    "debugger": "E2Lite",
    "device": "R5F5651E",
    "gdbExecutable": "rx-elf-gdb",
    "gdbPort": 61234,
    "inputClock": "24.0",
    "idCode": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    "debugToolsPath": "C:/Users/.../.eclipse/com.renesas.platform_xxx/DebugComp/RX",
    "python3BinPath": "C:/Renesas/e2_studio/eclipse/plugins/.../bin"
  },
  "devices": {
    "R5F5651E": {
      "family": "RX651",
      "romSize": 2097152,
      "ramSize": 655360,
      "dataFlashSize": 32768
    }
  }
}
```

Notas:

- `buildMode` soporta `make` o `e2studioc`.
- `buildJobs: 0` activa autodetección por núcleos lógicos, con tope de `16` para parecerse al comportamiento de e2 Studio.
- `devices` define capacidades por dispositivo; se usan para calcular porcentajes ROM/RAM/DataFlash.
- `gdbExecutable` es el binario GDB (default: `rx-elf-gdb`; se busca en PATH o en rutas de toolchain).
- `python3BinPath` apunta al Python embebido de Renesas, requerido por `e2-server-gdb`.
- Si no se define `debugToolsPath`, se intentan rutas de autodetección conocidas.

## Ejecución del Servidor MCP

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m e2studio_mcp.server
```

También se puede iniciar con:

```powershell
py -3 -m e2studio_mcp
```

## Referencia de Herramientas MCP

| Grupo | Tool | Descripción |
|---|---|---|
| Build | `build_project(project?, config?, mode?)` | Compila usando `make` o `e2studioc` |
| Build | `clean_project(project?, config?, mode?)` | Limpia artefactos de compilación |
| Build | `rebuild_project(project?, config?, mode?)` | Ejecuta clean + build |
| Build | `get_build_status(project?)` | Errores y warnings de la última compilación |
| Build | `get_build_size(project?, config?)` | Uso ROM/RAM/DataFlash desde `.map` |
| Project | `list_projects()` | Descubre proyectos dentro del workspace |
| Project | `get_project_config(project?, config?)` | Parsea detalles de `.cproject` |
| Map | `get_map_summary(project?, config?)` | Resumen de secciones + porcentajes |
| Map | `get_linker_sections(project?, config?)` | Detalle individual de secciones de linker |
| Flash | `flash_firmware(project?, file?, erase_data_flash?, config?, launch_file?)` | Graba `.mot` por RSP usando la build config y `.launch` seleccionados |
| Flash | `debug_connect(project?, launch_file?)` | Inicia sesión `e2-server-gdb` |
| Flash | `debug_disconnect()` | Cierra sesión de depuración |
| Flash | `debug_status()` | Estado actual de la sesión |
| Debug | `get_adm_log(port?, wait_seconds?, duration_ms?, poll_ms?, max_bytes?)` | Lee un snapshot del buffer ADM / consola virtual |

## Extensión VS Code (Opcional)

La carpeta `vscode-extension/` incluye un panel lateral y comandos para selección de proyecto, build, flash y debug.

Los requisitos funcionales abiertos de estabilización se consolidan en `STABILIZATION_REQUIREMENTS.md` para separar comportamiento actual de decisiones aún no cerradas.

El flujo previsto en la extensión es:

- seleccionar proyecto detectado automáticamente dentro del workspace e2 Studio
- seleccionar `buildConfig` real a partir de carpetas de salida con `Makefile`
- seleccionar `.launch` concreto o dejar `Auto-detect` para priorizar `*HardwareDebug*`
- lanzar `Build`, `Flash` o `Debug` usando esa selección activa

### Nota sobre Memory

La sección `Memory` del panel no es un mock.

- El uso `ROM/RAM/DataFlash` sale del `.map` real generado por el build.
- Las capacidades totales salen de `devices` en `e2studio-mcp.json`.
- Si el dispositivo no está definido ahí, la extensión usa fallback conservador por defecto.

Por tanto, los bytes usados son datos reales del linker; lo que conviene mantener bien configurado es la tabla `devices` para que los porcentajes sean exactos en proyectos nuevos.

### Compilar la extensión

```powershell
cd e2Studio_2024_workspace/e2studio-mcp/vscode-extension
npm install
npm run compile
```

### Ajustes de la extensión

- `e2mcp.configPath`: ruta a `e2studio-mcp.json`
- `e2mcp.pythonPath`: ejecutable de Python (`py`, `python3`, `python`)
- `e2mcp.consolePollMs`: intervalo de sondeo de consola virtual
- `buildJobs` en `e2studio-mcp.json`: número de compilaciones paralelas para `make`. Usa `0` para modo automático según CPU, con máximo `16`.

## Testing

Ejecutar tests unitarios:

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 -m pytest -q
```

Ejecutar smoke test (parsing real del workspace):

```powershell
cd e2Studio_2024_workspace/e2studio-mcp
py -3 tests/smoke_test.py
```

## Troubleshooting

- `Config file not found`: definir `E2STUDIO_MCP_CONFIG` o crear `e2studio-mcp.json` en la raíz.
- `make not found`: revisar `toolchain.makePath`.
- `sed`, `ccrx` o `renesas_cc_converter` no encontrados durante `make`: comprobar `toolchain.e2studioPath` y `toolchain.ccrxPath`. La extensión y el backend añaden automáticamente BusyBox de Renesas, CCRX y las utilidades `Utilities/ccrx` de `.eclipse` al `PATH` del build.
- `e2studioc not found`: comprobar `toolchain.e2studioPath` apuntando a `.../eclipse`.
- `Cannot find e2-server-gdb`: definir `flash.debugToolsPath` explícitamente.
- `No .mot file found`: compilar antes de grabar.
- `Cannot connect to e2-server-gdb`: verificar sonda, dispositivo configurado y puerto GDB.

## Licencia

MIT (la metadata del paquete de extensión está en `vscode-extension/package.json`).
