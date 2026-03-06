@echo off
setlocal

set DEBUGCOMP=C:\Users\anton\.eclipse\com.renesas.platform_1435879475\DebugComp\RX
set PYTHON3=C:\Renesas\e2_studio\eclipse\plugins\com.renesas.python3.win32.x86_64_3.10.10.202303141009\bin
set GDB=%DEBUGCOMP%\rx-elf-gdb.exe
set SERVER=%DEBUGCOMP%\e2-server-gdb.exe
set GDBSCRIPT=%~dp0gdb_console.gdb
set PORT=61234
set PATH=%DEBUGCOMP%;%PYTHON3%;%PATH%

echo ============================================
echo   Renesas Debug Virtual Console (headc-fw)
echo   Puerto GDB: %PORT%
echo ============================================
echo.

:: Kill any previous sessions
taskkill /F /IM e2-server-gdb.exe >nul 2>&1
taskkill /F /IM rx-elf-gdb.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Start e2-server-gdb in background (separate hidden window)
echo [1/2] Iniciando e2-server-gdb...
start "e2-server-gdb" /MIN "%SERVER%" -g E2LITE -t R5F5651E -uConnectionTimeout= 30 -uInputClock= "27.0" -uAllowClockSourceInternal= 1 -uJTagClockFreq= "6.00" -w 0 -z "0" -uIdCode= "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" -uresetOnReload= 1 -n 0 -uWorkRamAddress= "1000" -uhookWorkRamAddr= "0x3fdd0" -uhookWorkRamSize= "0x230" -uOSRestriction= 0 -p %PORT%

:: Wait for server to be ready (needs ~5s for E2 Lite firmware check)
echo [1/2] Esperando conexion con E2 Lite...
timeout /t 8 /nobreak >nul

:: Connect GDB
echo [2/2] Conectando rx-elf-gdb...
echo.
echo   La salida del firmware aparecera aqui abajo.
echo   Pulsa Ctrl+C para salir.
echo ============================================
echo.

cd /d "%DEBUGCOMP%"
"%GDB%" -rx-force-v2 -q -x "%GDBSCRIPT%"

:: Cleanup on exit
echo.
echo Desconectando...
taskkill /F /IM e2-server-gdb.exe >nul 2>&1
echo Sesion cerrada.
