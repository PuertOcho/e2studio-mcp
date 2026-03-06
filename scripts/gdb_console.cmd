@echo off
set DEBUGCOMP=C:\Users\anton\.eclipse\com.renesas.platform_1435879475\DebugComp\RX
set PYTHON3=C:\Renesas\e2_studio\eclipse\plugins\com.renesas.python3.win32.x86_64_3.10.10.202303141009\bin
set GDB=%DEBUGCOMP%\rx-elf-gdb.exe
set ELF=C:\Users\anton\Desktop\Proyectos\e2Studio_2024_workspace\headc-fw\HardwareDebug\HEADC.x
set SCRIPT=C:\Users\anton\Desktop\Proyectos\e2Studio_2024_workspace\e2studio-mcp\scripts\gdb_console.gdb
set PORT=61234
set PATH=%DEBUGCOMP%;%PYTHON3%;%PATH%

echo ============================================
echo   Renesas Debug Virtual Console (headc-fw)
echo   Conectando a E2 Lite en puerto %PORT%...
echo   Ctrl+C para salir
echo ============================================
echo.

"%GDB%" -rx-force-v2 -q --symbol "%ELF%" -x "%SCRIPT%"
