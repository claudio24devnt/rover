// ARES-X · Centro de Control 3D — lógica de interfaz.
// Todas las decisiones las toma el motor Python (servidor.py); aquí sólo se
// envían órdenes del operador y se dibuja el estado que devuelve.
import { Escena3D, COLOR_MUESTRA } from './escena.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x)) ? '—' : Number(x).toFixed(d);

const escena = new Escena3D($('#escena'), $('#capa-etiquetas'));

const S = {
  planetas: [], est: null, din: null,
  corriendo: false, vel: 1, ocupado: false,
  cfg: { planeta: 'marte', modo: 'rover', dificultad: 'media' },
  historial: [], ultimaDecision: '',
};

const INTERVALO = { 1: 650, 2: 360, 4: 170, 8: 70 };

const EVENTOS = [
  ['sismo', '🌋', 'Sismo: altera el relieve'],
  ['meteorito', '☄️', 'Impacto de meteorito'],
  ['tormenta_polvo', '🌪️', 'Tormenta de polvo'],
  ['noche', '🌙', 'Forzar la noche'],
  ['fallo_sensor', '🛠️', 'Fallo de sensor aleatorio'],
  ['perdida_enlace', '📶', 'Pérdida de enlace'],
  ['sep'],
  ['biofirma', '🧬', 'Señal anómala (no confirma vida)'],
  ['alienigena', '🛸', 'Contacto ficticio (narrativa)'],
  ['corrosion', '🧪', 'Corrosión ácida'],
  ['viento', '💨', 'Ráfaga de viento'],
];

const ICONO_EV = {
  sismo: '🌋', meteorito: '☄️', tormenta_polvo: '🌪️', noche: '🌙', fallo_sensor: '🛠️', perdida_enlace: '📶',
  biofirma: '🧬', alienigena: '🛸', corrosion: '🧪', viento: '💨', muestra: '💎', muestra_fallida: '❌',
  colision: '💥', frenado_insuficiente: '💥', deslizamiento: '⛰️', frenado_en_borde: '⚠️', replanificacion: '🧬',
  veto_ruta: '⛔', recuperacion: '🔧', relajacion_zonas: '🔓', sin_ruta: '🚫', barranco_manual: '🕳️', deriva_viento: '💨',
};
const MALOS = new Set(['colision', 'frenado_insuficiente', 'deslizamiento', 'frenado_en_borde', 'veto_ruta', 'sin_ruta', 'muestra_fallida', 'meteorito', 'sismo', 'fallo_sensor', 'perdida_enlace', 'corrosion']);
const TOAST_SI = new Set(['sismo', 'meteorito', 'tormenta_polvo', 'noche', 'fallo_sensor', 'perdida_enlace', 'biofirma', 'alienigena', 'corrosion', 'viento',
  'muestra', 'muestra_fallida', 'colision', 'frenado_insuficiente', 'deslizamiento', 'frenado_en_borde', 'sin_ruta', 'recuperacion']);

const COLOR_PLANETA = {
  mercurio: 'radial-gradient(circle at 35% 30%, #d9d4cc, #8a8580 55%, #3a3734)',
  venus: 'radial-gradient(circle at 35% 30%, #fff0c2, #e0b45c 55%, #7a5320)',
  tierra: 'radial-gradient(circle at 35% 30%, #a8e0ff, #2f7fd0 50%, #2f6b2a 72%, #0d2a4d)',
  marte: 'radial-gradient(circle at 35% 30%, #ffb08a, #c1440e 55%, #4a1404)',
  jupiter: 'repeating-linear-gradient(170deg, #f3e2c4 0 4px, #c98a55 4px 7px, #e9cfa3 7px 10px, #9e5a33 10px 12px)',
  saturno: 'repeating-linear-gradient(170deg, #f2e6c2 0 5px, #d9c08a 5px 9px, #eedcae 9px 12px)',
  urano: 'radial-gradient(circle at 35% 30%, #e6ffff, #8fdfe5 55%, #2a7e8a)',
  neptuno: 'radial-gradient(circle at 35% 30%, #9fb8ff, #3557c4 55%, #0e1a52)',
};

// --------------------------------------------------------------------- API
async function api(ruta, cuerpo) {
  const op = cuerpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) };
  const r = await fetch(ruta, op);
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || 'Error del servidor'), { datos: j });
  return j;
}

// ------------------------------------------------------------------ inicio
async function iniciar() {
  construirEventos();
  enlazarControles();
  try {
    S.planetas = await api('/api/planetas');
    construirPlanetas();
    const r = await api('/api/estado');
    aplicarEstatico(r.estatico);
    aplicarDinamico(r.dinamico, 0);
    api('/api/rna').then(pintarMetricasRNA).catch(() => {});
    $('#cargando').classList.add('fuera');
    setTimeout(() => $('#cargando').remove(), 700);
    toast('🚀', 'Configura la misión a la izquierda y pulsa <b>Lanzar</b>, o dale ▶ para empezar en Marte.');
  } catch (e) {
    $('#carga-texto').innerHTML = '❌ No se pudo conectar con el motor. ¿Está corriendo <code>python servidor.py</code>?';
    console.error(e);
  }
}

