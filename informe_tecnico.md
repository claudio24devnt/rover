# ARES-X · Informe técnico

**Rover autónomo de exploración planetaria con arquitectura de IA híbrida**
Inteligencia Artificial Aplicada · Desafío integrador 2026
Entorno: Python en Google Colab gratuito con CPU · Simulador v1.0.0

> **Naturaleza del trabajo.** Simulación ficticia con parámetros astronómicos de referencia.
> No representa una misión real ni certifica condiciones operacionales de ingeniería espacial.
> Los valores marcados `[NASA]` provienen de hojas de datos públicas; todos los parámetros
> operacionales son hipótesis pedagógicas marcadas `[SUPUESTO]` y no deben presentarse como
> especificaciones NASA.

---

## 1. Arquitectura

### 1.1 Flujo por paso

```
generador del mundo
      ↓
sensores + ruido  ──────────────►  preprocesamiento (normalización min-max fija)
      ↓                                     ↓
      │                            RNA  → p(libre), p(obstáculo), p(barranco)
      │                                     ↓
      │                            mapa de creencias (BeliefMap)
      │                                     ↓
      ├──► lógica difusa → velocidad, cautela        AG → rutas candidatas
      │              ↓                                      ↓
      └──────────►  SUPERVISOR DE SEGURIDAD  ◄──────────────┘
                            ↓
                    acción + código de motivo
                            ↓
                 física simplificada → bitácora → paneles
```

El AG se recalcula al llegar a un objetivo, al detectar un bloqueo o ante un evento grave;
nunca en cada cuadro animado.

### 1.2 Entradas y salidas verificables

| Módulo | Entrada | Salida observable | Explicación registrada |
|---|---|---|---|
| RNA | 10 rasgos de sensores con ruido | probabilidades de 3 clases | vector normalizado, activaciones por capa, confianza, matriz de confusión |
| Difuso | distancia, batería, pendiente, margen térmico | velocidad ∈ [0,1], cautela ∈ [0,1] | grados de membresía, reglas disparadas con grado, área agregada, centroide |
| AG | mapa de riesgo **estimado**, sitios, batería | 3 rutas candidatas y la elegida | genes, aptitud desglosada, torneos, cruces, mutaciones, convergencia |
| Supervisor | recomendaciones + límites duros | avanzar / detener / recargar / volver / replanificar / muestrear / modo seguro | restricciones que vetaron o permitieron, con código de motivo |

### 1.3 Principio de separación

`World` es la verdad del terreno; `BeliefMap` es lo que el rover cree. **El rover nunca consulta
`World` para decidir.** El AG evalúa siempre contra el mapa estimado: planificar contra el futuro
conocido sería hacer trampa. La verdad del terreno se usa sólo para la física del movimiento y
para calcular métricas *a posteriori*.

---

## 2. Decisiones de diseño y por qué se tomaron

Varias de estas decisiones surgieron de fallos observados al probar el sistema, no de la teoría.
Se documentan con el problema que resolvieron, porque es ahí donde está el aprendizaje.

### 2.1 Partición del dataset por mapas, no por filas

Las celdas de un mismo mapa comparten relieve, iluminación y nivel de polvo: están fuertemente
correlacionadas. Repartirlas al azar entre train y test produce fuga de información y métricas
infladas. Se generan 24 mapas independientes (4 planetas × 3 dificultades, con hora solar y
tormenta variables) y se asignan **enteros**: 14 a entrenamiento, 4 a validación, 6 a test.
`verificar_sin_fuga()` comprueba que ningún mapa aparece en dos particiones.

### 2.2 Margen térmico en lugar de temperatura absoluta

El universo de discurso de una variable difusa debe ser comparable entre escenarios. 464 °C en
Venus y −65 °C en Marte pueden ser igualmente seguros o igualmente letales según el hardware
simulado. Se usa la **distancia en °C al límite más cercano del hardware**, que sigue siendo una
magnitud en grados Celsius y permite una única base de reglas para los ocho perfiles.

### 2.3 Complemento difuso para resolver un conflicto real

Con margen térmico crítico, la regla de avance rápido (R04) y la de parar (R06) se disparaban
ambas con grado 1,0. La agregación por máximo y el centroide devolvían **velocidad 0,65**: una
recomendación insegura producida por un controlador formalmente correcto.

