@echo off
echo ========================================
echo   ENCANTO MIRANDA - Servidor Local
echo ========================================
echo.

REM Verifica se Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Instale em: https://nodejs.org
    pause
    exit /b 1
)

REM Instala dependencias se necessario
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    echo.
)

echo Iniciando servidor com livereload...
echo Acesse neste computador: http://localhost:3000
echo Acesse no celular: http://192.168.0.112:3000
echo.
echo Pressione CTRL+C para parar
echo.

call npm start

pause