function construirPlanetas() {
  const cont = $('#planetas');
  cont.innerHTML = '';
  S.planetas.forEach(p => {
    const b = document.createElement('button');
    b.className = 'planeta' + (p.clave === S.cfg.planeta ? ' activo' : '');
    b.dataset.clave = p.clave;
    b.title = `${p.nombre} · ${p.tipo} · T media ${p.temp_media_C} °C · g ${p.gravedad_ms2} m/s²\n${p.nota}`;
    b.innerHTML = `<div class="bola" style="background:${COLOR_PLANETA[p.clave]}"></div><div class="n">${p.nombre}</div>${p.permite_rover ? '' : '<span class="tag">sonda</span>'}`;
    b.onclick = () => elegirPlaneta(p.clave);
    cont.appendChild(b);
  });
}

function elegirPlaneta(clave) {
  S.cfg.planeta = clave;
  $$('.planeta').forEach(b => b.classList.toggle('activo', b.dataset.clave === clave));
  const p = S.planetas.find(x => x.clave === clave);
  const bRover = $('#seg-modo [data-v=rover]');
  const aviso = $('#aviso-planeta');
  if (!p.permite_rover) {
    // CA-07: la interfaz impide el rover en gigantes gaseosos/helados
    bRover.disabled = true;
    seleccionarSeg('#seg-modo', 'sonda'); S.cfg.modo = 'sonda';
    aviso.innerHTML = `<b>Modo rover bloqueado.</b> ${p.motivo_bloqueo}`;
    aviso.classList.remove('oculto');
  } else {
    bRover.disabled = false;
    aviso.classList.add('oculto');
    if (S.cfg.modo === 'sonda') { seleccionarSeg('#seg-modo', 'rover'); S.cfg.modo = 'rover'; }
  }
}

function seleccionarSeg(sel, v) { $$(sel + ' button').forEach(b => b.classList.toggle('activo', b.dataset.v === v)); }

function construirEventos() {
  const cont = $('#eventos');
  EVENTOS.forEach(([tipo, ic, txt]) => {
    if (tipo === 'sep') { const s = document.createElement('span'); s.className = 'sep'; cont.appendChild(s); return; }
    const b = document.createElement('button');
    b.textContent = ic; b.dataset.tip = txt; b.setAttribute('aria-label', txt);
    b.onclick = () => orden('/api/evento', { tipo });
    cont.appendChild(b);
  });
}

function enlazarControles() {
  $$('#seg-modo button').forEach(b => b.onclick = () => { if (b.disabled) return; S.cfg.modo = b.dataset.v; seleccionarSeg('#seg-modo', b.dataset.v); });
  $$('#seg-dif button').forEach(b => b.onclick = () => { S.cfg.dificultad = b.dataset.v; seleccionarSeg('#seg-dif', b.dataset.v); });
  $('#dado').onclick = () => { $('#in-semilla').value = Math.floor(Math.random() * 99999); };
  const salida = (id, f) => { const i = $('#in-' + id); const o = $('#o-' + id); const up = () => o.textContent = f(i.value); i.oninput = up; up(); };
  salida('bateria', v => `${v} %`); salida('tam', v => `${v} × ${v}`); salida('sitios', v => v);
  $('#btn-lanzar').onclick = lanzar;

  $('#toggle-mision').onclick = () => alternarPanel('#panel-mision');
  $('#toggle-ia').onclick = () => alternarPanel('#panel-ia');

  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('activo', x === b));
    $$('.tab').forEach(t => t.classList.toggle('activo', t.id === 'tab-' + b.dataset.tab));
  });

  $$('.camaras [data-cam]').forEach(b => b.onclick = () => {
    $$('.camaras [data-cam]').forEach(x => x.classList.toggle('activo', x === b));
    escena.setModoCamara(b.dataset.cam);
  });
  $$('[data-capa]').forEach(c => c.onchange = () => escena.setCapa(c.dataset.capa, c.checked));

  $('#btn-play').onclick = () => S.corriendo ? pausar() : correr();
  $('#btn-paso').onclick = () => { pausar(); paso(); };
  $('#btn-reiniciar').onclick = () => { pausar(); lanzar(true); };
  $$('.velocidades button').forEach(b => b.onclick = () => { S.vel = +b.dataset.vel; $$('.velocidades button').forEach(x => x.classList.toggle('activo', x === b)); });
  $('#btn-barranco').onclick = () => orden('/api/barranco', {});
  $('#btn-lidar').onclick = () => orden('/api/fallo', { sensor: 'lidar' });
  $('#btn-pesos').onclick = () => {
    const pesos = {}; $$('#pesos input').forEach(i => pesos[i.dataset.k] = +i.value);
    orden('/api/pesos', { pesos });
  };
  $('#filtro').oninput = pintarBitacora;

  $('#btn-ayuda').onclick = () => $('#modal-ayuda').classList.remove('oculto');
  $('#ayuda-cerrar').onclick = () => $('#modal-ayuda').classList.add('oculto');
  $('#fin-ver').onclick = () => $('#modal-fin').classList.add('oculto');
  $('#fin-nueva').onclick = () => { $('#modal-fin').classList.add('oculto'); abrirPanel('#panel-mision', true); };
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('oculto'); }));

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); S.corriendo ? pausar() : correr(); }
    else if (e.key === 'n' || e.key === 'N') { pausar(); paso(); }
    else if (e.key === 'r' || e.key === 'R') { pausar(); lanzar(true); }
    else if (e.key === 'c' || e.key === 'C') { $('.camaras [data-cam=seguir]').click(); }
    else if (e.key === 'b' || e.key === 'B') { const c = $('[data-capa=creencia]'); c.checked = !c.checked; c.onchange(); }
    else if (e.key === 'Escape') $$('.modal').forEach(m => m.classList.add('oculto'));
  });
}