La solución fue añadir la negación difusa estándar (μ̄ = 1 − μ) y guardar las reglas de avance
con `margen_térmico NO ES crítico`. Con la misma entrada, la salida pasó a **0,07**.

| Entrada | Antes | Después |
|---|---|---|
| distancia 18 m, batería 80 %, pendiente 4°, margen −5 °C | 0,647 | **0,074** |

### 2.4 El veto de pendiente evalúa la transición, no la celda actual

La primera versión vetaba cuando la inclinación **del rover** superaba el máximo de vuelco. El
resultado fue un bloqueo permanente: en cuanto el rover se detenía sobre una celda inclinada,
todo destino quedaba vetado y la misión se estancaba replanificando indefinidamente.

La inclinación del rover no dice nada sobre si el **siguiente movimiento** es seguro. La versión
corregida mide la pendiente de la transición por altimetría. La separación empírica es amplia:

| Transición | Mediana | p90 | p99 |
|---|---|---|---|
| hacia celda transitable | 5,0° | 15,3° | 22,8° |
| hacia barranco | 61,0° | — | — |

Con el umbral en 28° se bloquea menos del 1 % de las transiciones legítimas y el 100 % de las
que llevan a un precipicio.

### 2.5 Reserva energética dinámica

Un porcentaje fijo de reserva es incorrecto: 12 % de batería es holgado junto a una estación y
letal a veinte celdas de distancia. La reserva se calcula como la energía estimada para alcanzar
la zona segura más cercana, más un margen del 50 %, usando el consumo neto observado
(consumo menos recarga solar media). Esto es lo que hace que CA-03 tenga sentido.

### 2.6 Umbral alto para el bloqueo duro por creencia

Una predicción probabilística **no debe cerrar el paso por sí sola**. Con un umbral de 0,6, el
5–8 % de falsos positivos de la RNA fragmentaba el mapa navegable y el rover terminaba
encerrándose en su propia cautela acumulada. Sólo las celdas **confirmadas** por el sensor
determinista de borde bloquean de forma dura; la RNA influye sobre todo a través del **coste**
de riesgo que evalúa el AG. El efecto fue grande: las colisiones del sistema completo pasaron
de ser comparables a las del baseline a prácticamente cero.

### 2.7 La velocidad es avance por paso

En la primera versión el rover avanzaba una celda por paso independientemente de la velocidad.
Con ese modelo, ir lento no tenía costo alguno y el controlador difuso era decorativo: la
política óptima era «siempre lento».

Ahora la velocidad es **celdas por paso** (0,25 → cuatro pasos por celda). Así ir rápido tiene un
beneficio real —cubrir terreno dentro del presupuesto de pasos— y dos costos: **frenado
insuficiente** por encima de 0,60 de velocidad y **deslizamiento en pendiente** proporcional a
velocidad y pendiente. El controlador difuso resuelve ese compromiso.

### 2.8 "Muy lento" es marcha lenta, no parálisis

Convertir toda velocidad difusa menor que 0,05 en una detención total hacía que el controlador se
penalizara a sí mismo: el rover acumulaba esperas estériles hasta que el detector de estancamiento
lo declaraba sin ruta. Sólo la salida de respaldo del controlador (exactamente 0, cuando no se
activa ninguna regla) ordena detención; por debajo de 0,08 se aplica una marcha mínima de
aproximación.

### 2.9 El AG estima el tiempo con la velocidad media observada

Pasarle la velocidad **instantánea** hacía que una frenada puntual por cautela le hiciera concluir
que todos los objetivos quedaban demasiado lejos, y abandonaba la ciencia. Se usa una media móvil
exponencial de la velocidad realmente ejecutada. Tras este cambio, la ciencia recolectada del
sistema completo pasó de 68,5 % a 79,5 % sin perder la ventaja de seguridad.

### 2.10 La colisión no permite ocupar la celda

Un rover no puede ocupar una celda infranqueable. La colisión ahora lo detiene, lo hace rebotar a
la celda anterior, le cuesta el paso, suma 18 de desgaste y fuerza replanificación. Además el
desgaste limita la velocidad efectiva (`factor_mecánico = 1 − 0,5·desgaste/100`), de modo que el
daño se paga en terreno cubierto y no sólo en un contador.

