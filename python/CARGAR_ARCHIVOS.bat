@echo off
rem ============================================================
rem  CARGAR_ARCHIVOS.bat - Carga todos los archivos de datos
rem
rem  COMO USAR:
rem    1. Bajá este archivo y "subir_archivo.py" de GitHub
rem    2. Ponelos en la MISMA carpeta donde están tus Excel
rem    3. Doble clic acá. Nada más.
rem
rem  El script detecta solo qué archivo es cada uno:
rem    H61...               -> produccion por hora
rem    ...picking...        -> produccion por picking
rem    ...muertos...        -> tiempos muertos
rem    ...Ola/Pendiente...  -> matriz de Ola
rem ============================================================
chcp 65001 >nul
title Carga de archivos - Planificacion CD
cd /d "%~dp0"

echo ==================================================
echo    CARGA DE ARCHIVOS - PLANIFICACION CD
echo    https://planificacion-preparacion-cd.vercel.app
echo ==================================================
echo.

rem --- 1) Verificar Python ---
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python no esta instalado en esta PC.
    echo.
    echo   1. Entrar a https://www.python.org/downloads/
    echo   2. Descargar e instalar Python
    echo   3. MUY IMPORTANTE: tildar "Add Python to PATH" en el instalador
    echo   4. Volver a hacer doble clic en este archivo
    echo.
    pause
    exit /b 1
)

rem --- 2) Verificar dependencias (instala solo la primera vez) ---
python -c "import pandas, openpyxl, requests" >nul 2>nul
if errorlevel 1 (
    echo Instalando dependencias, esperá un momento ^(solo la primera vez^)...
    python -m pip install --quiet --disable-pip-version-check pandas openpyxl requests
    if errorlevel 1 (
        echo [ERROR] No se pudieron instalar las dependencias. Revisá tu conexion a internet.
        pause
        exit /b 1
    )
)

rem --- 3) Mostrar qué detecta ---
python subir_archivo.py --carpeta "%~dp0." --url https://planificacion-preparacion-cd.vercel.app --solo-listar
echo.

rem --- 4) Cargar todo (auto: no pregunta nada) ---
python subir_archivo.py --carpeta "%~dp0." --url https://planificacion-preparacion-cd.vercel.app --auto

echo.
echo ==================================================
echo  Listo. Entrá a la app y refrescá la pagina:
echo  https://planificacion-preparacion-cd.vercel.app
echo ==================================================
echo.
pause