function alternarPanel(sel) { abrirPanel(sel, !$(sel).classList.contains('abierto')); }
function abrirPanel(sel, abrir) {
  $(sel).classList.toggle('abierto', abrir);
  if (sel === '#panel-mision') document.body.classList.toggle('mision-cerrada', !abrir);
}

// -------------------------------------------------------------- comandos
function leerConfig() {
  return {
    planeta: S.cfg.planeta, modo: S.cfg.modo, dificultad: S.cfg.dificultad,
    semilla: +$('#in-semilla').value || 0, max_pasos: +$('#in-pasos').value || 240,
    bateria_inicial: +$('#in-bateria').value, tam: +$('#in-tam').value,
    n_sitios_ciencia: +$('#in-sitios').value,
    usar_rna: $('#sw-rna').checked, usar_difuso: $('#sw-difuso').checked, usar_ag: $('#sw-ag').checked,
    eventos_aleatorios: $('#sw-eventos').checked,
  };
}

async function lanzar(reinicio = false) {
  pausar();
  const err = $('#errores');
  err.classList.add('oculto');
  try {
    const r = await api('/api/nueva', leerConfig());
    S.historial = []; S.ultimaDecision = '';
    aplicarEstatico(r.estatico);
    aplicarDinamico(r.dinamico, 0);
    $('#modal-fin').classList.add('oculto');
    if (!reinicio) abrirPanel('#panel-mision', false);
    toast(S.est.modo === 'sonda' ? '🎈' : '🚙', `Misión ${reinicio ? 'reiniciada' : 'lista'} en <b>${S.est.perfil.nombre}</b>. Pulsa ▶ o <kbd>Espacio</kbd>.`, 'ok');
  } catch (e) {
    const errores = e.datos?.errores || [e.message];
    err.innerHTML = '<b>Configuración rechazada:</b><ul>' + errores.map(x => `<li>${x}</li>`).join('') + '</ul>';
    err.classList.remove('oculto');
    abrirPanel('#panel-mision', true);
  }
}

async function orden(ruta, cuerpo) {
  if (S.ocupado) return;
  S.ocupado = true;
  try {
    const r = await api(ruta, cuerpo);
    aplicarDinamico(r.dinamico, INTERVALO[S.vel] * 0.9);
    if (r.dinamico.mensaje) toast('🛰️', r.dinamico.mensaje);
  } catch (e) { toast('❌', e.message, 'malo'); }
  finally { S.ocupado = false; }
}

async function paso() {
  if (S.ocupado || !S.din || S.din.terminada) return false;
  S.ocupado = true;
  try {
    const n = S.vel >= 8 ? 2 : 1;
    const r = await api('/api/paso', { n });
    aplicarDinamico(r.dinamico, INTERVALO[S.vel] * 0.95);
    return !r.dinamico.terminada;
  } catch (e) { toast('❌', e.message, 'malo'); return false; }
  finally { S.ocupado = false; }
}

async function correr() {
  if (!S.din || S.din.terminada) return;
  S.corriendo = true;
  const b = $('#btn-play'); b.textContent = '⏸'; b.classList.add('pausa');
  while (S.corriendo) {
    const t0 = performance.now();
    const sigue = await paso();
    if (!sigue) break;
    const espera = INTERVALO[S.vel] - (performance.now() - t0);
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
  }
  pausar();
}

function pausar() {
  S.corriendo = false;
  const b = $('#btn-play'); b.textContent = '▶'; b.classList.remove('pausa');
}