### 2.11 Decodificador voraz deliberadamente subóptimo

Si cada tramo del cromosoma se decodificara con un A\* óptimo, la elección de waypoints por parte
del AG sería irrelevante: el A\* haría todo el trabajo y el algoritmo genético quedaría
decorativo. El decodificador usa avance voraz con evitación local y tabú, de modo que el orden de
visitas y los waypoints cambian realmente la calidad de la ruta.

### 2.12 La cobertura difusa se verifica por salida, no por regla

El primer barrido de cobertura contaba cuántas combinaciones de entrada no activaban
**ninguna** regla y daba cero, lo que parecía demostrar cobertura total. Era una comprobación
mal planteada: R11 (`SI distancia cerca O pendiente fuerte ENTONCES cautela alta`) se activa con
frecuencia pero no dice nada sobre la velocidad. Con pendiente fuerte y camino despejado, la
única regla activa era R11, el área agregada de velocidad quedaba vacía, el centroide no estaba
definido y se aplicaba la salida de respaldo: **el rover se detenía en terreno simplemente
inclinado**. Afectaba al 2,4 % del espacio de entrada. R15 y R16 lo cierran, y la comprobación
se hace ahora por variable de salida.

### 2.13 Hash estable para la reproducibilidad

`rng_de()` derivaba los flujos aleatorios con `hash()` de Python, que está **aleatorizado por
proceso**. La misma semilla producía trazas distintas en cada sesión. Se sustituyó por CRC32.
Verificado: dos procesos independientes con semilla 42 producen `pasos=110`,
`ciencia=2.374`, `distancia=193.1 m` idénticos.

---

## 3. Red neuronal artificial

**Arquitectura.** MLP de dos capas ocultas (32, 16), ReLU, softmax de 3 clases, 931 parámetros.
Entrenado en CPU con `partial_fit` por épocas para registrar el historial y permitir la
inspección de iteraciones.

**Datos.** 6 192 muestras equilibradas por clase sobre 24 mapas independientes.
Partición por mapas verificada sin fuga.

**Rasgos (10).** Proximidad frontal, Δaltura, pendiente, contraste de borde, vibración, textura,
reflectancia multiespectral, contraste térmico, visibilidad y dispersión LIDAR. Todos son
magnitudes físicas observables con ruido dependiente de la visibilidad; **ninguno es la etiqueta
sin transformar**. Dos son especialmente discriminantes: un obstáculo devuelve eco de proximidad
cercano mientras que un barranco es un hueco que no refleja y devuelve lectura larga; y la
dispersión LIDAR se dispara en discontinuidades de relieve.

**Resultados sobre test (mapas nunca vistos):**

| Modelo | Exactitud | macro-F1 | Recall barranco | ECE |
|---|---|---|---|---|
| **RNA (MLP 32-16)** | **0,969** | **0,969** | **0,975** | **0,015** |
| baseline mayoritario | 0,333 | 0,167 | 0,000 | — |
| baseline reglas fijas | 0,869 | 0,863 | — | — |

Valores reproducibles con la configuración por defecto del notebook
(24 mapas, 260 muestras por mapa, semilla 20260, 140 épocas).

El baseline de reglas fijas (dos umbrales sobre dos rasgos) alcanza 0,863 de macro-F1: la red
aporta una mejora real pero **el problema no es trivial ni la red es imprescindible para una
primera aproximación**. Lo que sí aporta de forma decisiva es el recall de barrancos y la
calibración, que es lo que el supervisor consume.

El ECE de 0,013 importa porque el supervisor activa el modo conservador cuando la confianza baja
de 0,55; con una red sobreconfiada esa salvaguarda nunca se dispararía.

---

## 4. Lógica difusa

**Variables.** Cuatro entradas × tres conjuntos lingüísticos (RF-05):
distancia a riesgo [0, 20] m (cerca/media/lejos), batería [0, 100] % (crítica/baja/alta),
pendiente [0, 45]° (plana/media/fuerte) y margen térmico [−20, 80] °C (crítico/ajustado/holgado).
Funciones triangulares, trapezoidales y una gaussiana.

**Salidas.** Velocidad [0, 1] con cuatro conjuntos (parar/lenta/moderada/rápida) y cautela [0, 1]
con tres.

