const readline = require('readline');

// ============================================================================
// 1. CONFIGURACIÓN DEL NEGOCIO
//    Centro de distribución, tipos de servicio, tarifas, límites de peso y
//    medidas, capacidad de cada tipo de vehículo y estados posibles del envío.
// ============================================================================

const CENTRO = 'Guatemala';

const TIPOS_SERVICIO = ['estandar', 'express', 'fragil'];

const TARIFAS = {
  estandar: { base: 25, porKg: 3, porKm: 0.5, recargo: 0 },
  express:  { base: 40, porKg: 5, porKm: 0.8, recargo: 0 },
  fragil:   { base: 35, porKg: 4, porKm: 0.6, recargo: 0.15 }
};

const FACTOR_VOLUMETRICO = 5000;
const PESO_MAX_ENVIO = 500;
const DIM_MAX_CM = 300;

const TIPOS_VEHICULO = { moto: 25, pickup: 600, camion: 3000 };

const ESTADOS = {
  RECIBIDO: 'recibido',
  BODEGA: 'en bodega',
  RUTA: 'en ruta',
  ENTREGADO: 'entregado',
  DEVUELTO: 'devuelto'
};

// ============================================================================
// 2. GRAFO PONDERADO DE MUNICIPIOS
//    Lista de adyacencia con los 12 municipios; cada arista es una carretera
//    de doble sentido y su peso es la distancia en km.
// ============================================================================

const grafoMunicipios = {};

function agregarCarretera(a, b, km) {
  if (!grafoMunicipios[a]) grafoMunicipios[a] = {};
  if (!grafoMunicipios[b]) grafoMunicipios[b] = {};
  grafoMunicipios[a][b] = km;
  grafoMunicipios[b][a] = km;
}

[
  ['Guatemala', 'Mixco', 12],
  ['Guatemala', 'Chinautla', 13],
  ['Guatemala', 'Santa Catarina Pinula', 14],
  ['Guatemala', 'Villa Nueva', 18],
  ['Guatemala', 'San Miguel Petapa', 17],
  ['Mixco', 'San Juan Sacatepéquez', 20],
  ['Mixco', 'Chinautla', 16],
  ['Mixco', 'Villa Nueva', 22],
  ['Chinautla', 'San Pedro Ayampuc', 14],
  ['San Pedro Ayampuc', 'San José Pinula', 25],
  ['Santa Catarina Pinula', 'San José Pinula', 10],
  ['Santa Catarina Pinula', 'Fraijanes', 12],
  ['Fraijanes', 'San José Pinula', 15],
  ['Fraijanes', 'Villa Canales', 16],
  ['Villa Nueva', 'San Miguel Petapa', 7],
  ['Villa Nueva', 'Amatitlán', 15],
  ['San Miguel Petapa', 'Villa Canales', 9],
  ['Villa Canales', 'Amatitlán', 18]
].forEach(([a, b, km]) => agregarCarretera(a, b, km));

const MUNICIPIOS = Object.keys(grafoMunicipios);

// ============================================================================
// 3. ALMACENAMIENTO EN MEMORIA
//    Tablas hash (Map) para clientes, vehículos y envíos (rastreo O(1) por
//    guía), la cola de bodega y los contadores para generar códigos.
// ============================================================================

const clientes = new Map();
const vehiculos = new Map();
const envios = new Map();
const bodegaQueue = [];
const contadores = { cliente: 0, guia: 0 };

// ============================================================================
// 4. VALIDACIONES DE ENTRADA
//    Revisan datos vacíos, tipos, rangos y formatos. Cada validador devuelve
//    null si el dato es válido o un mensaje de error si no lo es.
// ============================================================================

function esVacio(valor) {
  return valor === undefined || valor === null || String(valor).trim() === '';
}

