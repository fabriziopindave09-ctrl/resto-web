@echo off
chcp 65001 >nul
title Resto - Servidor
cd /d "%~dp0"
:loop
node server.js
echo.
echo El servidor se detuvo. Reiniciando en 3 segundos... (cerra esta ventana para salir)
timeout /t 3 >nul
goto loop