**Inferencia.** Mamdani min–max con desfusificación por centroide sobre un universo discretizado
en 201 puntos, implementado desde cero.

**Base de reglas.** 16 reglas justificadas individualmente, incluida una disyuntiva (R11, con
operador OR) y siete con guarda de inhibición por complemento difuso.

**Cobertura, verificada por salida.** Contar «reglas activas» no basta: R11 se dispara a menudo
pero sólo fija la cautela, así que la *velocidad* puede quedar sin cobertura. Al ejecutar el
sistema apareció ese caso — pendiente fuerte con camino despejado — y el rover se congelaba en
terreno simplemente inclinado: el área agregada de velocidad era nula y se aplicaba el respaldo
(velocidad 0). R15 y R16 cierran el hueco. `cobertura_salidas()` verifica ahora, salida por
salida, que ninguna de las 6 561 combinaciones del espacio de entrada deja el agregado vacío. La condición de borde «ninguna regla se activa» se demuestra
explícitamente desactivando reglas desde el laboratorio: el área agregada es nula, el centroide
no está definido y se aplica la salida de respaldo documentada **velocidad 0, cautela 1**.

**Comportamiento verificado (CA-05):**

| Situación | Velocidad | Reglas dominantes |
|---|---|---|
| despejado, batería 90 %, llano | 0,873 | R04 (1,00) |
| obstáculo a 1 m | 0,050 | R01 (1,00), R11 (1,00) |
| CA-05: 10 m → 1 m | 0,550 → 0,067 | R05 → R01 + R11 |
| batería 12 % | 0,240 | R02 (0,67) |
| margen térmico crítico | 0,074 | R06 (1,00) |

---

## 5. Algoritmo genético

**Cromosoma mixto** que integra las tres familias de subproblemas del curso (el enunciado exige
al menos dos):

| Gen | Contenido | Familia |
|---|---|---|
| `orden[]` | permutación de sitios científicos pendientes | **viajero** |
| `n_visitas` | cuántos se intentan en este plan | alcance |
| `instrumentos[]` | máscara binaria bajo masa ≤ 12 kg y potencia ≤ 55 W | **mochila** |
| `waypoints[]` | 3 celdas de guiado, con reparación si caen en celda creída bloqueada | **laberinto** |

**Operadores.** Torneo (k=3); OX para la permutación (preserva orden relativo); uniforme para la
mochila; mezcla aritmética entera para los waypoints; mutación por intercambio, bit-flip, jitter
y ajuste de `n_visitas`; elitismo 2; parada temprana por 10 generaciones sin mejora.
Población 40, generaciones 40 por defecto (28 y 22 en los experimentos, por tiempo de cómputo).

**Función objetivo.**

```
fitness = w₁·ciencia − w₂·distancia − w₃·energía − w₄·riesgo − w₅·tiempo − P(inviabilidad)
```

Pesos por defecto: ciencia 0,40 · distancia 0,15 · energía 0,15 · riesgo 0,22 · tiempo 0,08.
Todas las magnitudes normalizadas a [0,1] y todos los pesos configurables desde la interfaz.
El panel muestra el **desglose por componente** de cada candidata, no una única puntuación.

**Restricciones duras.** Precipicio confirmado, zona prohibida activa, salida del mapa, energía
insuficiente para la reserva dinámica y exceso de masa o potencia en la mochila.

**Convergencia típica** (mapa 22×22, 6 sitios, batería 60 %): fitness 0,088 → 0,195 en 27
generaciones con parada temprana, 0,20 s por planificación.

---

## 6. Supervisor y seguridad

Orden de evaluación innegociable:

1. Batería agotada
2. Sensor crítico inválido → modo seguro
3. Límite térmico del hardware
4. Desgaste mecánico
5. Reserva energética dinámica
6. Validación de la celda destino: fuera del mapa, precipicio u obstáculo confirmado por el
   sensor de borde, pendiente de transición, zona prohibida, veto preventivo de la RNA
7. Factibilidad de la ruta vigente
8. **Sólo entonces**: fusión de las recomendaciones difusa y genética

Cuando el supervisor no veta, la acción y la velocidad provienen literalmente de las salidas del
AG y del controlador difuso. Cada decisión emite un **código de motivo reproducible** (20 códigos
definidos) que queda en la bitácora.

