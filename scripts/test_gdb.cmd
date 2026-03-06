@echo off
setlocal

set DEBUGCOMP=C:\Users\anton\.eclipse\com.renesas.platform_1435879475\DebugComp\RX
set PYTHON3=C:\Renesas\e2_studio\eclipse\plugins\com.renesas.python3.win32.x86_64_3.10.10.202303141009\bin
set PATH=%DEBUGCOMP%;%PYTHON3%;%PATH%

cd /d "%DEBUGCOMP%"

echo === Testing GDB connect ===
rx-elf-gdb.exe -rx-force-v2 -q -ex "set tdesc filename RX/rxv2v3-regset" -ex "target remote localhost:61234" -ex "info registers pc" -ex "monitor set_internal_mem_overwrite 0-581" -ex "disconnect" -ex "quit"
echo.
echo === Exit code: %ERRORLEVEL% ===