// ---------------------------------------------------------- aplicar estado
function aplicarEstatico(est) {
  S.est = est;
  escena.construir(est);
  $('#chip-planeta').textContent = `${est.modo === 'sonda' ? '🎈' : '🚙'} ${est.perfil.nombre}`;
  $('#bitacora').innerHTML = '';
  S.eventos = [];
  // Sincroniza el formulario con la configuración efectiva
  const c = est.config;
  S.cfg.planeta = c.planeta; S.cfg.modo = c.modo; S.cfg.dificultad = c.dificultad;
  if (S.planetas.length) elegirPlaneta(c.planeta);
  seleccionarSeg('#seg-modo', c.modo); seleccionarSeg('#seg-dif', c.dificultad);
  construirPesos(c.ag_pesos);
  const ablaciones = { rna: c.usar_rna, dif: c.usar_difuso, ag: c.usar_ag };
  $$('#tuberia span').forEach(s => s.classList.toggle('off', ablaciones[s.dataset.e] === false));
}

function aplicarDinamico(din, dur) {
  S.din = din;
  escena.ultimoDin = din;
  escena.actualizar(din, dur);
  pintarBarra(din);
  pintarBanner(din);
  pintarIA(din);
  pintarTelemetria(din);
  (din.eventos_nuevos || []).forEach(ev => {
    S.eventos.push(ev);
    if (TOAST_SI.has(ev.tipo)) toast(ICONO_EV[ev.tipo] || '•', `<b>${ev.tipo.replace(/_/g, ' ')}</b> · ${ev.detalle}`, MALOS.has(ev.tipo) ? 'malo' : (ev.tipo === 'muestra' ? 'ok' : ''));
  });
  if (din.decision) S.historial.push({ paso: din.paso, ...din.decision, bateria: din.rover.bateria });
  pintarBitacora();
  pintarMinimapa(din);
  animarTuberia();
  if (din.terminada) { pausar(); mostrarFin(din); }
}

function medidor(id, frac, texto, nivel) {
  const m = $('#m-' + id);
  m.querySelector('i').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  $('#v-' + id).textContent = texto;
  m.classList.toggle('aviso', nivel === 'aviso'); m.classList.toggle('malo', nivel === 'malo');
}

function pintarBarra(din) {
  const r = din.rover, t = din.telemetria, m = din.mundo;
  medidor('bateria', r.bateria / 100, `${fmt(r.bateria)} %`, r.bateria > 30 ? '' : r.bateria > 12 ? 'aviso' : 'malo');
  const res = t.reserva_requerida; $('#m-bateria .m-reserva').style.left = `${Math.min(100, res || 0)}%`;
  const vt = m.valor_total || 1;
  medidor('ciencia', r.valor_ciencia / vt, `${fmt(r.valor_ciencia, 2)} / ${fmt(vt, 2)}`, '');
  const mt = t.margen_termico ?? 0;
  medidor('termico', (mt + 20) / 100, `${fmt(mt, 0)} °C`, mt > 25 ? '' : mt > 8 ? 'aviso' : 'malo');
  const mec = 100 - Math.min(100, r.desgaste);
  medidor('mecanico', mec / 100, `${fmt(mec, 0)} %`, mec > 40 ? '' : mec > 15 ? 'aviso' : 'malo');
  medidor('velocidad', r.velocidad, fmt(r.velocidad, 2), '');
  const ch = $('#chip-estado'); ch.textContent = r.estado.replace('_', ' '); ch.className = 'chip estado ' + r.estado;
  $('#chip-paso').textContent = `paso ${din.paso} / ${din.max_pasos}`;
  const h = m.hora, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  $('#chip-hora').textContent = `${m.noche ? '🌙' : '☀️'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${m.tormenta > 0.2 ? ' · 🌪️' : ''}`;
}

function claseAccion(d) {
  if (!d) return '';
  if (d.motivo.startsWith('VETO') || d.accion === 'MODO_SEGURO' || d.motivo === 'SIN_RUTA' || d.motivo === 'REFUGIO_INALCANZABLE') return 'veto';
  if (['DETENER', 'REPLANIFICAR', 'VOLVER'].includes(d.accion)) return 'alerta';
  return '';
}

function pintarBanner(din) {
  const d = din.decision, b = $('#banner');
  if (!d) { b.classList.add('oculto'); return; }
  b.classList.remove('oculto');
  const clase = claseAccion(d);
  b.className = clase;
  $('#b-accion').textContent = d.accion;
  $('#b-texto').textContent = d.explicacion;
  const firma = d.accion + d.motivo;
  if (firma !== S.ultimaDecision) { b.classList.add('pulso'); setTimeout(() => b.classList.remove('pulso'), 500); S.ultimaDecision = firma; }
}