---

## 7. Pruebas

### 7.1 Condiciones de borde y casos de aceptación

**24 de 24 superadas** (16 condiciones de borde de la sección 12 del enunciado y 8 casos de
aceptación de la sección 13). Cada una registra evidencia textual concreta. Ninguna provoca
excepción no controlada.

Algunas evidencias destacadas:

* **CB-10** (reglas sin activación): 0 reglas activas → `fallback=True`, velocidad 0,00,
  cautela 1,00.
* **CB-12 / CA-07** (Júpiter con ruedas): la validación rechaza la configuración, `Mission` lanza
  `ValueError` y el modo sonda es aceptado. La interfaz deshabilita el selector de modo y muestra
  la explicación científica.
* **CB-14** (semilla repetida): traza equivalente, verificada también entre procesos distintos.
* **CA-03** (batería 12 % de noche, sin captación solar): el sistema emite
  `REFUGIO_INALCANZABLE` en lugar de prometer un rescate imposible.

### 7.2 Pruebas de causalidad (condición de auditoría)

Cada prueba modifica **una sola** salida y mantiene todo lo demás constante.

| Técnica | Variable controlada | ¿Influye? | Evidencia |
|---|---|---|---|
| RNA | p(barranco) del destino | **SÍ** | p=0,03 → `AVANZAR` (`OK_AVANCE`); p=0,82 → `REPLANIFICAR` (`VETO_RNA_BARRANCO`) |
| Lógica difusa | distancia a riesgo | **SÍ** | 10 m → velocidad ejecutada 0,461; 1 m → 0,000 (`DETENER`) |
| AG | pesos del fitness | **SÍ** | priorizando ciencia visita 6 sitios con riesgo 0,233; priorizando seguridad visita 0 con riesgo 0,155; las rutas difieren |
| Supervisor | sensor de borde | **SÍ** | con la misma recomendación de IA (velocidad 0,9, p_libre 0,95), confirmar el precipicio convierte `AVANZAR` en `REPLANIFICAR` |

No existe ninguna política oculta: desactivar cualquiera de las tres técnicas cambia el
comportamiento del sistema de forma medible, como muestra la sección siguiente.

---

## 8. Resultados experimentales

**Diseño.** 2 escenarios × 6 políticas × **20 semillas independientes** = 240 episodios.
Todas las políticas se ejecutan con **exactamente la misma semilla, el mismo mapa y los mismos
eventos**. Intervalos de confianza normales al 95 %.

Escenario A: Marte, dificultad media, batería inicial 60 %, 300 pasos máximo.
Escenario B: Marte, dificultad difícil, batería inicial 45 %, 300 pasos máximo.

### 8.1 Escenario A — Marte, dificultad media

| Política | Éxito % | Ciencia % (media ± sd) | Colisiones | Violaciones | Replanif. | Celdas/paso |
|---|---|---|---|---|---|---|
| ruta_corta (baseline) | 30,0 | 76,9 ± 20,3 | **2,90** | 0,00 | 18,0 | 0,242 |
| ag_puro (baseline) | 55,0 | 79,0 ± 26,6 | **2,80** | 0,00 | 9,3 | 0,257 |
| sin_rna (ablación) | 35,0 | 72,5 ± 25,1 | **2,10** | 0,00 | 6,7 | 0,267 |
| sin_difuso (ablación) | 65,0 | 76,5 ± 25,7 | 0,05 | 0,05 | 7,4 | 0,314 |
| sin_ag (ablación) | 40,0 | 82,7 ± 21,9 | 0,05 | 0,00 | **17,6** | 0,311 |
| **hibrido (completo)** | 45,0 | **79,5 ± 24,6** | **0,00** | **0,00** | **9,2** | 0,308 |

### 8.2 Escenario B — Marte, dificultad difícil

| Política | Éxito % | Ciencia % | Colisiones | Replanif. | Batería final |
|---|---|---|---|---|---|
| ruta_corta | 5,0 | 51,4 | 1,80 | 19,2 | 12,7 |
| ag_puro | 15,0 | 43,2 | 2,45 | 12,8 | 14,6 |
| sin_rna | 10,0 | 27,1 | 1,10 | 7,0 | 33,9 |
| sin_difuso | 15,0 | 50,2 | 0,05 | 14,4 | 14,1 |
| sin_ag | 5,0 | 36,4 | 0,00 | 14,3 | 37,2 |
| **hibrido** | 5,0 | 31,1 | **0,05** | **10,1** | 36,3 |

