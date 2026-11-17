// ARES-X · Escena 3D (Three.js)
// Sólo DIBUJA el estado que calcula el motor Python: no toma decisiones.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const S = 2;          // unidades 3D por celda (1 celda = 5 m simulados)
const SUB = 4;        // subdivisiones de terreno por celda
const LIBRE = 0, OBST = 1, BARR = 2;
const DIRS = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];

// Paletas por planeta: suelo bajo/alto, barranco, roca, cielo cenit/horizonte, niebla
const PALETAS = {
  marte:    { bajo: 0x9c4a2a, alto: 0xd9925a, sima: 0x2a1410, roca: 0x6b3a28, cenit: 0x6b3b2a, horiz: 0xe0a77a, noche: 0x0a0812, niebla: 0.010, sol: 0xffe2c4 },
  mercurio: { bajo: 0x5f5b58, alto: 0xb3aca3, sima: 0x141312, roca: 0x46423f, cenit: 0x000000, horiz: 0x1a1a22, noche: 0x000000, niebla: 0.002, sol: 0xffffff },
  venus:    { bajo: 0x7a5426, alto: 0xc79a4f, sima: 0x2b1a08, roca: 0x5a3d1c, cenit: 0xb07a2a, horiz: 0xf0c069, noche: 0x2a1606, niebla: 0.030, sol: 0xffd28a },
  tierra:   { bajo: 0x4f6b35, alto: 0xa89a6a, sima: 0x1f1a14, roca: 0x6e6a62, cenit: 0x3d7fd6, horiz: 0xbfdcf5, noche: 0x050a1a, niebla: 0.006, sol: 0xfff4e0 },
  jupiter:  { bajo: 0xa0623a, alto: 0xf1d9b0, sima: 0x5a1e1a, roca: 0xe8d6c0, cenit: 0x3a2618, horiz: 0xe2b98a, noche: 0x120a06, niebla: 0.012, sol: 0xfff0d6, bandas: [0xf3e2c4, 0xc98a55, 0xe9cfa3, 0x9e5a33, 0xf6ead2, 0xb8764a] },
  saturno:  { bajo: 0xb59a5e, alto: 0xf2e3b5, sima: 0x5e4a2a, roca: 0xf5ecd0, cenit: 0x3a3220, horiz: 0xe8d39c, noche: 0x0e0c06, niebla: 0.012, sol: 0xfff6dc, bandas: [0xf2e6c2, 0xd9c08a, 0xeedcae, 0xc4a66c, 0xf7efd6] },
  urano:    { bajo: 0x5fb8c4, alto: 0xc9f1f3, sima: 0x1d4a55, roca: 0xe6fbfc, cenit: 0x123844, horiz: 0x9fe0e6, noche: 0x03121a, niebla: 0.012, sol: 0xe8fbff, bandas: [0xbfeef0, 0x9fdfe5, 0xb2e8eb, 0x8fd3db] },
  neptuno:  { bajo: 0x2f55c9, alto: 0x8fb0ff, sima: 0x0e1a52, roca: 0xdfe8ff, cenit: 0x07103a, horiz: 0x5b7fe8, noche: 0x02051a, niebla: 0.012, sol: 0xdfe8ff, bandas: [0x4c6fe0, 0x3557c4, 0x6a8cf0, 0x2a46a8, 0x5d7ee6] },
};

export const COLOR_MUESTRA = {
  mineral: 0xffb347, imagen: 0x4fd8ff, subsuelo: 0xb07cff, biofirma: 0x5dff9a, ambiente: 0x6fa8ff,
};