// ------------------------------------------------------------- panel IA
function barraP(nombre, v, color, umbral) {
  return `<div class="barra-p"><span>${nombre}</span><div class="pista"><i style="width:${(v || 0) * 100}%;background:${color}"></i>${umbral ? `<em class="umbral" style="left:${umbral * 100}%" title="umbral de veto"></em>` : ''}</div><b>${fmt(v, 2)}</b></div>`;
}

function pintarIA(din) {
  // Árbitro
  const d = din.decision;
  $('#arbitro').innerHTML = d ? `
    <div><span class="accion-tag ${claseAccion(d)}">${d.accion}</span> <span class="mini">velocidad ejecutada <b>${fmt(d.velocidad, 3)}</b></span></div>
    <div class="explica">${d.explicacion}</div>
    ${d.vetos.length ? `<div class="mini">Restricciones que vetaron:</div><div class="lista-c vetos">${d.vetos.map(v => `<span>${v}</span>`).join('')}</div>` : ''}
    ${d.permitidos.length ? `<div class="mini">Condiciones verificadas:</div><div class="lista-c">${d.permitidos.map(v => `<span>${v}</span>`).join('')}</div>` : ''}`
    : '<div class="mini">Sin decisiones aún. Pulsa ▶ o ⏭.</div>';

  // RNA
  const r = din.rna;
  $('#rna').innerHTML = r ? `
    <div class="pred">Predicción: <b style="color:${r.prediccion === 'barranco' ? 'var(--malo)' : r.prediccion === 'obstaculo' ? 'var(--aviso)' : 'var(--ok)'}">${r.prediccion}</b> · confianza ${fmt(r.confianza, 2)}</div>
    ${barraP('🟢 libre', r.libre, 'linear-gradient(90deg,#2fd27a,#3dff8b)')}
    ${barraP('🪨 obstáculo', r.obstaculo, 'linear-gradient(90deg,#ff9a2f,#ffcf5a)')}
    ${barraP('🕳️ barranco', r.barranco, 'linear-gradient(90deg,#ff2f4a,#ff7a7a)', r.umbral_veto)}`
    : `<div class="mini">${S.est?.config.usar_rna === false ? '⛔ Desactivada (ablación): la creencia usa sólo el sensor de borde.' : 'Sin destino evaluado en este paso.'}</div>`;

  // Difuso
  const f = din.difuso;
  if (!f) $('#difuso').innerHTML = '<div class="mini">Sin inferencia aún.</div>';
  else if (f.ablacion) $('#difuso').innerHTML = '<div class="mini">⛔ Desactivado (ablación): velocidad fija 0,40 (media del difuso).</div>';
  else {
    const nombres = { distancia_m: 'distancia', bateria_pct: 'batería', pendiente_deg: 'pendiente', margen_termico_C: 'margen térm.' };
    const unid = { distancia_m: 'm', bateria_pct: '%', pendiente_deg: '°', margen_termico_C: '°C' };
    const mus = Object.entries(f.membresias || {}).filter(([v]) => nombres[v]).map(([v, gs]) => `
      <div class="mu"><span>${nombres[v]} <b>${fmt(f.entradas?.[v], 1)}${unid[v]}</b></span><div class="conj">${Object.entries(gs).map(([c, g]) =>
        `<span title="μ(${c}) = ${fmt(g, 2)}"><em style="width:${g * 100}%"></em><b>${c}</b></span>`).join('')}</div></div>`).join('');
    $('#difuso').innerHTML = `
      <div class="salidas">
        <div class="salida"><div class="k">velocidad</div><div class="v" style="color:var(--acento)">${fmt(f.salidas.velocidad, 3)}</div></div>
        <div class="salida"><div class="k">cautela</div><div class="v" style="color:var(--aviso)">${fmt(f.salidas.cautela, 3)}</div></div>
      </div>
      ${f.fallback ? '<div class="aviso malo">Ninguna regla activa → salida de respaldo (velocidad 0, cautela 1).</div>' : ''}
      ${mus}
      <div class="mini" style="margin:8px 0 2px">${f.n_activas} reglas activas · las más fuertes:</div>
      ${f.reglas.map(rg => `<div class="regla" title="${(rg.justificacion || '').replace(/"/g, '&quot;')}"><span class="id">R${String(rg.id).padStart(2, '0')}</span>
        <div><div class="txt">${rg.texto}</div><div class="bar" style="width:${rg.grado * 100}%"></div></div><span class="g">${fmt(rg.grado, 2)}</span></div>`).join('')}`;
  }

  // AG
  const a = din.ag;
  if (!a) $('#ag').innerHTML = '<div class="mini">Sin plan aún.</div>';
  else if (!a.activo) $('#ag').innerHTML = '<div class="mini">⛔ Desactivado (ablación): planificación A* al objetivo más cercano.</div>';
  else {
    const comp = a.componentes || {};
    const filas = [['ciencia', 'aporte_ciencia', '#3dff8b'], ['distancia', 'aporte_distancia', '#ff9a6b'], ['energía', 'aporte_energia', '#ffcf5a'],
      ['riesgo', 'aporte_riesgo', '#ff4d5e'], ['tiempo', 'aporte_tiempo', '#b07cff']];
    const pen = comp.penalizacion || 0;
    const max = Math.max(0.05, ...filas.map(([, k]) => Math.abs(comp[k] || 0)), pen);
    const barra = (v, col) => { const w = Math.abs(v) / max * 50; return v >= 0 ? `<i style="left:50%;width:${w}%;background:${col}"></i>` : `<i style="right:50%;width:${w}%;background:${col}"></i>`; };
    $('#ag').innerHTML = `
      <div class="pred">Fitness <b style="color:var(--acento)">${a.fitness >= 0 ? '+' : ''}${fmt(a.fitness, 3)}</b> · ${a.factible ? '<span style="color:var(--ok)">factible</span>' : '<span style="color:var(--malo)">INVIABLE</span>'} · ${a.candidatas.length} candidatas</div>
      ${filas.map(([n, k, col]) => `<div class="comp"><span>${n}</span><div class="eje">${barra(comp[k] || 0, col)}</div><b>${(comp[k] || 0) >= 0 ? '+' : ''}${fmt(comp[k], 3)}</b></div>`).join('')}
      ${pen > 0 ? `<div class="comp"><span>penalización</span><div class="eje">${barra(-pen, '#ff2f4a')}</div><b>−${fmt(pen, 3)}</b></div>` : ''}
      <div class="genes" title="Cromosoma: orden (viajero) | visitas | instrumentos (mochila) | waypoints (laberinto)">${a.genes}</div>
      ${a.convergencia ? `<div class="mini">${a.convergencia.generaciones} generaciones${a.convergencia.parada_temprana ? ' (parada temprana)' : ''} · ${a.convergencia.cruces} cruces · ${a.convergencia.mutaciones} mutaciones · ${fmt(a.convergencia.segundos, 2)} s</div>` : ''}`;
    dibujarConvergencia(a.convergencia);
  }
}