### 8.3 Qué se puede y qué no se puede concluir

**Conclusión 1 — la percepción neuronal elimina las colisiones. Significativa al 95 %.**

| Comparación (colisiones) | Escenario A | Escenario B |
|---|---|---|
| ruta_corta − híbrido | +2,90 ± 1,05 ✔ | +1,75 ± 0,74 ✔ |
| ag_puro − híbrido | +2,80 ± 0,80 ✔ | +2,40 ± 0,77 ✔ |
| sin_rna − híbrido | +2,10 ± 0,71 ✔ | +1,05 ± 0,54 ✔ |

Las tres políticas sin RNA chocan entre 1,1 y 2,9 veces por misión; las tres políticas con RNA
registran entre 0,00 y 0,05. El intervalo de confianza no incluye el cero en ningún caso. Éste es
el resultado más robusto del trabajo.

**Conclusión 2 — el AG reduce a la mitad las replanificaciones. Significativa al 95 %.**
En el escenario A, el sistema completo replanifica 9,2 veces frente a 17,6 de la ablación sin AG
(diferencia 8,35 ± 3,54) y 18,0 del baseline de ruta más corta (8,80 ± 3,05). Planificar una
secuencia completa de objetivos contra el mapa de riesgo estimado evita el ciclo
«avanzar–bloquearse–recalcular» de los planificadores miopes.

**Conclusión 3 — la ciencia recolectada no difiere significativamente en el escenario A.**
Ninguna política se separa del híbrido con un intervalo que excluya el cero. El sistema completo
obtiene 79,5 % de la ciencia disponible con cero colisiones; las políticas que chocan obtienen
cifras comparables pero destruyendo el vehículo.

**Conclusión 4 — en terreno difícil la cautela cuesta ciencia, y hay que decirlo.**
En el escenario B, `ruta_corta` (51,4 %) y `sin_difuso` (50,2 %) superan significativamente al
híbrido (31,1 %). El sistema completo es más conservador: evita zonas de riesgo alto, declara
objetivos inalcanzables antes y conserva más batería (36,3 % frente a 12,7 %). Es un intercambio
real, no un defecto de implementación, y el operador puede moverlo con los pesos del fitness y
con el umbral de veto de la RNA.

**Conclusión 5 — el escenario difícil está cerca de la infactibilidad con este presupuesto.**
Ninguna política supera el 15 % de misiones exitosas. Atribuir diferencias de éxito entre
políticas en ese régimen sería sobreinterpretar el ruido: con n=20 y tasas del 5–15 %, los
intervalos de confianza se solapan ampliamente.

**Lo que este experimento NO demuestra.** Que el sistema híbrido sea superior en tasa de éxito de
misión. En el escenario A la ablación sin controlador difuso alcanza 65 % frente al 45 % del
sistema completo. La diferencia no es significativa con n=20 (los intervalos se solapan), pero
tampoco hay evidencia de lo contrario. La ventaja demostrada del sistema completo es de
**seguridad y eficiencia de planificación**, no de tasa de éxito.

---

## 9. Declaración de uso de IA generativa

*(Completar individualmente antes de la entrega, conforme a la sección 17 del enunciado.)*

| Integrante | Qué generé con asistencia de IA | Qué modifiqué y por qué | Qué puedo explicar y modificar sin asistencia |
|---|---|---|---|
| | | | |

**Prompts relevantes utilizados:** _(adjuntar registro)_

**Perturbaciones de defensa a preparar** (sugeridas por el enunciado):

1. Cambiar los pesos del fitness y predecir el efecto antes de ejecutar
   → *Laboratorio Genético*, deslizadores de pesos y botón «Replanificar».
2. Alterar la función trapezoidal de batería crítica
   → `FuzzyController._definir_entradas()`, conjunto `critica` de `bateria_pct`.
3. Introducir NaN en el LIDAR
   → *Panel E*, botón «NaN en LIDAR»; se espera `VETO_SENSOR` y modo seguro.
