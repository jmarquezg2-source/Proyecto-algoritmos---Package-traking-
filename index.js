const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const bodegaQueue = [];
const vehiculoStack = [];
const CAPACIDAD_MAXIMA = 50;
let pesoActual = 0;

const grafoRutas = {
    'Bodega Central': { 'Mixco': 12, 'Villa Nueva': 18, 'Zona 1': 8 },
    'Mixco': { 'Bodega Central': 12, 'San Juan': 10 },
    'Villa Nueva': { 'Bodega Central': 18, 'Amatitlán': 15 },
    'Zona 1': { 'Bodega Central': 8, 'Zona 10': 5 },
    'San Juan': { 'Mixco': 10 },
    'Amatitlán': { 'Villa Nueva': 15 },
    'Zona 10': { 'Zona 1': 5 }
};
const destinosValidos = Object.keys(grafoRutas);
function encolarPaquete(guia, tipo, peso, destino) {
    if (!['estandar', 'express', 'fragil'].includes(tipo)) return "Error: Tipo inválido.";
    if (isNaN(peso) || peso <= 0 || peso > CAPACIDAD_MAXIMA) return "Error: Peso fuera de límite.";
    if (!destinosValidos.includes(destino)) return "Error: Destino no válido.";

    const paquete = { guia, tipo, peso: Number(peso), destino };
    
    if (tipo === 'express') {
        const indiceNormal = bodegaQueue.findIndex(p => p.tipo !== 'express');
        if (indiceNormal === -1) bodegaQueue.push(paquete);
        else bodegaQueue.splice(indiceNormal, 0, paquete);
    } else {
        bodegaQueue.push(paquete);
    }
    return `Paquete ${guia} ingresado a bodega.`;
}
function cargarVehiculo() {
    if (bodegaQueue.length === 0) return "Bodega vacía.";
    const proximo = bodegaQueue[0];
    
    if (pesoActual + proximo.peso > CAPACIDAD_MAXIMA) {
        return `Límite excedido. Capacidad restante: ${CAPACIDAD_MAXIMA - pesoActual}kg.`;
    }

    const paquete = bodegaQueue.shift();
    vehiculoStack.push(paquete);
    pesoActual += paquete.peso;
    return `Cargado: ${paquete.guia} (${paquete.peso}kg). Peso total: ${pesoActual}kg.`;
}
function calcularRutaOptima(inicio, destino) {
    const distancias = {}, previos = {}, noVisitados = new Set(destinosValidos);
    for (let nodo of noVisitados) { distancias[nodo] = Infinity; previos[nodo] = null; }
    distancias[inicio] = 0;

    while (noVisitados.size > 0) {
        let nodoActual = null;
        for (let nodo of noVisitados) {
            if (nodoActual === null || distancias[nodo] < distancias[nodoActual]) nodoActual = nodo;
        }
        if (nodoActual === null || distancias[nodoActual] === Infinity || nodoActual === destino) break;
        noVisitados.delete(nodoActual);

        for (let vecino in grafoRutas[nodoActual]) {
            const alt = distancias[nodoActual] + grafoRutas[nodoActual][vecino];
            if (alt < distancias[vecino]) { distancias[vecino] = alt; previos[vecino] = nodoActual; }
        }
    }
    const ruta = [];
    let actual = destino;
    while (actual) { ruta.unshift(actual); actual = previos[actual]; }
    return { ruta, distancia: distancias[destino] };
}
function mostrarMenu() {
    console.log('\n--- RUTA EXPRESS ---\n1. Ingresar paquete\n2. Cargar camión\n3. Calcular ruta\n4. Ver estado\n5. Salir');
    rl.question("Opción: ", (opcion) => {
        if (opcion === '1') {
            rl.question("Guía: ", guia => rl.question("Tipo (estandar/express/fragil): ", tipo => rl.question("Peso: ", peso => rl.question("Destino: ", destino => {
                console.log(encolarPaquete(guia, tipo.toLowerCase(), parseFloat(peso), destino));
                mostrarMenu();
            }))));
        } else if (opcion === '2') {
            console.log(cargarVehiculo());
            mostrarMenu();
        } else if (opcion === '3') {
            rl.question("Destino desde Bodega Central: ", destino => {
                if (!destinosValidos.includes(destino)) console.log("Destino inválido.");
                else {
                    const res = calcularRutaOptima('Bodega Central', destino);
                    console.log(`Ruta: ${res.ruta.join(' -> ')} | Total: ${res.distancia}km`);
                }
                mostrarMenu();
            });
        } else if (opcion === '4') {
            console.log("\nBODEGA:", bodegaQueue);
            console.log("CAMIÓN (LIFO):", vehiculoStack.slice().reverse());
            mostrarMenu();
        } else if (opcion === '5') {
            rl.close();
        } else {
            mostrarMenu();
        }
    });
}
mostrarMenu();
