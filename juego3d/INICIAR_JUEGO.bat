@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias (solo la primera vez)...
python -m pip install -q -r requirements.txt
python servidor.py
pause