4. Pasar de modo Marte a Júpiter
   → selector de planeta; se espera bloqueo del modo rover con explicación científica.
5. Quitar la RNA y medir impacto
   → casilla «Usar RNA» o política `sin_rna` en el comparador; se esperan ~2 colisiones
   adicionales por misión.
6. Reproducir un error de semilla y diagnosticarlo
   → fijar semilla, exportar CSV, localizar el paso en la columna `motivo`.

---

## 10. Trazabilidad

### Requisitos funcionales

| RF | Dónde se cumple |
|---|---|
| RF-01 | `Config.validar()`, `PlanetProfile.compatible()`, panel de configuración |
| RF-02 | `World._generar()`, `Dashboard._colocar_barranco()` |
| RF-03 | `Mission.paso()` (pseudociclo completo), `SensorSuite.observar()` |
| RF-04 | `generar_dataset()`, `verificar_sin_fuga()`, `NeuralPerception.entrenar()` |
| RF-05 | `FuzzyController._definir_entradas()` (4×3), `_definir_reglas()` (14) |
| RF-06 | `FuzzyController.inferir()` → centroide + `TrazaDifusa.activaciones` |
| RF-07 | `GeneticPlanner.planificar()`, `_diversificar()` (3 candidatas) |
| RF-08 | `MissionLogger.registrar()` |
| RF-09 | Panel E: paso, pausa, correr, reiniciar, velocidad, inyección de eventos |
| RF-10 | `Dashboard.dibujar_mapa()`: ruta planificada vs. ejecutada |
| RF-11 | Laboratorios RNA (selector de época) y Genético (selector de generación) |
| RF-12 | `exportar_csv()`, `exportar_json()` con semillas, versiones y supuestos |
| RF-13 | `SensorSuite.forzar_fallo()`, `VETO_SENSOR`, modo seguro, CB-03/04/16 |
| RF-14 | `POLITICAS` (2 baselines + 3 ablaciones + completo) |
| RF-15 | `ejecutar_experimento(..., n_semillas=20)`, `resumen_metricas()` |
| RF-16 | Sección 0 del notebook; sin GPU, sin pagos, sin claves |

### Casos de aceptación

| CA | Prueba automática | Resultado |
|---|---|---|
| CA-01 | `ca01_navegacion_normal` | PASA |
| CA-02 | `ca02_obstaculo_imprevisto` | PASA |
| CA-03 | `ca03_energia_critica` | PASA |
| CA-04 | `ca04_diagnostico_genetico` | PASA |
| CA-05 | `ca05_diagnostico_difuso` | PASA |
| CA-06 | `ca06_diagnostico_neuronal` | PASA |
| CA-07 | `ca07_planeta_invalido` | PASA |
| CA-08 | `ca08_experimento_controlado` | PASA |

---

## 11. Limitaciones

1. Los parámetros operacionales son hipótesis pedagógicas; nada es una especificación de
   ingeniería y nada debe atribuirse a la NASA salvo los valores marcados `[NASA]`.
2. Mundo discreto 2D con celdas de 5 m y ocho direcciones. Sin dinámica de ruedas, suspensión,
   tracción diferencial ni mecánica de contacto.
3. El modo sonda es una analogía sobre la misma estructura de datos, no un modelo de dinámica
   atmosférica.
4. La RNA clasifica celdas a partir de rasgos resumidos, no de imágenes: es percepción simulada,
   no visión por computadora, y su desempeño depende del generador de datos sintéticos.
5. El decodificador del AG es voraz y subóptimo por diseño; una ruta mejor puede existir y no ser
   encontrada.
6. La comparación de políticas se hace sobre dos escenarios de Marte; generalizar exigiría
   repetir el experimento.
7. Con n=20 y tasas de éxito del 5–15 % en el escenario difícil, las diferencias de éxito entre
   políticas no son estadísticamente distinguibles.
8. Ninguna salida de este sistema constituye evidencia de vida extraterrestre. El detector de
   biofirmas sólo emite señales anómalas y los eventos de contacto son ficción narrativa.

---

## 12. Fuentes NASA de contraste

* <https://science.nasa.gov/resource/solar-system-temperatures/>
* <https://science.nasa.gov/venus/venus-facts/>
* <https://science.nasa.gov/solar-system/solar-system-facts/>
* <https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html>
