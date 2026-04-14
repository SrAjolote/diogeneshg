@echo off
echo ========================================
echo   SERVIDOR ESPEJO - INICIANDO
echo ========================================
echo.

REM Verificar Node.js
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [X] Node.js no esta instalado.
    echo.
    echo Descargalo de: https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detectado:
node --version
echo.

REM Instalar dependencias si no existen
if not exist "node_modules" (
    echo [+] Instalando dependencias...
    npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [X] Error al instalar dependencias
        pause
        exit /b 1
    )
    echo.
)

echo [>] Iniciando servidor...
echo Accede a: http://localhost:3000
echo.
echo [COMANDOS DE CONSOLA]:
echo   Ctrl+R = Reiniciar servidor
echo   Ctrl+C = Detener servidor
echo ========================================

node server.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [X] Error al iniciar el servidor
    echo Revisa los mensajes de error arriba
)

echo.
pause
