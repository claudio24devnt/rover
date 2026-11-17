"""
ARES-X · Extrae el MOTOR de simulación desde el notebook original.

El notebook `ARES-X_rover_autonomo.ipynb` sigue siendo la fuente de verdad:
este script copia, SIN modificarlas, las celdas de código que definen el
simulador (configuración, mundo, sensores, RNA, difuso, AG, supervisor,
misión, experimentos y pruebas) a `motor.py`, para que el servidor 3D las
importe. Las celdas de interfaz (ipywidgets/matplotlib) y de ejecución no se
copian: la interfaz 3D las reemplaza.

Se ejecuta automáticamente al arrancar `servidor.py` si el notebook cambió.
"""

from __future__ import annotations

import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK = os.path.join(os.path.dirname(AQUI), "ARES-X_rover_autonomo.ipynb")
SALIDA = os.path.join(AQUI, "motor.py")

# Celdas cuyo docstring inicial identifica un módulo del motor.
MODULOS_MOTOR = [
    "Módulo 1:", "Módulo 2:", "Módulo 3:", "Módulo 4:", "Módulo 5:",
    "Módulo 6:", "Módulo 7:", "Módulo 8:", "Módulo 9:", "Módulo 12:",
]


def _es_celda_motor(src: str) -> bool:
    cabecera = src.lstrip()[:200]
    return cabecera.startswith('"""') and any(m in cabecera for m in MODULOS_MOTOR)


def _limpiar(src: str) -> str:
    """Quita magias de IPython y `from __future__` repetidos (deben ir arriba)."""
    lineas = []
    for ln in src.splitlines():
        s = ln.strip()
        if s.startswith("%") or s.startswith("!"):
            continue
        if s.startswith("from __future__ import"):
            continue
        lineas.append(ln)
    return "\n".join(lineas)


def extraer(forzar: bool = False) -> str:
    if not os.path.exists(NOTEBOOK):
        raise FileNotFoundError(f"No se encontró el notebook en {NOTEBOOK}")
    if (not forzar and os.path.exists(SALIDA)
            and os.path.getmtime(SALIDA) >= os.path.getmtime(NOTEBOOK)
            and os.path.getmtime(SALIDA) >= os.path.getmtime(__file__)):
        return SALIDA

    with open(NOTEBOOK, encoding="utf-8") as fh:
        nb = json.load(fh)

    partes = [
        '"""ARES-X · motor de simulación.\n\n'
        "ARCHIVO GENERADO AUTOMÁTICAMENTE por extraer_motor.py a partir de\n"
        "ARES-X_rover_autonomo.ipynb. No editar a mano: edite el notebook.\n"
        '"""\n',
        "from __future__ import annotations\n",
    ]
    encontrados = []
    for i, celda in enumerate(nb["cells"]):
        if celda.get("cell_type") != "code":
            continue
        src = "".join(celda.get("source", []))
        if _es_celda_motor(src):
            encontrados.append(i)
            partes.append(f"\n# {'=' * 76}\n# Celda {i} del notebook\n# {'=' * 76}\n")
            partes.append(_limpiar(src))
    if len(encontrados) < 9:
        raise RuntimeError(f"Sólo se encontraron {len(encontrados)} módulos del motor.")

    with open(SALIDA, "w", encoding="utf-8") as fh:
        fh.write("\n".join(partes) + "\n")
    return SALIDA


if __name__ == "__main__":
    ruta = extraer(forzar="--forzar" in sys.argv)
    print("Motor extraído en", ruta)
