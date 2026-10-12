@echo off
chcp 65001 >nul
title Estudio Opus
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] O Node.js nao esta instalado.
  echo      Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [aviso] O Claude Code nao foi encontrado. O estudio abre, mas para GERAR animacoes
  echo          instale o Claude Code e faca login: veja o modulo 1 do curso.
  echo.
)

if not exist node_modules (
  echo  Instalando as dependencias pela primeira vez - pode levar alguns minutos...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [!] Falha ao instalar as dependencias. Verifique sua internet e tente de novo.
    pause
    exit /b 1
  )
)

echo.
echo  Abrindo o Estudio Opus em http://127.0.0.1:4777
echo  Deixe esta janela aberta enquanto usa. Para fechar: feche esta janela.
echo.
node server.js --abrir
pause