function dibujarConvergencia(cv) {
  const c = $('#convergencia'), x = c.getContext('2d');
  const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = 70 * devicePixelRatio;
  x.clearRect(0, 0, W, H);
  if (!cv || !cv.mejor?.length) return;
  const todos = [...cv.mejor, ...(cv.media || [])].filter(v => v !== null);
  const lo = Math.min(...todos), hi = Math.max(...todos), rng = Math.max(1e-6, hi - lo);
  const pad = 8 * devicePixelRatio;
  const linea = (serie, color, ancho) => {
    x.beginPath(); x.strokeStyle = color; x.lineWidth = ancho * devicePixelRatio;
    serie.forEach((v, i) => { const px = pad + i / Math.max(1, serie.length - 1) * (W - 2 * pad), py = H - pad - (v - lo) / rng * (H - 2 * pad); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  };
  if (cv.media) linea(cv.media.map(v => v ?? lo), 'rgba(176,124,255,.7)', 1.2);
  linea(cv.mejor.map(v => v ?? lo), '#3dff8b', 2);
  x.fillStyle = '#8d9bb3'; x.font = `${10 * devicePixelRatio}px Inter`;
  x.fillText('convergencia: mejor (verde) · media (morado)', pad, pad + 4 * devicePixelRatio);
}

function construirPesos(pesos) {
  const cont = $('#pesos'); cont.innerHTML = '';
  Object.entries(pesos || {}).forEach(([k, v]) => {
    const d = document.createElement('div'); d.className = 'deslizador';
    d.innerHTML = `<label>${k} <b>${fmt(v, 2)}</b></label><input type="range" min="0" max="1" step="0.01" value="${v}" data-k="${k}">`;
    const i = d.querySelector('input'); i.oninput = () => d.querySelector('b').textContent = fmt(+i.value, 2);
    cont.appendChild(d);
  });
}

function pintarMetricasRNA(r) {
  const m = r.metricas_test || {};
  $('#rna-metricas').innerHTML = `Test sobre mapas nunca vistos: exactitud <b>${fmt(m.exactitud, 3)}</b> · macro-F1 <b>${fmt(m.macro_f1, 3)}</b> · recall barranco <b>${fmt(m.recall_barranco, 3)}</b> · ECE <b>${fmt(r.ece, 3)}</b> · ${r.n_parametros} parámetros`;
}

function animarTuberia() {
  const spans = $$('#tuberia span');
  spans.forEach(s => s.classList.remove('on'));
  spans.forEach((s, i) => { if (!s.classList.contains('off')) setTimeout(() => { s.classList.add('on'); setTimeout(() => s.classList.remove('on'), 260); }, i * 70); });
}

// --------------------------------------------------------- telemetría
function pintarTelemetria(din) {
  const t = din.telemetria, r = din.rover, m = din.mundo, p = S.est.perfil;
  const lim = p.limite_termico_C;
  const nivel = (v, a, b) => v > a ? 'ok' : v > b ? 'aviso' : 'malo';
  const tv = (k, v, u, l, cl = '') => `<div class="tv ${cl}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div><div class="l">${l}</div></div>`;
  $('#telemetria').innerHTML = [
    tv('Batería', fmt(r.bateria), '%', `reserva requerida ${fmt(t.reserva_requerida, 0)}%`, nivel(r.bateria, 30, 12)),
    tv('Potencia solar', fmt(t.potencia_solar_W), 'W', `irradiancia ${fmt(t.irradiancia, 2)}× Tierra`),
    tv('Temp. interior', fmt(r.temp_interna), '°C', `HW [${lim[0]}, ${lim[1]}]${r.calefactor ? ' · calefactor' : ''}${r.refrigerador ? ' · refrigerador' : ''}`, nivel(t.margen_termico, 25, 8)),
    tv('Temp. exterior', fmt(t.temp_exterior_C), '°C', `ambiente ${p.nombre}`),
    tv('Prox. frontal', fmt(t.prox_frontal_m), 'm', 'LIDAR · rango 0–20', t.prox_frontal_m === null ? 'malo' : ''),
    tv('Inclinación', fmt(t.inclinacion_deg), '°', 'máx. vuelco 28°', t.inclinacion_deg === null ? 'malo' : ''),
    tv('Riesgo destino', fmt(t.riesgo_destino, 2), '', '0–1 estimado', t.riesgo_destino < 0.35 ? 'ok' : t.riesgo_destino < 0.6 ? 'aviso' : 'malo'),
    tv('Aceleración', fmt(t.aceleracion, 2), 'm/s²', `sismo ${fmt(m.sismo, 2)}`),
    tv('Radiación', fmt(t.radiacion_mSv_h, 3), 'mSv/h', 'escala ilustrativa'),
    tv('Presión', t.presion_bar === null ? '—' : Number(t.presion_bar).toPrecision(3), 'bar', `[NASA] ${p.presion_bar} bar`),
    tv('O₂ ambiental', fmt(t.o2_pct, 2), '% vol', 'composición, no respiración'),
    tv('CO₂ ambiental', fmt(t.co2_pct, 2), '% vol', 'composición'),
    tv('Partículas', fmt(t.particulas, 2), '', `visibilidad ${fmt(t.visibilidad_m, 0)} m`),
    tv('Odometría', fmt(t.odometria_m), 'm', `real ${fmt(r.distancia_m)} m (deriva)`),
    tv('Estado mecánico', fmt(100 - Math.min(100, r.desgaste), 0), '%', 'desgaste acumulado', nivel(100 - r.desgaste, 40, 15)),
    tv('Latencia enlace', fmt(t.latencia_enlace_s, 2), 's', 'autonomía local si falla'),
    tv('Muestras', r.muestras.length, '', `ciencia ${fmt(r.valor_ciencia, 2)}`),
    tv('Gravedad', fmt(p.gravedad_ms2, 1), 'm/s²', '[NASA]'),
  ].join('');
  const av = [];
  if (t.sensores_invalidos?.length) av.push(`<div class="aviso malo">⚠ Sensores inválidos: <b>${t.sensores_invalidos.join(', ')}</b> → degradación segura.</div>`);
  if (m.anomalia_bio) av.push('<div class="aviso">🧬 Señal anómala registrada. <b>No constituye detección de vida</b>; requiere análisis independiente.</div>');
  if (m.alienigena) av.push('<div class="aviso">🛸 Evento narrativo <b>FICTICIO</b>: tratado como obstáculo dinámico, sin valor científico.</div>');
  $('#tele-avisos').innerHTML = av.join('');
}

// ------------------------------------------------------------ bitácora
function pintarBitacora() {
  const filtro = ($('#filtro').value || '').toLowerCase();
  const items = [];
  (S.eventos || []).forEach(e => items.push({ paso: e.paso, tipo: e.tipo, det: e.detalle, ic: ICONO_EV[e.tipo] || '•', cl: MALOS.has(e.tipo) ? 'malo' : e.tipo === 'muestra' ? 'ok' : '' }));
  S.historial.slice(-80).forEach(h => {
    if (h.accion === 'AVANZAR' && h.motivo === 'OK_AVANCE') return;  // ruido: avance normal
    items.push({ paso: h.paso, tipo: `${h.accion} · ${h.motivo}`, det: h.explicacion, ic: h.motivo.startsWith('VETO') ? '⛔' : '⚖️', cl: (h.motivo.startsWith('VETO') ? 'malo ' : '') + 'decision' });
  });
  items.sort((a, b) => b.paso - a.paso);
  $('#bitacora').innerHTML = items.filter(i => !filtro || (i.tipo + ' ' + i.det).toLowerCase().includes(filtro)).slice(0, 120).map(i =>
    `<div class="ev ${i.cl}"><div class="ic">${i.ic}</div><div><div class="cab">${i.tipo.replace(/_/g, ' ')}<span>paso ${i.paso}</span></div><div class="det">${i.det}</div></div></div>`).join('')
    || '<div class="mini">Sin eventos todavía.</div>';
}

// ------------------------------------------------------------ minimapa
function pintarMinimapa(din) {
  const c = $('#mini'), x = c.getContext('2d');
  const R = S.est.filas, C = S.est.cols, W = c.width, H = c.height, cw = W / C, chh = H / R;
  const elev = din.mundo.elev, clase = din.mundo.clase;
  let lo = Infinity, hi = -Infinity; elev.forEach(f => f.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
  const sonda = S.est.modo === 'sonda';
  for (let f = 0; f < R; f++) for (let k = 0; k < C; k++) {
    const t = (elev[f][k] - lo) / Math.max(1e-6, hi - lo), cl = clase[f * C + k];
    const l = sonda ? 70 - t * 35 : 22 + t * 30;
    x.fillStyle = cl === '1' ? (sonda ? '#d8dde6' : '#7a5a48') : cl === '2' ? (sonda ? '#8a2a6a' : '#0b0607') : `hsl(${sonda ? 200 : 18},${sonda ? 30 : 45}%,${l}%)`;
    x.fillRect(k * cw, f * chh, cw + 0.5, chh + 0.5);
    if (din.creencia.prohibido[f * C + k] === '1') { x.strokeStyle = '#ff2a5a'; x.lineWidth = 1; x.strokeRect(k * cw + 1, f * chh + 1, cw - 2, chh - 2); }
  }
  const ruta = (pts, col, w) => { if (!pts || pts.length < 2) return; x.beginPath(); x.strokeStyle = col; x.lineWidth = w; pts.forEach(([f, k], i) => { const px = (k + .5) * cw, py = (f + .5) * chh; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); };
  ruta(din.ruta_ejecutada, '#3d8bff', 2);
  ruta(din.ruta_planificada.slice(Math.max(0, din.indice_ruta - 1)), '#3dff8b', 1.5);
  S.est.refugios.forEach(([f, k]) => { x.fillStyle = '#3dff8b'; x.beginPath(); x.arc((k + .5) * cw, (f + .5) * chh, Math.max(2.5, cw * .45), 0, 7); x.fill(); });
  din.mundo.sitios.forEach(s => {
    x.fillStyle = s.recolectado ? '#556' : '#' + (COLOR_MUESTRA[s.requiere] || 0xffffff).toString(16).padStart(6, '0');
    const px = (s.pos[1] + .5) * cw, py = (s.pos[0] + .5) * chh, r = Math.max(2.5, cw * .4);
    x.beginPath(); x.moveTo(px, py - r); x.lineTo(px + r, py); x.lineTo(px, py + r); x.lineTo(px - r, py); x.fill();
  });
  const [rf, rc] = din.rover.pos;
  x.fillStyle = '#fff'; x.strokeStyle = '#4fd8ff'; x.lineWidth = 2;
  x.beginPath(); x.arc((rc + .5) * cw, (rf + .5) * chh, Math.max(3.5, cw * .55), 0, 7); x.fill(); x.stroke();
}

// --------------------------------------------------------------- final
function mostrarFin(din) {
  const res = din.resultados || {};
  const exito = res.exito;
  $('#fin-icono').textContent = exito ? '🏆' : '💀';
  const t = $('#fin-titulo'); t.textContent = exito ? '¡Misión cumplida!' : 'Misión fallida'; t.className = exito ? 'exito' : 'fracaso';
  $('#fin-motivo').textContent = din.motivo_fin;
  const met = [
    ['Ciencia', `${fmt(res.ciencia_pct, 0)} %`], ['Muestras', res.muestras], ['Pasos', res.pasos],
    ['Batería final', `${fmt(res.bateria_final, 0)} %`], ['Distancia', `${fmt(res.distancia_m, 0)} m`], ['Colisiones', res.colisiones],
    ['Barrancos evitados', res.barrancos_evitados], ['Replanificaciones', res.replanificaciones], ['Vetos duros', res.vetos_duros],
  ];
  $('#fin-metricas').innerHTML = met.map(([k, v]) => `<div><b>${v ?? '—'}</b><span>${k}</span></div>`).join('');
  setTimeout(() => $('#modal-fin').classList.remove('oculto'), 900);
}

// --------------------------------------------------------------- toasts
function toast(ic, html, clase = '') {
  const cont = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + clase;
  t.innerHTML = `<span class="ic">${ic}</span><span>${html}</span>`;
  cont.appendChild(t);
  while (cont.children.length > 4) cont.firstChild.remove();
  setTimeout(() => { t.classList.add('sale'); setTimeout(() => t.remove(), 400); }, 4200);
}

iniciar();