function normalizar(valor) {
  return String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function validarTexto(valor, campo, min = 3, max = 60) {
  if (esVacio(valor)) return `Error: ${campo} no puede estar vacío.`;
  const t = String(valor).trim();
  if (t.length < min || t.length > max) return `Error: ${campo} debe tener entre ${min} y ${max} caracteres.`;
  if (!/^[A-Za-zÁÉÍÓÚáéíóúÑñÜü .'-]+$/.test(t)) return `Error: ${campo} solo admite letras y espacios.`;
  return null;
}

function validarNumero(valor, campo, min, max) {
  if (esVacio(valor)) return `Error: ${campo} no puede estar vacío.`;
  const n = Number(valor);
  if (!Number.isFinite(n)) return `Error: ${campo} debe ser un número.`;
  if (n <= min || n > max) return `Error: ${campo} fuera de límite (mayor a ${min} y hasta ${max}).`;
  return null;
}

function validarTelefono(valor) {
  if (esVacio(valor)) return 'Error: El teléfono no puede estar vacío.';
  const limpio = String(valor).replace(/[\s-]/g, '');
  if (!/^\d{8}$/.test(limpio)) return 'Error: El teléfono debe tener 8 dígitos.';
  return null;
}

function buscarMunicipio(nombre) {
  if (esVacio(nombre)) return null;
  const buscado = normalizar(nombre);
  return MUNICIPIOS.find(m => normalizar(m) === buscado) || null;
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}

function ahora() {
  return new Date().toLocaleString('es-GT', { timeZone: 'America/Guatemala' });
}

// ============================================================================
// 5. REGISTRO DE CLIENTES Y VEHÍCULOS (Requisito 1)
//    Da de alta clientes (con código C001, C002...) y vehículos de la flota,
//    validando datos y evitando teléfonos o placas duplicadas.
// ============================================================================

function registrarCliente(nombre, telefono) {
  const error = validarTexto(nombre, 'El nombre') || validarTelefono(telefono);
  if (error) return { ok: false, mensaje: error };

  const tel = String(telefono).replace(/[\s-]/g, '');
  const duplicado = [...clientes.values()].some(c => c.telefono === tel);
  if (duplicado) return { ok: false, mensaje: `Error: Ya existe un cliente con el teléfono ${tel}.` };

  contadores.cliente++;
  const id = `C${String(contadores.cliente).padStart(3, '0')}`;
  const cliente = { id, nombre: String(nombre).trim(), telefono: tel };
  clientes.set(id, cliente);
  return { ok: true, mensaje: `Cliente registrado: ${id} - ${cliente.nombre}.`, datos: cliente };
}

function registrarVehiculo(placa, tipo) {
  if (esVacio(placa)) return { ok: false, mensaje: 'Error: La placa no puede estar vacía.' };
  if (esVacio(tipo)) return { ok: false, mensaje: 'Error: El tipo de vehículo no puede estar vacío.' };

  const placaLimpia = String(placa).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d{3}[A-Z]{3}$/.test(placaLimpia)) {
    return { ok: false, mensaje: 'Error: Formato de placa inválido (ej. P123ABC).' };
  }
  if (vehiculos.has(placaLimpia)) return { ok: false, mensaje: `Error: La placa ${placaLimpia} ya está registrada.` };

  const tipoLimpio = normalizar(tipo).replace(/[\s-]/g, '');
  if (!(tipoLimpio in TIPOS_VEHICULO)) {
    return { ok: false, mensaje: `Error: Tipo de vehículo inválido. Use: ${Object.keys(TIPOS_VEHICULO).join(', ')}.` };
  }

  const vehiculo = {
    placa: placaLimpia,
    tipo: tipoLimpio,
    capacidad: TIPOS_VEHICULO[tipoLimpio],
    carga: [],
    pesoActual: 0,
    kmRecorridos: 0,
    ubicacion: CENTRO,
    rutaPlan: null
  };
  vehiculos.set(placaLimpia, vehiculo);
  return {
    ok: true,
    mensaje: `Vehículo registrado: ${placaLimpia} (${tipoLimpio}, capacidad ${vehiculo.capacidad} kg).`,
    datos: vehiculo
  };
}

// ============================================================================
// 6. CÁLCULO DE COSTO POR TIPO DE SERVICIO (Requisito 2)
//    Costo = (base + porKg × pesoFacturable + porKm × distancia) × (1 + recargo).
//    El peso facturable es el mayor entre el peso real y el volumétrico.
// ============================================================================

function calcularCosto(tipo, peso, largo, ancho, alto, municipio) {
  const tarifa = TARIFAS[tipo];
  const pesoVolumetrico = (largo * ancho * alto) / FACTOR_VOLUMETRICO;
  const pesoFacturable = Math.max(peso, pesoVolumetrico);
  const distancia = rutaMasCorta(CENTRO, municipio).distancia;

  const subtotal = tarifa.base + tarifa.porKg * pesoFacturable + tarifa.porKm * distancia;
  const recargo = subtotal * tarifa.recargo;
  return {
    pesoVolumetrico: redondear(pesoVolumetrico),
    pesoFacturable: redondear(pesoFacturable),
    distancia,
    subtotal: redondear(subtotal),
    recargo: redondear(recargo),
    total: redondear(subtotal + recargo)
  };
}

// ============================================================================
// 7. REGISTRO DE ENVÍOS Y COLA DE PRIORIDAD (Requisitos 1 y 3)
//    Crea el envío con su guía, calcula el costo y lo encola en bodega:
//    los express pasan después del último express y antes de los demás;
//    el resto respeta el orden de llegada (FIFO).
// ============================================================================

function cambiarEstado(envio, estado, detalle = '') {
  envio.estado = estado;
  envio.historial.push({ estado, fecha: ahora(), detalle });
}

function encolarEnvio(envio) {
  if (envio.tipo === 'express') {
    const indiceNormal = bodegaQueue.findIndex(e => e.tipo !== 'express');
    if (indiceNormal === -1) bodegaQueue.push(envio);
    else bodegaQueue.splice(indiceNormal, 0, envio);
  } else {
    bodegaQueue.push(envio);
  }
}

function registrarEnvio(idRemitente, destinatario, peso, largo, ancho, alto, municipio, tipo) {
  if (esVacio(idRemitente)) return { ok: false, mensaje: 'Error: El código del remitente no puede estar vacío.' };
  const remitente = clientes.get(String(idRemitente).trim().toUpperCase());
  if (!remitente) return { ok: false, mensaje: 'Error: El remitente no está registrado como cliente.' };

  const error =
    validarTexto(destinatario, 'El destinatario') ||
    validarNumero(peso, 'El peso (kg)', 0, PESO_MAX_ENVIO) ||
    validarNumero(largo, 'El largo (cm)', 0, DIM_MAX_CM) ||
    validarNumero(ancho, 'El ancho (cm)', 0, DIM_MAX_CM) ||
    validarNumero(alto, 'El alto (cm)', 0, DIM_MAX_CM);
  if (error) return { ok: false, mensaje: error };

  const municipioOficial = buscarMunicipio(municipio);
  if (!municipioOficial) return { ok: false, mensaje: 'Error: Municipio destino no válido.' };

  if (esVacio(tipo)) return { ok: false, mensaje: 'Error: El tipo de servicio no puede estar vacío.' };
  const tipoLimpio = normalizar(tipo);
  if (!TIPOS_SERVICIO.includes(tipoLimpio)) {
    return { ok: false, mensaje: `Error: Tipo de servicio inválido. Use: ${TIPOS_SERVICIO.join(', ')}.` };
  }

  const [p, l, a, h] = [peso, largo, ancho, alto].map(Number);
  contadores.guia++;
  const guia = `RE-${String(contadores.guia).padStart(4, '0')}`;
  const costo = calcularCosto(tipoLimpio, p, l, a, h, municipioOficial);

  const envio = {
    guia,
    remitente: remitente.id,
    destinatario: String(destinatario).trim(),
    peso: p,
    dimensiones: { largo: l, ancho: a, alto: h },
    municipio: municipioOficial,
    tipo: tipoLimpio,
    costo,
    estado: null,
    historial: [],
    vehiculo: null
  };
  envios.set(guia, envio);
  cambiarEstado(envio, ESTADOS.RECIBIDO, `Recibido de ${remitente.nombre}`);
  encolarEnvio(envio);
  cambiarEstado(envio, ESTADOS.BODEGA, `Posición en cola: ${bodegaQueue.indexOf(envio) + 1}`);

  return {
    ok: true,
    mensaje: `Envío registrado: ${guia} | ${tipoLimpio} | ${p} kg (facturable ${costo.pesoFacturable} kg) | ` +
             `${municipioOficial} (${costo.distancia} km) | Costo: Q${costo.total.toFixed(2)}`,
    datos: envio
  };
}

// ============================================================================
// 8. RUTAS: DIJKSTRA Y RUTA DE REPARTO (Requisito 5)
//    Dijkstra calcula la ruta más corta entre municipios. Para varios
//    destinos se usa la heurística del vecino más cercano: se visita siempre
//    el destino pendiente más cercano y al final se regresa al centro.
// ============================================================================

function dijkstra(origen) {
  const distancias = {}, previos = {}, noVisitados = new Set(MUNICIPIOS);
  for (const m of MUNICIPIOS) { distancias[m] = Infinity; previos[m] = null; }
  distancias[origen] = 0;

  while (noVisitados.size > 0) {
    let actual = null;
    for (const m of noVisitados) {
      if (actual === null || distancias[m] < distancias[actual]) actual = m;
    }
    if (distancias[actual] === Infinity) break;
    noVisitados.delete(actual);

    for (const vecino in grafoMunicipios[actual]) {
      const alternativa = distancias[actual] + grafoMunicipios[actual][vecino];
      if (alternativa < distancias[vecino]) {
        distancias[vecino] = alternativa;
        previos[vecino] = actual;
      }
    }
  }
  return { distancias, previos };
}

function reconstruirCamino(previos, origen, destino) {
  const camino = [];
  let actual = destino;
  while (actual !== null) { camino.unshift(actual); actual = previos[actual]; }
  return camino[0] === origen ? camino : [];
}

function rutaMasCorta(origen, destino) {
  const o = buscarMunicipio(origen), d = buscarMunicipio(destino);
  if (!o) return { ok: false, mensaje: 'Error: Municipio de origen no válido.' };
  if (!d) return { ok: false, mensaje: 'Error: Municipio de destino no válido.' };
  const { distancias, previos } = dijkstra(o);
  if (distancias[d] === Infinity) return { ok: false, mensaje: `Error: No existe ruta de ${o} a ${d}.` };
  const ruta = reconstruirCamino(previos, o, d);
  return { ok: true, ruta, distancia: distancias[d], mensaje: `Ruta: ${ruta.join(' → ')} | Distancia: ${distancias[d]} km` };
}

function rutasDesdeCentro() {
  const { distancias, previos } = dijkstra(CENTRO);
  return MUNICIPIOS
    .filter(m => m !== CENTRO)
    .map(m => ({ municipio: m, distancia: distancias[m], ruta: reconstruirCamino(previos, CENTRO, m) }))
    .sort((a, b) => a.distancia - b.distancia);
}

function planificarReparto(origen, destinos) {
  const pendientes = [...new Set(destinos)];
  const orden = [];
  const recorrido = [origen];
  let actual = origen, total = 0;

  while (pendientes.length > 0) {
    const { distancias, previos } = dijkstra(actual);
    let mejor = 0;
    for (let i = 1; i < pendientes.length; i++) {
      if (distancias[pendientes[i]] < distancias[pendientes[mejor]]) mejor = i;
    }
    const siguiente = pendientes.splice(mejor, 1)[0];
    if (siguiente !== actual) {
      recorrido.push(...reconstruirCamino(previos, actual, siguiente).slice(1));
      total += distancias[siguiente];
    }
    orden.push(siguiente);
    actual = siguiente;
  }

  if (actual !== origen) {
    const { distancias, previos } = dijkstra(actual);
    recorrido.push(...reconstruirCamino(previos, actual, origen).slice(1));
    total += distancias[origen];
  }
  return { orden, recorrido, distanciaTotal: total };
}

// ============================================================================
// 9. CARGA Y DESCARGA DE VEHÍCULOS CON PILA LIFO (Requisito 4)
//    Al cargar se toman envíos del frente de la cola mientras quepan, se
//    planifica la ruta y se apilan en orden inverso al de entrega, para que
//    el primero en entregarse quede en el tope. Al entregar se saca el tope,
//    se suman los km y, al vaciarse, el vehículo regresa al centro.
// ============================================================================

function obtenerVehiculo(placa) {
  if (esVacio(placa)) return { error: 'Error: La placa no puede estar vacía.' };
  const v = vehiculos.get(String(placa).replace(/[\s-]/g, '').toUpperCase());
  return v ? { vehiculo: v } : { error: 'Error: Vehículo no registrado.' };
}

function cargarVehiculo(placa) {
  const { vehiculo: v, error } = obtenerVehiculo(placa);
  if (error) return { ok: false, mensaje: error };
  if (v.carga.length > 0) return { ok: false, mensaje: `Error: ${v.placa} aún tiene envíos en ruta.` };
  if (bodegaQueue.length === 0) return { ok: false, mensaje: 'Bodega vacía.' };

  const seleccion = [];
  let peso = 0;
  while (bodegaQueue.length > 0 && peso + bodegaQueue[0].peso <= v.capacidad) {
    const e = bodegaQueue.shift();
    seleccion.push(e);
    peso += e.peso;
  }
  if (seleccion.length === 0) {
    const e = bodegaQueue[0];
    return {
      ok: false,
      mensaje: `Error: Límite de peso excedido. ${e.guia} (${e.peso} kg) supera la capacidad de ${v.placa} ` +
               `(${v.capacidad} kg). Permanece en bodega.`
    };
  }

  const plan = planificarReparto(CENTRO, seleccion.map(e => e.municipio));
  seleccion.sort((a, b) => plan.orden.indexOf(a.municipio) - plan.orden.indexOf(b.municipio));

  for (let i = seleccion.length - 1; i >= 0; i--) {
    const e = seleccion[i];
    v.carga.push(e);
    e.vehiculo = v.placa;
    cambiarEstado(e, ESTADOS.RUTA, `Vehículo ${v.placa}`);
  }
  v.pesoActual = peso;
  v.rutaPlan = plan;

  let mensaje =
    `Vehículo ${v.placa} cargado: ${seleccion.length} envío(s), ${peso}/${v.capacidad} kg.\n` +
    `Orden de carga (fondo → tope): ${[...v.carga].map(e => e.guia).join(', ')}\n` +
    `Orden de entrega: ${[...v.carga].reverse().map(e => `${e.guia} (${e.municipio})`).join(' → ')}\n` +
    `Ruta planificada: ${plan.recorrido.join(' → ')} | Total: ${plan.distanciaTotal} km`;
  if (bodegaQueue.length > 0) {
    const e = bodegaQueue[0];
    mensaje += `\nAviso: ${e.guia} (${e.peso} kg) no cabe en la capacidad restante (${v.capacidad - peso} kg); permanece en bodega.`;
  }
  return { ok: true, mensaje };
}

function entregarSiguiente(placa, resultado = 'entregado') {
  const { vehiculo: v, error } = obtenerVehiculo(placa);
  if (error) return { ok: false, mensaje: error };
  if (v.carga.length === 0) return { ok: false, mensaje: `Vehículo ${v.placa} vacío.` };

  const res = normalizar(resultado);
  if (!['entregado', 'devuelto'].includes(res)) {
    return { ok: false, mensaje: 'Error: Resultado inválido. Use: entregado o devuelto.' };
  }

  const envio = v.carga.pop();
  const tramo = rutaMasCorta(v.ubicacion, envio.municipio);
  v.kmRecorridos += tramo.distancia;
  v.ubicacion = envio.municipio;
  v.pesoActual -= envio.peso;

  if (res === 'entregado') cambiarEstado(envio, ESTADOS.ENTREGADO, `Entregado a ${envio.destinatario} en ${envio.municipio}`);
  else cambiarEstado(envio, ESTADOS.DEVUELTO, 'Destinatario no localizado; regresa al centro');

  let mensaje = `${envio.guia} ${res} en ${envio.municipio} (+${tramo.distancia} km). Peso a bordo: ${v.pesoActual} kg.`;
  if (v.carga.length === 0) {
    const regreso = rutaMasCorta(v.ubicacion, CENTRO);
    v.kmRecorridos += regreso.distancia;
    v.ubicacion = CENTRO;
    v.rutaPlan = null;
    mensaje += `\nRuta finalizada. Regreso al centro (+${regreso.distancia} km). Km acumulados: ${v.kmRecorridos}.`;
  }
  return { ok: true, mensaje };
}

// ============================================================================
// 10. RASTREO POR GUÍA (Requisito 6)
//     Busca el envío en la tabla hash por su número de guía y muestra el
//     estado actual con el historial completo de cambios y fechas.
// ============================================================================

function rastrearEnvio(guia) {
  if (esVacio(guia)) return { ok: false, mensaje: 'Error: La guía no puede estar vacía.' };
  const g = String(guia).trim().toUpperCase();
  if (!/^RE-\d{4}$/.test(g)) return { ok: false, mensaje: 'Error: Formato de guía inválido (ej. RE-0001).' };
  const envio = envios.get(g);
  if (!envio) return { ok: false, mensaje: `Error: No existe el envío ${g}.` };

  const lineas = envio.historial.map((h, i) => `  ${i + 1}. ${h.estado.padEnd(10)} | ${h.fecha} | ${h.detalle}`);
  return {
    ok: true,
    datos: envio,
    mensaje: `Envío ${g} → ${envio.municipio} | Estado actual: ${envio.estado.toUpperCase()}\nHistorial:\n${lineas.join('\n')}`
  };
}

// ============================================================================
// 11. DATOS DE DEMOSTRACIÓN
//     Carga clientes, vehículos y envíos de ejemplo para probar el sistema
//     sin tener que ingresar todo a mano.
// ============================================================================

function cargarDatosDemo() {
  if (clientes.size > 0 || vehiculos.size > 0) return { ok: false, mensaje: 'Error: Ya existen datos registrados.' };
  registrarCliente('Ana López', '55123456');
  registrarCliente('Carlos Pérez', '44987654');
  registrarCliente('Lucía Méndez', '33221100');
  registrarVehiculo('M123ABC', 'moto');
  registrarVehiculo('P456DEF', 'pickup');
  registrarVehiculo('C789GHI', 'camion');
  registrarEnvio('C001', 'Jorge Ruiz', 4, 30, 20, 15, 'Mixco', 'estandar');
  registrarEnvio('C002', 'María Gil', 12, 40, 30, 30, 'Villa Nueva', 'fragil');
  registrarEnvio('C003', 'Pedro Sic', 2, 20, 15, 10, 'Amatitlán', 'express');
  registrarEnvio('C001', 'Sofía Ixcot', 25, 60, 40, 40, 'Fraijanes', 'estandar');
  registrarEnvio('C002', 'Luis Ajú', 8, 35, 25, 20, 'Chinautla', 'express');
  registrarEnvio('C003', 'Elena Tun', 15, 50, 40, 30, 'San José Pinula', 'fragil');
  return { ok: true, mensaje: 'Datos de demostración cargados: 3 clientes, 3 vehículos y 6 envíos (RE-0001 a RE-0006).' };
}

// ============================================================================
// 12. VISUALIZACIÓN
//     Arma los textos que se muestran en consola: la cola de bodega, la carga
//     de un vehículo y las rutas más cortas desde el centro.
// ============================================================================

function textoBodega() {
  if (bodegaQueue.length === 0) return 'Bodega vacía.';
  return 'Cola de bodega (frente → final):\n' + bodegaQueue
    .map((e, i) => `  ${i + 1}. ${e.guia} | ${e.tipo.padEnd(8)} | ${String(e.peso).padStart(5)} kg | ${e.municipio}`)
    .join('\n');
}

function textoVehiculo(placa) {
  const { vehiculo: v, error } = obtenerVehiculo(placa);
  if (error) return error;
  const encabezado = `${v.placa} (${v.tipo}) | ${v.pesoActual}/${v.capacidad} kg | Ubicación: ${v.ubicacion} | Km: ${v.kmRecorridos}`;
  if (v.carga.length === 0) return `${encabezado}\nVehículo vacío.`;
  return `${encabezado}\nCarga (tope → fondo):\n` + [...v.carga].reverse()
    .map((e, i) => `  ${i + 1}. ${e.guia} | ${e.peso} kg | ${e.municipio}`).join('\n') +
    `\nRuta planificada: ${v.rutaPlan.recorrido.join(' → ')} (${v.rutaPlan.distanciaTotal} km)`;
}

function textoRutasDesdeCentro() {
  return `Rutas más cortas desde el centro (${CENTRO}):\n` + rutasDesdeCentro()
    .map(r => `  ${r.municipio.padEnd(24)} ${String(r.distancia).padStart(3)} km  ${r.ruta.join(' → ')}`).join('\n');
}

// ============================================================================
// 13. MENÚ INTERACTIVO
//     Muestra las opciones en consola, pide los datos al usuario y llama a la
//     función correspondiente. También acepta entradas desde un archivo de
//     pruebas (node index.js < pruebas/caso1.txt).
// ============================================================================

function iniciarMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const lineas = [], esperando = [];
  let entradaCerrada = false;
  rl.on('line', l => (esperando.length ? esperando.shift()(l) : lineas.push(l)));
  rl.on('close', () => { entradaCerrada = true; while (esperando.length) esperando.shift()(null); });

  function pedir(texto) {
    process.stdout.write(texto);
    if (!process.stdin.isTTY) process.stdout.write('\n');
    if (lineas.length) return Promise.resolve(lineas.shift());
    if (entradaCerrada) return Promise.resolve(null);
    return new Promise(r => esperando.push(r));
  }

  const MENU = `
================ RUTA EXPRESS ================
 1. Registrar cliente
 2. Registrar vehículo
 3. Registrar envío
 4. Ver cola de bodega
 5. Cargar vehículo
 6. Ver carga de un vehículo
 7. Registrar entrega o devolución
 8. Rutas más cortas desde el centro
 9. Ruta más corta entre dos municipios
10. Rastrear envío
11. Cargar datos de demostración
 0. Salir
==============================================`;

  async function ciclo() {
    console.log(MENU);
    const r = await pedir('Seleccione una opción (0-11): ');
    const opcion = r === null ? '0' : r.trim();
    let salida;

    switch (opcion) {
      case '1':
        salida = registrarCliente(await pedir('Nombre completo: '), await pedir('Teléfono (8 dígitos): ')).mensaje;
        break;
      case '2':
        salida = registrarVehiculo(await pedir('Placa (ej. P123ABC): '),
          await pedir(`Tipo (${Object.keys(TIPOS_VEHICULO).join('/')}): `)).mensaje;
        break;
      case '3': {
        const remitente = await pedir('Código de cliente remitente (ej. C001): ');
        const destinatario = await pedir('Nombre del destinatario: ');
        const peso = await pedir(`Peso en kg (0-${PESO_MAX_ENVIO}]: `);
        const largo = await pedir('Largo en cm: ');
        const ancho = await pedir('Ancho en cm: ');
        const alto = await pedir('Alto en cm: ');
        console.log(`Municipios: ${MUNICIPIOS.join(', ')}`);
        const municipio = await pedir('Municipio destino: ');
        const tipo = await pedir(`Tipo de servicio (${TIPOS_SERVICIO.join('/')}): `);
        salida = registrarEnvio(remitente, destinatario, peso, largo, ancho, alto, municipio, tipo).mensaje;
        break;
      }
      case '4': salida = textoBodega(); break;
      case '5': salida = cargarVehiculo(await pedir('Placa del vehículo: ')).mensaje; break;
      case '6': salida = textoVehiculo(await pedir('Placa del vehículo: ')); break;
      case '7':
        salida = entregarSiguiente(await pedir('Placa del vehículo: '),
          await pedir('Resultado (entregado/devuelto) [Enter = entregado]: ') || 'entregado').mensaje;
        break;
      case '8': salida = textoRutasDesdeCentro(); break;
      case '9': {
        console.log(`Municipios: ${MUNICIPIOS.join(', ')}`);
        const o = await pedir(`Origen [Enter = ${CENTRO}]: `);
        salida = rutaMasCorta(esVacio(o) ? CENTRO : o, await pedir('Destino: ')).mensaje;
        break;
      }
      case '10': salida = rastrearEnvio(await pedir('Número de guía (ej. RE-0001): ')).mensaje; break;
      case '11': salida = cargarDatosDemo().mensaje; break;
      case '0':
        console.log('Saliendo del sistema. ¡Hasta pronto!');
        rl.close();
        return;
      default:
        salida = 'Error: Opción inválida. Ingrese un número del 0 al 11.';
    }
    console.log(salida);
    return ciclo();
  }
  ciclo();
}

// ============================================================================
// 14. ARRANQUE Y EXPORTACIÓN
//     Inicia el menú solo si el archivo se ejecuta directamente y exporta las
//     funciones para poder importarlas en pruebas.
// ============================================================================

if (require.main === module) iniciarMenu();

module.exports = {
  registrarCliente, registrarVehiculo, registrarEnvio, calcularCosto, cargarVehiculo,
  entregarSiguiente, rutaMasCorta, rutasDesdeCentro, planificarReparto, rastrearEnvio,
  cargarDatosDemo, bodegaQueue, envios, vehiculos, clientes, MUNICIPIOS
};