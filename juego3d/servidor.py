"""
ARES-X · Servidor local del Centro de Control 3D.

Uso:
    python servidor.py            -> http://localhost:8000
    python servidor.py --puerto 8080

El motor (RNA + lógica difusa + AG + supervisor) es EXACTAMENTE el del
notebook: se extrae con `extraer_motor.py` y se importa sin cambios. Este
archivo sólo expone el estado de la misión como JSON para la interfaz 3D.
Sólo usa la biblioteca estándar de Python (además de numpy/pandas/sklearn,
que ya exige el notebook).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import mimetypes
import os
import pickle
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

AQUI = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(AQUI, "web")
CACHE = os.path.join(AQUI, "cache")
sys.path.insert(0, AQUI)

try:  # consola de Windows: evita errores con tildes y símbolos
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import extraer_motor  # noqa: E402

extraer_motor.extraer()
import numpy as np  # noqa: E402
import motor as M  # noqa: E402

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")


# --------------------------------------------------------------------------
# Entrenamiento de la RNA (una sola vez; queda en caché)
# --------------------------------------------------------------------------
CFG_BASE = M.Config(planeta="marte", modo="rover", dificultad="media",
                    semilla=42, bateria_inicial=60.0, filas=22, columnas=22,
                    n_sitios_ciencia=6, max_pasos=240)


def preparar_rna():
    os.makedirs(CACHE, exist_ok=True)
    ruta = os.path.join(CACHE, f"rna_{M.VERSION}.pkl")
    if os.path.exists(ruta) and \
            os.path.getmtime(ruta) >= os.path.getmtime(extraer_motor.NOTEBOOK):
        try:
            with open(ruta, "rb") as fh:
                rna = pickle.load(fh)
            print("RNA cargada desde caché.")
            return rna
        except Exception:
            pass
    print("Generando dataset sintético (24 mapas independientes)…")
    t0 = time.time()
    ds = M.generar_dataset(CFG_BASE, n_mapas=24, muestras_por_mapa=260, semilla=20260)
    fuga = M.verificar_sin_fuga(ds)
    print(f"  {len(ds.X)} muestras · ¿sin fuga entre particiones? {fuga['sin_fuga']}")
    print("Entrenando MLP (32, 16) en CPU… (sólo la primera vez)")
    rna = M.NeuralPerception(capas=(32, 16), semilla=42, epocas=140).entrenar(ds, verbose=False)
    print(f"  listo en {time.time() - t0:.1f} s")
    try:
        with open(ruta, "wb") as fh:
            pickle.dump(rna, fh)
    except Exception as exc:  # la caché es opcional
        print("  (no se pudo guardar la caché:", exc, ")")
    return rna


# --------------------------------------------------------------------------
# Serialización
# --------------------------------------------------------------------------
def _num(x, nd=3):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, nd)


def _limpio(obj):
    """Convierte numpy/tuplas/NaN a JSON válido."""
    if isinstance(obj, dict):
        return {str(k): _limpio(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_limpio(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _limpio(obj.tolist())
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        return _num(obj, 4)
    return obj


def _grid(a, nd=2):
    return [[_num(v, nd) for v in fila] for fila in np.asarray(a).tolist()]


def _bits(a):
    return "".join("1" if v else "0" for v in np.asarray(a, dtype=bool).ravel())


class Sesion:
    """Una misión activa + su RNA entrenada."""

    def __init__(self, rna):
        self.rna = rna
        self.lock = threading.Lock()
        self.mision = None
        self.cfg = None
        self.mensaje = ""
        self.n_eventos_enviados = 0
        self.nueva(CFG_BASE.__dict__.copy())

    # -- comandos -----------------------------------------------------------
    def nueva(self, datos: dict):
        d = {**CFG_BASE.__dict__}
        for k, v in (datos or {}).items():
            if k in d and v is not None:
                d[k] = v
        if "tam" in (datos or {}):
            d["filas"] = d["columnas"] = int(datos["tam"])
        for k in ("filas", "columnas", "semilla", "n_sitios_ciencia", "max_pasos"):
            d[k] = int(d[k])
        d["bateria_inicial"] = float(d["bateria_inicial"])
        cfg = M.Config.from_dict(d)
        ok, errores = cfg.validar()
        if not ok:
            return {"ok": False, "errores": errores}
        self.cfg = cfg
        self.mision = M.Mission(cfg, self.rna)
        self.n_eventos_enviados = 0
        self.mensaje = f"Misión creada en {cfg.perfil.nombre} ({cfg.modo})."
        return {"ok": True}

    def pasos(self, n: int):
        m = self.mision
        resumenes = []
        for _ in range(max(1, min(int(n), 50))):
            if m.terminada:
                break
            resumenes.append(m.paso())
        if m.terminada:
            m.resultados()
        return resumenes

    # -- instantáneas ---------------------------------------------------------
    def estatico(self) -> dict:
        m = self.mision
        w, cfg, p = m.world, m.cfg, m.cfg.perfil
        return {
            "config": _limpio({k: v for k, v in cfg.__dict__.items()}),
            "perfil": _limpio({
                "clave": p.clave, "nombre": p.nombre, "tipo": p.tipo,
                "permite_rover": p.permite_rover, "nota": p.nota,
                "temp_media_C": p.temp_media_C, "presion_bar": p.presion_bar,
                "gravedad_ms2": p.gravedad_ms2, "irradiancia_rel": p.irradiancia_rel,
                "limite_termico_C": p.limite_termico_C, "peligros": p.peligros,
            }),
            "filas": w.filas, "cols": w.cols, "modo": w.modo,
            "inicio": list(w.inicio),
            "refugios": [list(r) for r in w.refugios],
            "celda_m": M.CELDA_M,
            "textura": _grid(w.textura, 2),
        }

    def dinamico(self) -> dict:
        m = self.mision
        e, w, b = m.estado, m.world, m.belief
        d = m.ultima_decision
        tz = m.traza_difusa
        plan = m.plan
        fila = m.logger.filas[-1] if m.logger.filas else {}

        difuso = None
        if tz is not None:
            act = sorted([a for a in (tz.activaciones or []) if a.get("grado", 0) > 1e-3],
                         key=lambda a: -a["grado"])[:6]
            difuso = {
                "entradas": _limpio(tz.entradas),
                "membresias": _limpio({v: {c: g for c, g in gs.items()
                                           if not c.startswith("NO ")}
                                       for v, gs in (tz.membresias or {}).items()}),
                "salidas": _limpio(tz.salidas),
                "fallback": bool(tz.fallback),
                "n_activas": int(tz.n_reglas_activas),
                "reglas": [{"id": a["id"], "grado": _num(a["grado"]),
                            "texto": a.get("texto", ""),
                            "consecuente": str(a.get("consecuente", "")),
                            "justificacion": a.get("justificacion", "")} for a in act],
                "ablacion": not m.cfg.usar_difuso,
            }

        ag = None
        if plan is not None:
            ag = {
                "activo": bool(m.cfg.usar_ag),
                "fitness": _num(plan.fitness),
                "factible": bool(plan.factible),
                "componentes": _limpio(plan.componentes),
                "genes": plan.cromosoma.genes_texto() if hasattr(plan.cromosoma, "genes_texto") else "",
                "energia_estimada": _num(plan.energia_estimada, 2),
                "candidatas": [{"camino": [list(c) for c in cand.camino],
                                "fitness": _num(cand.fitness),
                                "factible": bool(cand.factible),
                                "elegida": cand is plan}
                               for cand in (m.candidatas or [])[:3]],
                "pesos": _limpio(m.cfg.ag_pesos),
            }
            tzg = m.traza_ag
            if tzg is not None:
                ag["convergencia"] = {
                    "mejor": [_num(v) for v in tzg.mejor_por_gen],
                    "media": [_num(v) for v in tzg.media_por_gen],
                    "generaciones": tzg.generaciones_ejecutadas,
                    "parada_temprana": bool(tzg.parada_temprana),
                    "cruces": tzg.n_cruces, "mutaciones": tzg.n_mutaciones,
                    "segundos": _num(tzg.segundos, 3),
                }

        rna = None
        if m.prob_rna is not None:
            pr = m.prob_rna
            rna = {"libre": _num(pr[M.LIBRE]), "obstaculo": _num(pr[M.OBSTACULO]),
                   "barranco": _num(pr[M.BARRANCO]),
                   "prediccion": M.NOMBRE_CLASE[int(np.argmax(pr))],
                   "confianza": _num(float(np.max(pr))),
                   "umbral_veto": m.cfg.umbral_rna_barranco}

        decision = None
        if d is not None:
            decision = {"accion": d.accion, "motivo": d.motivo,
                        "velocidad": _num(d.velocidad),
                        "explicacion": d.explicacion(),
                        "vetos": list(d.vetos), "permitidos": list(d.permitidos),
                        "destino": list(d.destino) if d.destino else None}

        lo, hi = m.cfg.perfil.limite_termico_C
        telemetria = {k[len("sensor_"):]: _limpio(v) for k, v in fila.items()
                      if k.startswith("sensor_")}
        telemetria.update({
            "margen_termico": _num(M.margen_termico(e.temp_interna, (lo, hi)), 1),
            "riesgo_destino": _num(fila.get("riesgo_destino", 0.0)),
            "irradiancia": _num(w.irradiancia()),
            "reserva_requerida": _num(fila.get("reserva_requerida_pct"), 1),
            "sensores_invalidos": [s for s in (fila.get("sensores_invalidos") or "").split("|") if s],
        })

        nuevos = m.logger.eventos[self.n_eventos_enviados:]
        self.n_eventos_enviados = len(m.logger.eventos)

        return {
            "paso": m.paso_actual, "max_pasos": m.cfg.max_pasos,
            "terminada": bool(m.terminada), "motivo_fin": m.motivo_fin,
            "mensaje": self.mensaje,
            "rover": _limpio({
                "pos": e.pos, "rumbo": e.rumbo_idx, "bateria": e.bateria,
                "temp_interna": e.temp_interna, "desgaste": e.desgaste,
                "velocidad": e.velocidad, "estado": e.estado,
                "muestras": e.muestras, "valor_ciencia": e.valor_ciencia,
                "progreso": e.progreso, "distancia_m": e.distancia_recorrida_m,
                "calefactor": e.calefactor, "refrigerador": e.refrigerador,
                "instrumentos": [M.INSTRUMENTOS_BASE[i].nombre for i in e.instrumentos],
            }),
            "mundo": {
                "hora": _num(w.hora, 2), "noche": bool(w.es_noche()),
                "tormenta": _num(w.tormenta), "sismo": _num(w.sismo),
                "viento": _num(w.viento), "visibilidad": _num(w.visibilidad),
                "elev": _grid(w.elev, 2),
                "clase": "".join(str(int(v)) for v in w.clase.ravel()),
                "zonas": [{"centro": list(z["centro"]), "radio": z["radio"],
                           "tipo": z.get("tipo", "riesgo")} for z in w.zonas_riesgo],
                "anomalia_bio": list(w.anomalia_bio) if w.anomalia_bio else None,
                "alienigena": list(w.alienigena) if w.alienigena else None,
                "sitios": [{"id": s.id, "pos": list(s.pos), "valor": _num(s.valor),
                            "requiere": s.requiere, "recolectado": s.recolectado,
                            "prioritario": s.prioritario} for s in w.sitios],
                "valor_total": _num(m.valor_ciencia_total),
            },
            "creencia": {
                "riesgo": _grid(b.mapa_riesgo(), 2),
                "explorado": _bits(b.explorado),
                "confirmado": _bits(b.confirmado),
                "prohibido": _bits(b.prohibido),
            },
            "ruta_planificada": [list(c) for c in m.ruta_planificada],
            "indice_ruta": m.indice_ruta,
            "ruta_ejecutada": [list(c) for c in m.ruta_ejecutada],
            "decision": decision, "rna": rna, "difuso": difuso, "ag": ag,
            "telemetria": telemetria,
            "metricas": _limpio(m.metricas),
            "eventos_nuevos": _limpio(nuevos),
            "resultados": _limpio(m.logger.resultados) if m.terminada else None,
        }


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
SESION: Sesion = None  # type: ignore


class Manejador(BaseHTTPRequestHandler):
    server_version = "ARES-X/1.0"

    def log_message(self, fmt, *args):  # silencio salvo errores
        pass

    def _json(self, obj, code=200):
        cuerpo = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _descarga(self, datos: bytes, nombre: str, tipo: str):
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Disposition", f'attachment; filename="{nombre}"')
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def _cuerpo(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            return {}

    # -- GET -----------------------------------------------------------------
    def do_GET(self):
        ruta = urlparse(self.path).path
        try:
            if ruta == "/api/planetas":
                return self._json([{
                    "clave": p.clave, "nombre": p.nombre, "tipo": p.tipo,
                    "permite_rover": p.permite_rover, "nota": p.nota,
                    "temp_media_C": p.temp_media_C, "gravedad_ms2": p.gravedad_ms2,
                    "presion_bar": p.presion_bar,
                    "motivo_bloqueo": p.compatible("rover")[1] if not p.permite_rover else "",
                } for p in M.PERFILES.values()])
            if ruta == "/api/estado":
                with SESION.lock:
                    return self._json({"estatico": SESION.estatico(),
                                       "dinamico": SESION.dinamico()})
            if ruta == "/api/rna":
                r = SESION.rna
                return self._json(_limpio({
                    "metricas_test": {k: v for k, v in r.metricas_test.items()
                                      if not str(k).startswith("_")},
                    "ece": getattr(r, "ece_test", None),
                    "n_parametros": getattr(r, "n_parametros", None),
                    "matriz": getattr(r, "matriz_test", None),
                    "clases": M.NOMBRES_CLASES,
                }))
            if ruta == "/api/exportar/csv":
                with SESION.lock:
                    buf = io.StringIO()
                    SESION.mision.logger.df().to_csv(buf, index=False)
                return self._descarga(buf.getvalue().encode("utf-8-sig"),
                                      "ares_x_traza.csv", "text/csv; charset=utf-8")
            if ruta == "/api/exportar/json":
                with SESION.lock:
                    m = SESION.mision
                    m.resultados()
                    tmp = os.path.join(CACHE, "ares_x_mision.json")
                    m.logger.exportar_json(tmp, extra={
                        "metricas_rna": SESION.rna.metricas_test,
                        "resumen_mundo": m.world.resumen()})
                    with open(tmp, "rb") as fh:
                        datos = fh.read()
                return self._descarga(datos, "ares_x_mision.json", "application/json")
            return self._estatico(ruta)
        except Exception as exc:
            traceback.print_exc()
            return self._json({"ok": False, "error": str(exc)}, 500)

    def _estatico(self, ruta: str):
        if ruta in ("", "/"):
            ruta = "/index.html"
        destino = os.path.normpath(os.path.join(WEB, ruta.lstrip("/")))
        if not destino.startswith(WEB) or not os.path.isfile(destino):
            self.send_error(404)
            return
        with open(destino, "rb") as fh:
            datos = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(destino)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(datos)

    # -- POST ----------------------------------------------------------------
    def do_POST(self):
        ruta = urlparse(self.path).path
        datos = self._cuerpo()
        try:
            with SESION.lock:
                s = SESION
                m = s.mision
                if ruta == "/api/nueva":
                    r = s.nueva(datos)
                    if not r["ok"]:
                        return self._json(r, 400)
                    return self._json({"ok": True, "estatico": s.estatico(),
                                       "dinamico": s.dinamico()})
                if ruta == "/api/paso":
                    s.mensaje = ""
                    s.pasos(int(datos.get("n", 1)))
                elif ruta == "/api/evento":
                    tipo = str(datos.get("tipo", ""))
                    s.mensaje = m.inyectar_evento(tipo)
                    s.pasos(1)
                elif ruta == "/api/barranco":
                    celda = m.celda_frente()
                    s.mensaje = (m.colocar_barranco(celda) +
                                 " El rover aún no lo sabe: debe detectarlo.")
                elif ruta == "/api/fallo":
                    sensor = str(datos.get("sensor", "lidar"))
                    m.sensores.forzar_fallo(sensor, "nan")
                    s.mensaje = f"Fallo NaN inyectado en '{sensor}'."
                    s.pasos(1)
                elif ruta == "/api/pesos":
                    pesos = {k: float(v) for k, v in (datos.get("pesos") or {}).items()
                             if k in m.cfg.ag_pesos}
                    m.cfg.ag_pesos.update(pesos)
                    m.ag.cfg.ag_pesos = m.cfg.ag_pesos
                    m._replanificado_este_paso = False
                    m.replanificar("Operador cambió los pesos del fitness")
                    s.mensaje = "Pesos del fitness actualizados: el AG replanificó."
                else:
                    return self._json({"ok": False, "error": "ruta desconocida"}, 404)
                return self._json({"ok": True, "estatico": None, "dinamico": s.dinamico()})
        except Exception as exc:
            traceback.print_exc()
            return self._json({"ok": False, "error": str(exc)}, 500)


def main():
    global SESION
    ap = argparse.ArgumentParser(description="ARES-X · Centro de Control 3D")
    ap.add_argument("--puerto", type=int, default=8000)
    ap.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    args = ap.parse_args()

    print("=" * 64)
    print(" ARES-X · Rover autónomo · Centro de Control 3D")
    print("=" * 64)
    SESION = Sesion(preparar_rna())
    srv = ThreadingHTTPServer(("127.0.0.1", args.puerto), Manejador)
    url = f"http://localhost:{args.puerto}"
    print(f"\n  Listo → abre {url} en el navegador  (Ctrl+C para detener)\n")
    if not args.no_abrir:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