function rnd(seed) {           // pseudoaleatorio determinista por celda
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function hash2(i, j) {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Escena3D {
  constructor(contenedor, capaEtiquetas) {
    this.cont = contenedor;
    this.capa = capaEtiquetas;
    this.reloj = new THREE.Clock();
    this.capasVisibles = { plan: true, candidatas: true, ejecutada: true, creencia: false, etiquetas: true };
    this.modoCamara = 'seguir';
    this.efectos = [];
    this.etiquetas = [];
    this.temblor = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(contenedor.clientWidth, contenedor.clientHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    contenedor.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, contenedor.clientWidth / contenedor.clientHeight, 0.1, 900);
    this.camera.position.set(18, 22, 30);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 140;

    // Luces
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x443322, 0.6);
    this.scene.add(this.hemi);
    this.sol = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(2048, 2048);
    this.sol.shadow.bias = -0.0006;
    this.sol.shadow.normalBias = 0.03;
    this.scene.add(this.sol, this.sol.target);

    this._crearCielo();
    this._crearEstrellas();
    this._crearPolvo();

    // Post-proceso: brillo suave en cristales, láser y luces
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(contenedor.clientWidth, contenedor.clientHeight), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Grupos dinámicos
    this.gTerreno = new THREE.Group();
    this.gRocas = new THREE.Group();
    this.gSitios = new THREE.Group();
    this.gRefugios = new THREE.Group();
    this.gRutas = new THREE.Group();
    this.gZonas = new THREE.Group();
    this.gMarcas = new THREE.Group();
    this.scene.add(this.gTerreno, this.gRocas, this.gSitios, this.gRefugios, this.gRutas, this.gZonas, this.gMarcas);

    window.addEventListener('resize', () => this.redimensionar());
    this._animar = this._animar.bind(this);
    requestAnimationFrame(this._animar);
  }

  redimensionar() {
    const w = this.cont.clientWidth, h = this.cont.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // ------------------------------------------------------------------ cielo
  _crearCielo() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    this.cieloMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        cenit: { value: new THREE.Color(0x223355) }, horiz: { value: new THREE.Color(0x99aacc) },
        bandas: { value: 0 }, tiempo: { value: 0 },
        b0: { value: new THREE.Color() }, b1: { value: new THREE.Color() }, b2: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 cenit; uniform vec3 horiz; uniform float bandas; uniform float tiempo;
        uniform vec3 b0; uniform vec3 b1; uniform vec3 b2; varying vec3 vP;
        void main(){
          float h = clamp(vP.y*1.15+0.08, 0.0, 1.0);
          vec3 c = mix(horiz, cenit, pow(h, 0.65));
          if (bandas > 0.5) {
            float y = vP.y*22.0 + sin(vP.x*6.0 + tiempo*0.05)*0.6 + sin(vP.z*3.0)*0.4;
            float t = 0.5+0.5*sin(y);
            vec3 band = mix(mix(b0, b1, t), b2, 0.5+0.5*sin(y*0.37+1.3));
            c = mix(band, c, smoothstep(-0.05, 0.6, vP.y));
            c = mix(c, band*0.55, smoothstep(0.0, -0.6, vP.y));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.cielo = new THREE.Mesh(geo, this.cieloMat);
    this.scene.add(this.cielo);
  }

  _crearEstrellas() {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      pos.set([rr * Math.cos(th) * 380, Math.abs(u) * 380, rr * Math.sin(th) * 380], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.estrellasMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.estrellas = new THREE.Points(g, this.estrellasMat);
    this.scene.add(this.estrellas);
  }

  _crearPolvo() {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - .5) * 80, Math.random() * 18, (Math.random() - .5) * 80], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.polvoMat = new THREE.PointsMaterial({ color: 0xd9a070, size: 0.18, transparent: true, opacity: 0, depthWrite: false });
    this.polvo = new THREE.Points(g, this.polvoMat);
    this.scene.add(this.polvo);
  }

  // ---------------------------------------------------------- construcción
  construir(est) {
    this.est = est;
    this.filas = est.filas; this.cols = est.cols;
    this.sonda = est.modo === 'sonda';
    this.pal = PALETAS[est.perfil.clave] || PALETAS.marte;
    this.W = this.cols * S; this.D = this.filas * S;
    this.hEscala = this.sonda ? 0.38 : 0.5;
    this.firmaTerreno = '';
    this.firmaRocas = '';
    this.clase = null;
    this._limpiar(this.gTerreno); this._limpiar(this.gRocas); this._limpiar(this.gSitios);
    this._limpiar(this.gRefugios); this._limpiar(this.gRutas); this._limpiar(this.gZonas); this._limpiar(this.gMarcas);
    this.etiquetas.forEach(e => e.el.remove()); this.etiquetas = [];
    this.sitios3d = new Map();
    this.zonaFirma = '';

    const p = this.pal;
    this.cieloMat.uniforms.cenit.value.set(p.cenit);
    this.cieloMat.uniforms.horiz.value.set(p.horiz);
    this.cieloMat.uniforms.bandas.value = p.bandas ? 1 : 0;
    if (p.bandas) {
      this.cieloMat.uniforms.b0.value.set(p.bandas[0]);
      this.cieloMat.uniforms.b1.value.set(p.bandas[1]);
      this.cieloMat.uniforms.b2.value.set(p.bandas[2 % p.bandas.length]);
    }
    this.scene.fog = new THREE.FogExp2(p.horiz, p.niebla);
    this.polvoMat.color.set(p.alto);

    if (this.vehiculo) this.scene.remove(this.vehiculo);
    this.vehiculo = this.sonda ? this._crearSonda() : this._crearRover();
    this.scene.add(this.vehiculo);
    this.vehiculoPos = null;
    this.ruedaGiro = 0;

    // Sombras ajustadas al tamaño del mapa
    const ext = Math.max(this.W, this.D) * 0.75;
    Object.assign(this.sol.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 260 });
    this.sol.shadow.camera.updateProjectionMatrix();

    this._crearRefugios(est.refugios);
    // Cámara inicial
    const c = this.celda(est.inicio[0], est.inicio[1]);
    this.controls.target.set(c.x, 0, c.z);
    this.camera.position.set(c.x + 12, 16, c.z + 18);
  }

  _limpiar(g) {
    while (g.children.length) {
      const o = g.children[g.children.length - 1];
      g.remove(o);
      o.traverse?.(n => { n.geometry?.dispose?.(); if (n.material && !n.material._compartido) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
    }
  }

  celda(f, c) { return { x: (c + 0.5 - this.cols / 2) * S, z: (f + 0.5 - this.filas / 2) * S }; }

  // Altura del terreno (interpolación bilineal sobre la malla)
  alturaEn(x, z) {
    if (!this.H) return 0;
    const nx = this.cols * SUB + 1, nz = this.filas * SUB + 1;
    const j = clamp((x + this.W / 2) / (S / SUB), 0, nx - 1.001);
    const i = clamp((z + this.D / 2) / (S / SUB), 0, nz - 1.001);
    const j0 = Math.floor(j), i0 = Math.floor(i), tj = j - j0, ti = i - i0;
    const H = this.H;
    const a = H[i0 * nx + j0], b = H[i0 * nx + j0 + 1], c = H[(i0 + 1) * nx + j0], d = H[(i0 + 1) * nx + j0 + 1];
    return lerp(lerp(a, b, tj), lerp(c, d, tj), ti);
  }

  _construirTerreno(elev, clase) {
    this._limpiar(this.gTerreno);
    const R = this.filas, C = this.cols, nx = C * SUB + 1, nz = R * SUB + 1;
    const k = this.hEscala, sonda = this.sonda;
    const eAdj = (f, c) => {
      f = clamp(f, 0, R - 1); c = clamp(c, 0, C - 1);
      const e = elev[f][c] ?? 0;
      if (sonda) return -e;
      return clase[f * C + c] === '2' ? e - 3 : e;
    };
    const H = new Float32Array(nx * nz);
    const esSima = new Uint8Array(nx * nz);
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const u = j / SUB - 0.5, v = i / SUB - 0.5;
      const c0 = Math.floor(u), f0 = Math.floor(v), tu = u - c0, tv = v - f0;
      let h = lerp(lerp(eAdj(f0, c0), eAdj(f0, c0 + 1), tu), lerp(eAdj(f0 + 1, c0), eAdj(f0 + 1, c0 + 1), tu), tv);
      const fc = Math.min(R - 1, Math.floor(i / SUB)), cc = Math.min(C - 1, Math.floor(j / SUB));
      const interior = (i % SUB !== 0) && (j % SUB !== 0);
      if (!sonda && interior && clase[fc * C + cc] === '2') { h = Math.min(h, eAdj(fc, cc) - 1.5); esSima[i * nx + j] = 1; }
      h += (hash2(i, j) - 0.5) * (sonda ? 0.5 : 0.35);       // micro relieve
      H[i * nx + j] = h * k;
    }
    this.H = H;

    // Geometría (malla propia para controlar UV y color por vértice)
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
    let hmin = Infinity, hmax = -Infinity;
    for (let n = 0; n < H.length; n++) { hmin = Math.min(hmin, H[n]); hmax = Math.max(hmax, H[n]); }
    this.hmin = hmin; this.hmax = hmax;
    const p = this.pal, cb = new THREE.Color(p.bajo), ca = new THREE.Color(p.alto), cs = new THREE.Color(p.sima), tmp = new THREE.Color();
    const bandas = p.bandas ? p.bandas.map(b => new THREE.Color(b)) : null;
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const n = i * nx + j;
      pos.set([j * S / SUB - this.W / 2, H[n], i * S / SUB - this.D / 2], n * 3);
      uv.set([j / (nx - 1), i / (nz - 1)], n * 2);
      const t = (H[n] - hmin) / Math.max(1e-6, hmax - hmin);
      if (bandas) {
        const fr = (i / SUB) * 0.9 + Math.sin(j * 0.15) * 0.8;
        tmp.copy(bandas[Math.abs(Math.floor(fr)) % bandas.length]).lerp(bandas[Math.abs(Math.floor(fr) + 1) % bandas.length], fr - Math.floor(fr));
      } else tmp.copy(cb).lerp(ca, Math.pow(t, 0.9));
      tmp.multiplyScalar(0.86 + hash2(j * 3.1, i * 1.7) * 0.28);
      if (esSima[n]) tmp.copy(cs);
      col.set([tmp.r, tmp.g, tmp.b], n * 3);
    }
    const idx = [];
    for (let i = 0; i < nz - 1; i++) for (let j = 0; j < nx - 1; j++) {
      const a = i * nx + j, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: sonda ? 0.7 : 0.95, metalness: 0, flatShading: !sonda,
      transparent: sonda, opacity: sonda ? 0.93 : 1 });
    const malla = new THREE.Mesh(g, mat);
    malla.receiveShadow = true;
    this.gTerreno.add(malla);
    this.mallaTerreno = malla;

    // Faldón tipo diorama
    const base = hmin - (sonda ? 3 : 4);
    const falda = [], ff = [];
    const bordes = [];
    for (let j = 0; j < nx; j++) bordes.push([0, j]);
    for (let i = 1; i < nz; i++) bordes.push([i, nx - 1]);
    for (let j = nx - 2; j >= 0; j--) bordes.push([nz - 1, j]);
    for (let i = nz - 2; i >= 0; i--) bordes.push([i, 0]);
    bordes.forEach(([i, j], q) => {
      const x = j * S / SUB - this.W / 2, z = i * S / SUB - this.D / 2;
      falda.push(x, H[i * nx + j], z, x, base, z);
      if (q > 0) { const a = (q - 1) * 2, b = q * 2; ff.push(a, a + 1, b, b, a + 1, b + 1); }
    });
    const gf = new THREE.BufferGeometry();
    gf.setAttribute('position', new THREE.Float32BufferAttribute(falda, 3));
    gf.setIndex(ff); gf.computeVertexNormals();
    const cFalda = new THREE.Color(sonda ? p.sima : p.roca).multiplyScalar(0.7);
    this.gTerreno.add(new THREE.Mesh(gf, new THREE.MeshStandardMaterial({ color: cFalda, roughness: 1, side: THREE.DoubleSide, flatShading: true,
      transparent: sonda, opacity: sonda ? 0.5 : 1 })));
    const tapa = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.D), new THREE.MeshStandardMaterial({ color: cFalda.clone().multiplyScalar(0.6), transparent: sonda, opacity: sonda ? 0.3 : 1 }));
    tapa.rotation.x = Math.PI / 2; tapa.position.y = base;
    this.gTerreno.add(tapa);

    // Capa de creencia (lo que el rover CREE): textura por celda sobre el terreno
    this.creenciaCanvas = document.createElement('canvas');
    this.creenciaCanvas.width = C * 8; this.creenciaCanvas.height = R * 8;
    this.creenciaTex = new THREE.CanvasTexture(this.creenciaCanvas);
    this.creenciaTex.magFilter = THREE.NearestFilter;
    this.creenciaTex.flipY = false;
    this.creenciaTex.colorSpace = THREE.SRGBColorSpace;
    const mc = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.creenciaTex, transparent: true, opacity: 0.72, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false }));
    mc.visible = this.capasVisibles.creencia;
    mc.renderOrder = 2;
    this.mallaCreencia = mc;
    this.gTerreno.add(mc);

    // Reubicar elementos que dependen de la altura
    this.gRefugios.children.forEach(o => { if (o.userData.celda) { const q = this.celda(...o.userData.celda); o.position.y = this.alturaEn(q.x, q.z); } });
  }

  // ---------------------------------------------------------------- rocas
  _construirObstaculos(clase) {
    this._limpiar(this.gRocas);
    const C = this.cols, R = this.filas;
    if (this.sonda) {
      // Turbulencia severa (obstáculo) y corriente descendente crítica (barranco)
      const matT = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 1, transparent: true, opacity: 0.82, flatShading: true });
      const matT2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.pal.roca).multiplyScalar(0.8), roughness: 1, transparent: true, opacity: 0.75, flatShading: true });
      const geoP = new THREE.IcosahedronGeometry(0.55, 1);
      for (let f = 0; f < R; f++) for (let c = 0; c < C; c++) {
        const k = clase[f * C + c];
        if (k === '0') continue;
        const q = this.celda(f, c), y = this.alturaEn(q.x, q.z), r = rnd(f * 131 + c * 7 + 3);
        if (k === '1') {
          const grupo = new THREE.Group();
          for (let n = 0; n < 4; n++) {
            const m = new THREE.Mesh(geoP, n % 2 ? matT : matT2);
            m.position.set((r() - .5) * 1.2, 0.9 + r() * 1.2, (r() - .5) * 1.2);
            m.scale.setScalar(0.7 + r() * 0.9);
            grupo.add(m);
          }
          grupo.position.set(q.x, y, q.z);
          grupo.userData.giro = 0.2 + r() * 0.5;
          this.gRocas.add(grupo);
        } else {
          const vort = this._vortice();
          vort.position.set(q.x, y + 0.2, q.z);
          this.gRocas.add(vort);
        }
      }
      return;
    }
    const matRoca = new THREE.MeshStandardMaterial({ color: this.pal.roca, roughness: 0.95, flatShading: true });
    const geos = [0, 1, 2].map(s => {
      const gg = (s === 1 ? new THREE.DodecahedronGeometry(0.5, 0) : new THREE.IcosahedronGeometry(0.5, s === 2 ? 1 : 0));
      const pa = gg.attributes.position, r = rnd(s + 11);
      const mapa = new Map();
      for (let i = 0; i < pa.count; i++) {
        const key = `${pa.getX(i).toFixed(3)},${pa.getY(i).toFixed(3)},${pa.getZ(i).toFixed(3)}`;
        if (!mapa.has(key)) mapa.set(key, 0.78 + r() * 0.45);
        const m = mapa.get(key);
        pa.setXYZ(i, pa.getX(i) * m, pa.getY(i) * m * 0.8, pa.getZ(i) * m);
      }
      gg.computeVertexNormals();
      return gg;
    });
    let n = 0; for (const ch of clase) if (ch === '1') n++;
    const insts = geos.map(gg => { const im = new THREE.InstancedMesh(gg, matRoca, n * 2 + 1); im.count = 0; im.castShadow = true; im.receiveShadow = true; return im; });
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    for (let f = 0; f < R; f++) for (let c = 0; c < C; c++) {
      if (clase[f * C + c] !== '1') continue;
      const q = this.celda(f, c), r = rnd(f * 97 + c * 13 + 1);
      const piezas = 1 + Math.floor(r() * 2);
      for (let k = 0; k < piezas; k++) {
        const big = k === 0;
        const x = q.x + (big ? (r() - .5) * 0.4 : (r() - .5) * 1.4), z = q.z + (big ? (r() - .5) * 0.4 : (r() - .5) * 1.4);
        const s = big ? 1.5 + r() * 0.9 : 0.6 + r() * 0.5;
        e.set(r() * 3, r() * 6, r() * 3); qt.setFromEuler(e); sc.set(s, s * (0.8 + r() * 0.6), s); ps.set(x, this.alturaEn(x, z) + s * 0.25, z);
        m4.compose(ps, qt, sc);
        const im = insts[Math.floor(r() * 3)];
        im.setMatrixAt(im.count++, m4);
      }
    }
    insts.forEach(im => { im.instanceMatrix.needsUpdate = true; this.gRocas.add(im); });
    // Borde de barrancos: cintas de advertencia muy sutiles (rocas pequeñas oscuras)
  }

  _vortice() {
    const g = new THREE.Group();
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d');
    const grd = cx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(20,0,30,1)'); grd.addColorStop(0.5, 'rgba(160,40,120,0.75)'); grd.addColorStop(1, 'rgba(255,120,120,0)');
    cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
    cx.strokeStyle = 'rgba(255,200,230,0.6)'; cx.lineWidth = 3;
    for (let a = 0; a < 3; a++) { cx.beginPath(); for (let t = 0; t < 1; t += 0.01) { const r = t * 60, th = t * 9 + a * 2.1; cx.lineTo(64 + r * Math.cos(th), 64 + r * Math.sin(th)); } cx.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const disco = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    disco.rotation.x = -Math.PI / 2;
    const cono = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4da6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    cono.rotation.x = Math.PI; cono.position.y = -1.1;
    g.add(disco, cono);
    g.userData.vortice = disco;
    return g;
  }

  // ---------------------------------------------------------------- refugios
  _crearRefugios(refugios) {
    refugios.forEach(([f, c]) => {
      const g = new THREE.Group();
      const q = this.celda(f, c);
      if (this.sonda) {
        // Estación de enlace aerostática
        const anillo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 10, 32), new THREE.MeshStandardMaterial({ color: 0xdfe7ee, metalness: 0.6, roughness: 0.35 }));
        anillo.rotation.x = Math.PI / 2; anillo.position.y = 1.5;
        const nucleo = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 12), new THREE.MeshStandardMaterial({ color: 0x55ffb0, emissive: 0x22ff99, emissiveIntensity: 1.6 }));
        nucleo.position.y = 1.5;
        g.add(anillo, nucleo); g.userData.pulso = nucleo;
      } else {
        const plataforma = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.18, 24), new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.5, roughness: 0.5 }));
        plataforma.position.y = 0.09; plataforma.receiveShadow = true; plataforma.castShadow = true;
        const domo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f5f7, metalness: 0.2, roughness: 0.35 }));
        domo.position.y = 0.18; domo.castShadow = true;
        const aro = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.04, 8, 40), new THREE.MeshStandardMaterial({ color: 0x33ffaa, emissive: 0x22ff99, emissiveIntensity: 1.8 }));
        aro.rotation.x = Math.PI / 2; aro.position.y = 0.19;
        const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4), new THREE.MeshStandardMaterial({ color: 0xcfd6dc, metalness: 0.7 }));
        mastil.position.set(0.55, 0.85, 0.3);
        const luz = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x55ffb0, emissive: 0x22ff99, emissiveIntensity: 3 }));
        luz.position.set(0.55, 1.58, 0.3);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.45), new THREE.MeshStandardMaterial({ color: 0x1b2f6b, metalness: 0.8, roughness: 0.25 }));
        panel.position.set(-0.6, 0.5, -0.55); panel.rotation.z = 0.5;
        g.add(plataforma, domo, aro, mastil, luz, panel);
        g.userData.pulso = aro;
      }
      g.position.set(q.x, 0, q.z);
      g.userData.celda = [f, c];
      this.gRefugios.add(g);
      this._etiqueta(g, this.sonda ? 'Estación de enlace' : 'Refugio · recarga', 'et-refugio', 2.2);
    });
  }

  // --------------------------------------------------------- sitios ciencia
  _actualizarSitios(sitios) {
    sitios.forEach(s => {
      let o = this.sitios3d.get(s.id);
      const q = this.celda(s.pos[0], s.pos[1]);
      const y = this.alturaEn(q.x, q.z);
      if (!o) {
        const color = COLOR_MUESTRA[s.requiere] || 0xffffff;
        const g = new THREE.Group();
        const cristal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32 + s.valor * 0.18, 0),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.1, flatShading: true }));
        cristal.position.y = 1.0;
        cristal.castShadow = true;
        const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 6, 16, 1, true),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        haz.position.y = 3;
        const base = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
        base.rotation.x = -Math.PI / 2; base.position.y = 0.08;
        g.add(cristal, haz, base);
        if (s.prioritario) {
          const corona = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb300, emissiveIntensity: 2 }));
          corona.position.y = 1.0;
          g.add(corona); g.userData.corona = corona;
        }
        g.userData = { ...g.userData, cristal, haz, base, fase: s.id * 1.7, recolectado: false };
        this.gSitios.add(g);
        o = g; this.sitios3d.set(s.id, g);
        o.userData.et = this._etiqueta(g, `${s.prioritario ? '★ ' : ''}${s.requiere} · ${s.valor.toFixed(2)}`, 'et-sitio', 2.0);
      }
      o.position.set(q.x, y, q.z);
      if (s.recolectado && !o.userData.recolectado) {
        o.userData.recolectado = true;
        o.userData.cristal.material.emissiveIntensity = 0.15;
        o.userData.cristal.material.color.set(0x777777);
        o.userData.haz.visible = false;
        o.userData.base.material.color.set(0x44ff99);
        o.userData.et.el.classList.add('hecho');
        o.userData.et.el.textContent = `✔ ${s.requiere} recolectada`;
        // Banderín
        const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
        asta.position.set(0.35, 0.45, 0);
        const bandera = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.22), new THREE.MeshStandardMaterial({ color: 0x3ad17a, emissive: 0x1a8a4a, side: THREE.DoubleSide }));
        bandera.position.set(0.53, 0.78, 0);
        o.add(asta, bandera);
      }
    });
  }

  // ---------------------------------------------------------------- vehículos
  _crearRover() {
    const g = new THREE.Group();
    const blanco = new THREE.MeshStandardMaterial({ color: 0xe9edf0, metalness: 0.35, roughness: 0.45 });
    const oro = new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 });
    const gris = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.6, roughness: 0.5 });
    const negro = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
    const panelM = new THREE.MeshStandardMaterial({ color: 0x1d3a8a, metalness: 0.85, roughness: 0.2, emissive: 0x0a1640, emissiveIntensity: 0.4 });

    const cuerpo = new THREE.Group(); g.add(cuerpo); this.cuerpo = cuerpo;
    const chasis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.72), blanco); chasis.position.y = 0.62;
    const lamina = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.06, 0.74), oro); lamina.position.y = 0.45;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.04, 0.95), panelM); panel.position.set(-0.05, 0.81, 0);
    // rejilla del panel
    for (let i = -2; i <= 2; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.045, 0.93), gris); l.position.set(i * 0.25 - 0.05, 0.815, 0); cuerpo.add(l); }
    const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 12), gris); rtg.rotation.z = Math.PI / 2.6; rtg.position.set(-0.68, 0.72, 0);
    const rtgLuz = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.44, 12), new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a00, emissiveIntensity: 1.2 }));
    rtgLuz.rotation.z = Math.PI / 2.6; rtgLuz.position.set(-0.68, 0.72, 0);
    cuerpo.add(chasis, lamina, panel, rtg, rtgLuz);

    // Mástil con cabeza de cámaras (y emisor láser de muestreo)
    const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.72), blanco); mastil.position.set(0.36, 1.18, 0.2);
    const cabeza = new THREE.Group(); cabeza.position.set(0.36, 1.58, 0.2);
    const caja = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.34), blanco);
    const ojoMat = new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x33ccff, emissiveIntensity: 2.2 });
    const ojo1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), ojoMat); ojo1.rotation.z = Math.PI / 2; ojo1.position.set(0.11, 0, 0.08);
    const ojo2 = ojo1.clone(); ojo2.position.z = -0.08;
    const laserTubo = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff1133, emissiveIntensity: 1 }));
    laserTubo.rotation.z = Math.PI / 2; laserTubo.position.set(0.12, 0.08, 0);
    cabeza.add(caja, ojo1, ojo2, laserTubo);
    this.cabeza = cabeza; this.ojoMat = ojoMat;
    // Antena de alta ganancia
    const plato = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }));
    plato.position.set(-0.25, 1.0, -0.28); plato.rotation.set(-0.6, 0, 0.5);
    this.antena = plato;
    // Brazo robótico
    const brazo = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.05), gris); brazo.position.set(0.68, 0.55, -0.2); brazo.rotation.z = -0.4;
    cuerpo.add(mastil, cabeza, plato, brazo);

    // Luces delanteras (de noche)
    this.faro = new THREE.SpotLight(0xdff4ff, 0, 18, 0.55, 0.5, 1.2);
    this.faro.position.set(0.6, 0.7, 0); this.faro.target.position.set(4, -0.6, 0);
    cuerpo.add(this.faro, this.faro.target);
    const faroMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff4ff, emissiveIntensity: 0.2 });
    this.faroMat = faroMat;
    [-0.22, 0.22].forEach(z => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), faroMat); f.position.set(0.56, 0.62, z); cuerpo.add(f); });

    // Suspensión rocker-bogie + 6 ruedas
    this.ruedas = [];
    const geoR = new THREE.CylinderGeometry(0.19, 0.19, 0.16, 20);
    const geoBanda = new THREE.TorusGeometry(0.19, 0.025, 6, 20);
    [-1, 1].forEach(lado => {
      const brazoS = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.05), gris); brazoS.position.set(0, 0.36, lado * 0.47); cuerpo.add(brazoS);
      [-0.52, 0, 0.52].forEach(x => {
        const rueda = new THREE.Group();
        const llanta = new THREE.Mesh(geoR, negro); llanta.rotation.x = Math.PI / 2;
        const banda = new THREE.Mesh(geoBanda, gris);
        const cubo = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 10), blanco); cubo.rotation.x = Math.PI / 2;
        rueda.add(llanta, banda, cubo);
        rueda.position.set(x, 0.19, lado * 0.52);
        rueda.traverse(n => { if (n.isMesh) n.castShadow = true; });
        g.add(rueda); this.ruedas.push(rueda);
        const pata = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), gris); pata.position.set(x, 0.28, lado * 0.49); cuerpo.add(pata);
      });
    });
    g.traverse(n => { if (n.isMesh) n.castShadow = true; });
    g.scale.setScalar(1.15);
    // Anillo de selección en el suelo
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.08, 40), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2; sel.position.y = 0.05; g.add(sel); this.anilloSel = sel;
    return g;
  }

  _crearSonda() {
    const g = new THREE.Group();
    const cuerpo = new THREE.Group(); g.add(cuerpo); this.cuerpo = cuerpo;
    const env = new THREE.Mesh(new THREE.SphereGeometry(0.85, 28, 18), new THREE.MeshStandardMaterial({ color: 0xf5f7fa, metalness: 0.3, roughness: 0.25, emissive: 0x223344, emissiveIntensity: 0.3 }));
    env.scale.set(1.35, 1, 1); env.position.y = 2.1;
    const banda = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.05, 8, 40), new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 }));
    banda.scale.set(1.35, 1, 1); banda.rotation.x = Math.PI / 2; banda.position.y = 2.1;
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.42), new THREE.MeshStandardMaterial({ color: 0xe0e4e8, metalness: 0.4, roughness: 0.4 }));
    gondola.position.y = 0.85;
    const oroL = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.44), new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 }));
    oroL.position.y = 0.7;
    cuerpo.add(env, banda, gondola, oroL);
    const cable = new THREE.MeshStandardMaterial({ color: 0x9aa0a6 });
    [[0.25, 0.18], [-0.25, 0.18], [0.25, -0.18], [-0.25, -0.18]].forEach(([x, z]) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.65), cable); c.position.set(x * 1.2, 1.3, z * 1.2); c.rotation.z = -x * 0.5; c.rotation.x = z * 0.5; cuerpo.add(c);
    });
    this.helices = [];
    [-1, 1].forEach(l => {
      const h = new THREE.Group();
      const brazo = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), cable); brazo.position.z = l * 0.2;
      const aspa = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.04), new THREE.MeshStandardMaterial({ color: 0x333 }));
      const rotor = new THREE.Group(); rotor.add(aspa); rotor.position.set(-0.33, 0, l * 0.36);
      h.add(brazo, rotor); h.position.y = 0.85; cuerpo.add(h); this.helices.push(rotor);
    });
    const baliza = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff1133, emissiveIntensity: 3 }));
    baliza.position.y = 0.62; cuerpo.add(baliza); this.baliza = baliza;
    const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x33ccff, emissiveIntensity: 2 }));
    sensor.position.set(0.3, 0.75, 0); sensor.rotation.z = Math.PI / 2; cuerpo.add(sensor);
    this.cabeza = sensor; this.ruedas = [];
    this.faro = new THREE.PointLight(0xdff4ff, 0, 10); this.faro.position.y = 0.6; cuerpo.add(this.faro);
    g.traverse(n => { if (n.isMesh) n.castShadow = true; });
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.08, 40), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2; sel.position.y = -1.2; cuerpo.add(sel); this.anilloSel = sel;
    return g;
  }

  // ------------------------------------------------------------- etiquetas
  _etiqueta(obj, texto, clase, alto = 1.5) {
    const el = document.createElement('div');
    el.className = 'etiqueta ' + clase;
    el.textContent = texto;
    this.capa.appendChild(el);
    const e = { el, obj, alto, temporal: false };
    this.etiquetas.push(e);
    return e;
  }

  textoFlotante(pos, texto, clase = 'flot-ok', dur = 2.2) {
    const el = document.createElement('div');
    el.className = 'flotante ' + clase;
    el.textContent = texto;
    this.capa.appendChild(el);
    const e = { el, pos: pos.clone(), alto: 0, temporal: true, t0: this.reloj.elapsedTime, dur };
    this.etiquetas.push(e);
  }

  // ------------------------------------------------------- actualización
  actualizar(din, duracionMs = 500) {
    if (!this.est) return;
    const mundo = din.mundo;
    const firmaT = mundo.clase + '|' + mundo.elev.map(f => f.join(',')).join(';');
    if (firmaT !== this.firmaTerreno) {
      this._construirTerreno(mundo.elev, mundo.clase);
      this.firmaTerreno = firmaT;
      this._construirObstaculos(mundo.clase);
      this.sitios3d.forEach(o => { o.position.y = this.alturaEn(o.position.x, o.position.z); });
    }
    this.clase = mundo.clase;
    this._actualizarSitios(mundo.sitios);
    this._actualizarZonas(mundo);
    this._actualizarRutas(din);
    this._actualizarCreencia(din.creencia);
    this._actualizarAmbiente(mundo);
    this._moverVehiculo(din, duracionMs);
    this._efectosDePaso(din);
  }

  _p(f, c, dy = 0) { const q = this.celda(f, c); return new THREE.Vector3(q.x, this.alturaEn(q.x, q.z) + dy, q.z); }

  _tubo(celdas, color, radio, opacidad = 1, dy = 0.35) {
    if (!celdas || celdas.length < 2) return null;
    const pts = celdas.map(([f, c]) => this._p(f, c, this.sonda ? 1.2 : dy));
    const curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curva, Math.max(8, pts.length * 8), radio, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacidad < 1, opacity: opacidad, depthWrite: opacidad >= 1 });
    return new THREE.Mesh(geo, mat);
  }

  _actualizarRutas(din) {
    this._limpiar(this.gRutas);
    const cv = this.capasVisibles;
    if (cv.candidatas && din.ag && din.ag.candidatas) {
      const colores = [0xffa94d, 0xc77dff, 0xff6b9a];
      din.ag.candidatas.forEach((cand, i) => {
        if (cand.elegida) return;
        const t = this._tubo(cand.camino, colores[i % 3], 0.045, 0.45, 0.25);
        if (t) this.gRutas.add(t);
      });
    }
    if (cv.ejecutada) {
      const t = this._tubo(din.ruta_ejecutada, 0x3d8bff, 0.075, 0.95, 0.18);
      if (t) this.gRutas.add(t);
    }
    if (cv.plan) {
      const resto = din.ruta_planificada.slice(Math.max(0, din.indice_ruta - 1));
      const t = this._tubo(resto, 0x3dff8b, 0.07, 0.9, 0.45);
      if (t) this.gRutas.add(t);
      if (resto.length > 1) {
        const [f, c] = resto[resto.length - 1];
        const meta = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0x3dff8b }));
        meta.rotation.x = Math.PI / 2; meta.position.copy(this._p(f, c, 0.3)); meta.userData.pulso = true;
        this.gRutas.add(meta);
      }
    }
    // Destino inmediato y vetos
    const d = din.decision;
    if (d && d.destino) {
      const veto = d.motivo && d.motivo.startsWith('VETO');
      const color = veto ? 0xff3b3b : 0x4fd8ff;
      const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 4, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4;
      m.position.copy(this._p(d.destino[0], d.destino[1], 0.12)); m.userData.pulso = true;
      this.gRutas.add(m);
      if (veto) {
        const x = new THREE.Group();
        [1, -1].forEach(s => { const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.18), new THREE.MeshBasicMaterial({ color: 0xff3b3b })); b.rotation.y = s * Math.PI / 4; x.add(b); });
        x.position.copy(this._p(d.destino[0], d.destino[1], 1.4)); x.userData.flota = true;
        this.gRutas.add(x);
      }
    }
  }

  _actualizarCreencia(cr) {
    if (!this.creenciaCanvas) return;
    const C = this.cols, R = this.filas, cx = this.creenciaCanvas.getContext('2d');
    cx.clearRect(0, 0, C * 8, R * 8);
    for (let f = 0; f < R; f++) for (let c = 0; c < C; c++) {
      const i = f * C + c, r = cr.riesgo[f][c] ?? 1;
      const exp = cr.explorado[i] === '1', pro = cr.prohibido[i] === '1', con = cr.confirmado[i] === '1';
      let col;
      if (pro) col = 'rgba(255,40,90,0.95)';
      else if (!exp) col = 'rgba(40,46,60,0.65)';
      else {
        const h = (1 - clamp(r, 0, 1)) * 120;
        col = `hsla(${h},90%,${con ? 50 : 58}%,${con ? 0.9 : 0.75})`;
      }
      cx.fillStyle = col;
      cx.fillRect(c * 8, f * 8, 8, 8);
      cx.fillStyle = 'rgba(0,0,0,0.35)';
      cx.fillRect(c * 8, f * 8, 8, 1); cx.fillRect(c * 8, f * 8, 1, 8);
      if (pro) { cx.strokeStyle = '#fff'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(c * 8 + 2, f * 8 + 2); cx.lineTo(c * 8 + 6, f * 8 + 6); cx.moveTo(c * 8 + 6, f * 8 + 2); cx.lineTo(c * 8 + 2, f * 8 + 6); cx.stroke(); }
    }
    this.creenciaTex.needsUpdate = true;
  }

  _actualizarZonas(mundo) {
    const firma = JSON.stringify([mundo.zonas, mundo.anomalia_bio, mundo.alienigena]);
    if (firma === this.zonaFirma) return;
    this.zonaFirma = firma;
    this._limpiar(this.gZonas);
    this.etiquetas.filter(e => e.zona).forEach(e => e.el.remove());
    this.etiquetas = this.etiquetas.filter(e => !e.zona);
    mundo.zonas.forEach(z => {
      const p = this._p(z.centro[0], z.centro[1]);
      const rad = (z.radio + 0.5) * S;
      const g = new THREE.Group();
      const cil = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 5, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4d2e, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      cil.position.y = 2.5;
      const aro = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff5a36 }));
      aro.rotation.x = Math.PI / 2; aro.position.y = 0.3;
      g.add(cil, aro); g.position.copy(p); g.userData.pulso = aro;
      if (z.tipo === 'meteorito' && !this.sonda) {
        const crater = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.35, 8, 24), new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 1, flatShading: true }));
        crater.rotation.x = Math.PI / 2; crater.position.y = 0.05; crater.scale.z = 0.4; g.add(crater);
        const brasa = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: 0xff6a00 }));
        brasa.rotation.x = -Math.PI / 2; brasa.position.y = 0.08; g.add(brasa);
      }
      this.gZonas.add(g);
      const et = this._etiqueta(g, z.tipo === 'contacto_ficticio' ? 'Zona de contacto (ficticio)' : 'Zona de riesgo · impacto', 'et-riesgo', 3.2);
      et.zona = true;
    });
    if (mundo.anomalia_bio) {
      const g = new THREE.Group();
      const esf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshStandardMaterial({ color: 0x5dff9a, emissive: 0x2dff7a, emissiveIntensity: 2.2, flatShading: true }));
      esf.position.y = 1.2;
      const onda = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0x5dff9a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      onda.rotation.x = -Math.PI / 2; onda.position.y = 0.1; onda.userData.onda = true;
      g.add(esf, onda); g.position.copy(this._p(...mundo.anomalia_bio)); g.userData.giro = 1;
      this.gZonas.add(g);
      const et = this._etiqueta(g, 'Señal anómala · NO confirma vida', 'et-bio', 2.2); et.zona = true;
    }
    if (mundo.alienigena) {
      const g = new THREE.Group();
      const disco = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 10), new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.9, roughness: 0.2 }));
      disco.scale.set(1, 0.28, 1);
      const cupula = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9effff, emissive: 0x33ffee, emissiveIntensity: 1.5, transparent: true, opacity: 0.85 }));
      cupula.position.y = 0.15;
      const luces = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 30), new THREE.MeshStandardMaterial({ color: 0xff66ff, emissive: 0xff33ff, emissiveIntensity: 2.5 }));
      luces.rotation.x = Math.PI / 2;
      const haz = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9effff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      haz.position.y = -1.5;
      const nave = new THREE.Group(); nave.add(disco, cupula, luces, haz); nave.position.y = 3.2; nave.userData.ovni = true;
      g.add(nave); g.position.copy(this._p(...mundo.alienigena)); g.userData.giro = 0.8;
      this.gZonas.add(g);
      const et = this._etiqueta(g, 'Contacto FICTICIO · narrativa', 'et-alien', 4.6); et.zona = true;
    }
  }

  _actualizarAmbiente(m) {
    this.ambiente = m;
    const p = this.pal;
    const hora = m.hora;
    const ang = ((hora - 6) / 12) * Math.PI;          // 0 amanecer, PI ocaso
    const elev = Math.sin(ang);
    const dia = clamp(elev * 1.6 + 0.15, 0, 1) * (m.noche ? 0.0 : 1);
    this.objetivoAmb = { dia, elev, ang, tormenta: m.tormenta || 0, vis: m.visibilidad ?? 1, viento: m.viento || 0 };
  }

  _aplicarAmbiente(dt) {
    if (!this.objetivoAmb || !this.pal) return;
    const o = this.objetivoAmb, p = this.pal;
    this.amb = this.amb || { dia: o.dia, tormenta: o.tormenta };
    this.amb.dia = lerp(this.amb.dia, o.dia, Math.min(1, dt * 1.5));
    this.amb.tormenta = lerp(this.amb.tormenta, o.tormenta, Math.min(1, dt * 1.5));
    const dia = this.amb.dia, torm = this.amb.tormenta;
    const centro = this.controls.target;
    const r = 70, a = o.ang;
    const sy = Math.max(0.15, Math.sin(a)) * r;
    this.sol.position.set(centro.x + Math.cos(a) * r, sy + 10, centro.z + 30);
    this.sol.target.position.copy(centro);
    this.sol.intensity = lerp(0.18, 2.4, dia) * (1 - 0.6 * torm);
    this.sol.color.set(p.sol).lerp(new THREE.Color(0x8fa6ff), 1 - dia);
    this.hemi.intensity = lerp(0.18, 0.75, dia);
    const cielo = new THREE.Color(p.cenit).lerp(new THREE.Color(p.noche), 1 - dia);
    const horiz = new THREE.Color(p.horiz).lerp(new THREE.Color(p.noche).lerp(new THREE.Color(p.horiz), 0.15), 1 - dia);
    if (torm > 0.05) { const polvo = new THREE.Color(p.alto).multiplyScalar(0.8); horiz.lerp(polvo, torm * 0.8); cielo.lerp(polvo, torm * 0.6); }
    this.cieloMat.uniforms.cenit.value.copy(cielo);
    this.cieloMat.uniforms.horiz.value.copy(horiz);
    this.hemi.color.copy(horiz).lerp(new THREE.Color(0xffffff), 0.4);
    if (this.scene.fog) {
      this.scene.fog.color.copy(horiz);
      this.scene.fog.density = p.niebla + torm * 0.035 + (1 - (o.vis ?? 1)) * 0.01;
    }
    const estrellasBase = this.pal === PALETAS.mercurio ? 0.9 : 0;
    this.estrellasMat.opacity = Math.max(estrellasBase, (1 - dia) * 0.95) * (1 - torm);
    this.polvoMat.opacity = Math.min(0.85, torm * 0.9 + (o.viento > 0.4 ? 0.25 : 0));
    const noche = dia < 0.3;
    if (this.faro) this.faro.intensity = noche ? (this.sonda ? 6 : 40) : 0;
    if (this.faroMat) this.faroMat.emissiveIntensity = noche ? 3 : 0.2;
    this.renderer.toneMappingExposure = lerp(1.25, 1.05, dia);
  }

  _moverVehiculo(din, dur) {
    const r = din.rover;
    let destinoVis = this._p(r.pos[0], r.pos[1]);
    const d = din.decision;
    if (d && (d.accion === 'AVANZAR' || d.accion === 'VOLVER') && d.destino && r.progreso > 0.01 &&
        (d.destino[0] !== r.pos[0] || d.destino[1] !== r.pos[1])) {
      const q = this._p(d.destino[0], d.destino[1]);
      destinoVis.lerp(q, clamp(r.progreso, 0, 0.95));
    }
    const yaw = (() => {
      const [df, dc] = DIRS[r.rumbo] || [0, 1];
      if (d && d.destino && (d.destino[0] !== r.pos[0] || d.destino[1] !== r.pos[1])) {
        return Math.atan2(-(d.destino[0] - r.pos[0]), d.destino[1] - r.pos[1]);
      }
      return Math.atan2(-df, dc);
    })();
    const desde = this.vehiculoPos ? this.vehiculoPos.clone() : destinoVis.clone();
    // Si el salto es grande (deslizamiento, rebote) la animación lo hace visible
    this.tween = { desde, hasta: destinoVis, t0: this.reloj.elapsedTime, dur: Math.max(0.12, dur / 1000), yaw0: this.yawActual ?? yaw, yaw1: yaw };
    if (!this.vehiculoPos) {
      this.vehiculoPos = destinoVis.clone(); this.yawActual = yaw;
      if (this.modoCamara === 'seguir') this.setModoCamara('seguir');
    }
    this.estadoRover = r;
  }

  _efectosDePaso(din) {
    const d = din.decision;
    const pos = this.vehiculoPos || this._p(din.rover.pos[0], din.rover.pos[1]);
    if (d && d.accion === 'MUESTREAR') this.laser(din.rover.pos);
    if (d && d.accion === 'RECARGAR') this.recarga();
    (din.eventos_nuevos || []).forEach(ev => {
      const t = ev.tipo;
      if (t === 'sismo') { this.temblor = 1.2; }
      else if (t === 'meteorito') {
        const m = /\((\d+), (\d+)\)/.exec(ev.detalle);
        if (m) this.meteorito(+m[1], +m[2]);
        this.temblor = 0.8;
      } else if (t === 'colision' || t === 'frenado_insuficiente') { this.temblor = 0.7; this.destello(0xff2a2a); }
      else if (t === 'deslizamiento' || t === 'frenado_en_borde') { this.temblor = 0.5; }
      else if (t === 'muestra') {
        const m = /valor ([\d.]+)/.exec(ev.detalle);
        this.textoFlotante(pos.clone().add(new THREE.Vector3(0, 2.4, 0)), `+${m ? m[1] : ''} ciencia`, 'flot-ok');
      } else if (t === 'muestra_fallida') this.textoFlotante(pos.clone().add(new THREE.Vector3(0, 2.4, 0)), 'Falta instrumento', 'flot-mal');
      else if (t === 'tormenta_polvo') this.temblor = 0.15;
    });
    if (d && d.motivo && d.motivo.startsWith('VETO') && d.destino) {
      this.textoFlotante(this._p(d.destino[0], d.destino[1], 2.6), d.motivo.replace('VETO_', 'VETO · '), 'flot-mal', 1.6);
    }
  }

  // ------------------------------------------------------------- efectos
  laser([f, c]) {
    if (!this.vehiculo) return;
    const objetivo = this._p(f, c, 0.15).add(new THREE.Vector3(0.6, 0, 0.4));
    const origen = new THREE.Vector3();
    this.cabeza.getWorldPosition(origen);
    const dir = objetivo.clone().sub(origen); const largo = dir.length();
    const geo = new THREE.CylinderGeometry(0.035, 0.035, largo, 8, 1, true);
    geo.translate(0, largo / 2, 0); geo.rotateX(Math.PI / 2);
    const haz = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a55, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    haz.position.copy(origen); haz.lookAt(objetivo);
    const nucleo = new THREE.Mesh(geo.clone().scale(0.4, 0.4, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    nucleo.position.copy(origen); nucleo.lookAt(objetivo);
    const impacto = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd0e0, blending: THREE.AdditiveBlending, transparent: true }));
    impacto.position.copy(objetivo);
    const luz = new THREE.PointLight(0xff3366, 8, 6); luz.position.copy(objetivo);
    const chispas = this._particulas(objetivo, 60, 0xffaa66, 2.2, 0.08);
    const grupo = new THREE.Group(); grupo.add(haz, nucleo, impacto, luz, chispas.obj);
    this.scene.add(grupo);
    this.efectos.push({ obj: grupo, t0: this.reloj.elapsedTime, dur: 1.1, tick: (t) => {
      const k = 1 - t; haz.material.opacity = (0.6 + 0.4 * Math.sin(t * 80)) * k; impacto.scale.setScalar(1 + Math.sin(t * 60) * 0.3); luz.intensity = 8 * k; chispas.tick(t);
    } });
  }

  recarga() {
    if (!this.vehiculoPos) return;
    const p = this.vehiculoPos.clone();
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0x44ffaa, transparent: true, blending: THREE.AdditiveBlending }));
    anillo.rotation.x = Math.PI / 2; anillo.position.copy(p);
    this.scene.add(anillo);
    this.efectos.push({ obj: anillo, t0: this.reloj.elapsedTime, dur: 1.2, tick: (t) => { anillo.position.y = p.y + t * 2.2; anillo.scale.setScalar(1 + t * 0.6); anillo.material.opacity = 1 - t; } });
  }

  meteorito(f, c) {
    const fin = this._p(f, c, 0);
    const ini = fin.clone().add(new THREE.Vector3(-25, 40, -15));
    const roca = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff5500, emissiveIntensity: 3 }));
    const estela = new THREE.Mesh(new THREE.ConeGeometry(0.45, 5, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(roca, estela);
    estela.position.set(0, 2.5, 0);
    const dir = fin.clone().sub(ini).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.scene.add(g);
    let exploto = false;
    this.efectos.push({ obj: g, t0: this.reloj.elapsedTime, dur: 0.9, tick: (t) => {
      g.position.lerpVectors(ini, fin, t * t);
      if (t > 0.97 && !exploto) { exploto = true; this.explosion(fin); }
    } });
  }

  explosion(p) {
    const bola = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    bola.position.copy(p);
    const luz = new THREE.PointLight(0xff8833, 30, 30); luz.position.copy(p).add(new THREE.Vector3(0, 2, 0));
    const part = this._particulas(p, 160, 0xff8a3a, 7, 0.16);
    const g = new THREE.Group(); g.add(bola, luz, part.obj);
    this.scene.add(g);
    this.temblor = 1.4;
    this.efectos.push({ obj: g, t0: this.reloj.elapsedTime, dur: 1.6, tick: (t) => { bola.scale.setScalar(1 + t * 5); bola.material.opacity = 1 - t; luz.intensity = 30 * (1 - t); part.tick(t); } });
  }

  destello(color) {
    if (!this.vehiculoPos) return;
    const luz = new THREE.PointLight(color, 25, 10); luz.position.copy(this.vehiculoPos).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(luz);
    this.efectos.push({ obj: luz, t0: this.reloj.elapsedTime, dur: 0.6, tick: (t) => { luz.intensity = 25 * (1 - t); } });
  }

  _particulas(origen, n, color, vel, tam) {
    const pos = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) {
      pos.set([origen.x, origen.y, origen.z], i * 3);
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.5;
      const s = vel * (0.4 + Math.random() * 0.8);
      v.push([Math.cos(th) * Math.cos(ph) * s, Math.sin(ph) * s * 1.2, Math.sin(th) * Math.cos(ph) * s]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size: tam, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const obj = new THREE.Points(g, m);
    return { obj, tick: (t) => {
      for (let i = 0; i < n; i++) {
        pos[i * 3] = origen.x + v[i][0] * t; pos[i * 3 + 1] = origen.y + v[i][1] * t - 4.9 * t * t * 0.5; pos[i * 3 + 2] = origen.z + v[i][2] * t;
      }
      g.attributes.position.needsUpdate = true; m.opacity = 1 - t;
    } };
  }

  // --------------------------------------------------------------- cámara
  setModoCamara(modo) {
    this.modoCamara = modo;
    if (!this.est) return;
    if (modo === 'cenital') {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(0.01, Math.max(this.W, this.D) * 1.25, 0.01 + Math.max(this.W, this.D) * 0.12);
    } else if (modo === 'orbita') {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(this.W * 0.7, this.W * 0.6, this.D * 0.85);
    } else if (modo === 'seguir' && this.vehiculoPos) {
      const base = this.vehiculoPos.clone();
      if (this.sonda) base.y += 1.2;
      this.controls.target.copy(base);
      // En modo sonda se mira desde la capa alta hacia la profundidad
      this.camera.position.copy(base).add(this.sonda ? new THREE.Vector3(9, 7, -12) : new THREE.Vector3(-7, 7.5, 9));
    }
  }

  enfocarVehiculo() { this.setModoCamara('seguir'); }

  setCapa(nombre, visible) {
    this.capasVisibles[nombre] = visible;
    if (nombre === 'creencia' && this.mallaCreencia) this.mallaCreencia.visible = visible;
    if (nombre === 'etiquetas') this.capa.style.display = visible ? '' : 'none';
    if (this.ultimoDin && ['plan', 'candidatas', 'ejecutada'].includes(nombre)) this._actualizarRutas(this.ultimoDin);
  }

  // --------------------------------------------------------------- bucle
  _animar() {
    requestAnimationFrame(this._animar);
    const dt = Math.min(0.05, this.reloj.getDelta());
    const t = this.reloj.elapsedTime;
    this._aplicarAmbiente(dt);
    this.cieloMat.uniforms.tiempo.value = t;
    this.cielo.position.copy(this.camera.position);
    this.estrellas.position.copy(this.camera.position);

    // Vehículo
    if (this.tween && this.vehiculo) {
      const tw = this.tween;
      const k = clamp((t - tw.t0) / tw.dur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const prev = this.vehiculoPos.clone();
      this.vehiculoPos.lerpVectors(tw.desde, tw.hasta, e);
      let dy = tw.yaw1 - tw.yaw0; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yawActual = tw.yaw0 + dy * Math.min(1, k * 1.6);
      const x = this.vehiculoPos.x, z = this.vehiculoPos.z;
      const y = this.alturaEn(x, z);
      this.vehiculo.position.set(x, this.sonda ? y + 1.0 + Math.sin(t * 1.6) * 0.18 : y, z);
      const mov = prev.distanceTo(this.vehiculoPos);
      this.ruedaGiro += mov / 0.22;
      this.ruedas.forEach(rw => { rw.rotation.z = -this.ruedaGiro; });
      if (!this.sonda) {
        const h = 0.55;
        const nx = this.alturaEn(x - h, z) - this.alturaEn(x + h, z), nz = this.alturaEn(x, z - h) - this.alturaEn(x, z + h);
        const normal = new THREE.Vector3(nx, 2 * h, nz).normalize();
        const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawActual);
        this.vehiculo.quaternion.slerp(qn.multiply(qy), Math.min(1, dt * 8));
      } else {
        this.vehiculo.rotation.set(Math.sin(t * 1.3) * 0.05, this.yawActual, Math.sin(t * 1.1) * 0.06);
        this.helices.forEach(h => { h.rotation.x += dt * 25; });
        if (this.baliza) this.baliza.material.emissiveIntensity = (Math.sin(t * 6) > 0.6) ? 5 : 0.3;
      }
      if (this.anilloSel) this.anilloSel.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
      if (this.cabeza && !this.sonda) this.cabeza.rotation.y = Math.sin(t * 0.7) * 0.5;
      if (this.antena) this.antena.rotation.y = t * 0.4;
      const est = this.estadoRover?.estado;
      if (this.ojoMat) this.ojoMat.color.set(est === 'MODO_SEGURO' ? 0xffaa00 : est === 'ALERTA' ? 0xff4444 : 0x66e0ff), this.ojoMat.emissive.copy(this.ojoMat.color);

      // Cámara de seguimiento
      if (this.modoCamara === 'seguir') {
        const objetivo = this.vehiculo.position.clone();
        const delta = objetivo.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 4));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
    }

    // Animaciones ambientales
    this.gSitios.children.forEach(s => {
      const u = s.userData;
      if (!u.recolectado) { u.cristal.rotation.y += dt * 1.2; u.cristal.position.y = 1.0 + Math.sin(t * 2 + u.fase) * 0.15; }
      if (u.corona) u.corona.rotation.x = t;
    });
    this.gRefugios.children.forEach(r => { const p = r.userData.pulso; if (p) p.material.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.8; });
    this.gRocas.children.forEach(o => {
      if (o.userData.giro) o.rotation.y += dt * o.userData.giro;
      if (o.userData.vortice) o.userData.vortice.rotation.z -= dt * 2.5;
    });
    this.gRutas.children.forEach(o => {
      if (o.userData.pulso) o.scale.setScalar(1 + Math.sin(t * 4) * 0.1);
      if (o.userData.flota) { o.position.y += Math.sin(t * 3) * 0.004; o.rotation.y += dt; }
    });
    this.gZonas.children.forEach(z => {
      if (z.userData.pulso) z.userData.pulso.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
      if (z.userData.giro) z.rotation.y += dt * z.userData.giro;
      z.traverse(n => {
        if (n.userData.onda) { const k = (t % 1.6) / 1.6; n.scale.setScalar(1 + k * 5); n.material.opacity = 0.8 * (1 - k); }
        if (n.userData.ovni) n.position.y = 3.2 + Math.sin(t * 2) * 0.3;
      });
    });
    // Polvo de tormenta / viento
    if (this.polvoMat.opacity > 0.01) {
      const pa = this.polvo.geometry.attributes.position;
      const vx = 6 + (this.objetivoAmb?.viento || 0) * 10;
      for (let i = 0; i < pa.count; i++) {
        let x = pa.getX(i) + vx * dt, y = pa.getY(i) - dt * 0.4;
        if (x > 40) x -= 80; if (y < 0) y += 18;
        pa.setX(i, x); pa.setY(i, y);
      }
      pa.needsUpdate = true;
      this.polvo.position.set(this.controls.target.x, this.hmin ?? 0, this.controls.target.z);
    }

    // Efectos temporales
    this.efectos = this.efectos.filter(ef => {
      const k = (t - ef.t0) / ef.dur;
      if (k >= 1) { this.scene.remove(ef.obj); ef.obj.traverse(n => { n.geometry?.dispose?.(); n.material?.dispose?.(); }); return false; }
      ef.tick(k); return true;
    });

    this.controls.update();
    // Temblor de cámara (sismo, impacto, colisión)
    let off = null;
    if (this.temblor > 0.01) {
      off = new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)).multiplyScalar(this.temblor * 0.5);
      this.camera.position.add(off);
      this.temblor *= Math.pow(0.04, dt);
    }
    this.composer.render();
    if (off) this.camera.position.sub(off);
    this._proyectarEtiquetas(t);
  }

  _proyectarEtiquetas(t) {
    const w = this.cont.clientWidth, h = this.cont.clientHeight, v = new THREE.Vector3();
    this.etiquetas = this.etiquetas.filter(e => {
      if (e.temporal) {
        const k = (t - e.t0) / e.dur;
        if (k >= 1) { e.el.remove(); return false; }
        v.copy(e.pos); v.y += k * 1.5;
        e.el.style.opacity = String(1 - Math.max(0, k - 0.6) / 0.4);
      } else {
        if (!e.obj.parent) { e.el.remove(); return false; }
        e.obj.getWorldPosition(v); v.y += e.alto;
      }
      const dist = v.distanceTo(this.camera.position);
      v.project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (e.temporal || dist < 70);
      e.el.style.display = visible ? '' : 'none';
      if (visible) e.el.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px)`;
      return true;
    });
  }
}
