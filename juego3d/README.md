# ARES-X · Centro de Control 3D

Versión de juego 3D del rover autónomo ARES-X, servida en **localhost**.

## Cómo arrancarlo

- **Windows:** doble clic en `INICIAR_JUEGO.bat`
- **O desde una terminal:**
  ```
  cd C:\rover\juego3d
  pip install -r requirements.txt
  python servidor.py
  ```
Se abre solo en **http://localhost:8000** (otro puerto: `python servidor.py --puerto 8080`).
La primera vez entrena la red neuronal (~15 s); después queda guardada en `cache/`.

## Qué cambia y qué NO cambia

- **No cambia el concepto:** el motor (RNA + lógica difusa + algoritmo genético + supervisor)
  es exactamente el código del notebook `ARES-X_rover_autonomo.ipynb`. `extraer_motor.py` lo
  copia sin modificarlo a `motor.py` cada vez que el notebook cambia.
- **Cambia la interfaz:** en lugar de ipywidgets + matplotlib 2D, una escena 3D (Three.js,
  incluida en `web/vendor`, funciona sin internet) que sólo *dibuja* lo que decide el motor.

## Archivos

| Archivo | Rol |
|---|---|
| `servidor.py` | Servidor HTTP local (sólo biblioteca estándar) + API JSON |
| `extraer_motor.py` | Extrae los módulos del notebook a `motor.py` |
| `web/index.html`, `web/style.css` | Interfaz (HUD, paneles, dock) |
| `web/js/escena.js` | Mundo 3D: terreno, rover, sonda, efectos |
| `web/js/app.js` | Controles, paneles de IA, telemetría, bitácora |
