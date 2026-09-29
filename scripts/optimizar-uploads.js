// Convierte las fotos que YA están subidas: las que entraron antes de que la
// aplicación empezara a reducirlas al subir.
//
//   node scripts/optimizar-uploads.js                    (simulacro, no toca nada)
//   node scripts/optimizar-uploads.js --aplicar          (hace los cambios)
//   node scripts/optimizar-uploads.js --aplicar --minimo-kb 300
//
// Dos seguros, y los dos vienen de haber perdido las fotos de todos los
// negocios el 2026-09-09:
//
//   1. NO HACE NADA salvo que se pase --aplicar. Por defecto sólo informa qué
//      haría y cuánto se ahorraría.
//   2. Cada original se COPIA al respaldo antes de tocarlo, conservando su
//      ruta. Si algo sale mal, están todos ahí.
//
// Es repetible: una foto ya optimizada no vuelve a achicarse (el optimizador
// sólo reemplaza si el resultado pesa menos), así que correrlo dos veces no
// hace daño.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const imagenOptimizada = require('../services/imagenOptimizada');

// Un solo hilo: en un servidor compartido, sharp usando todos los núcleos hace
// que el proveedor limite la cuenta y el sitio se ponga lento para los clientes.
try { require('sharp').concurrency(1); } catch (e) { /* sin sharp no hay nada que limitar */ }

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i === -1 ? porDefecto : args[i + 1];
};

const APLICAR = args.includes('--aplicar');
// Pausa entre fotos, en milisegundos. El servidor es compartido y con límites
// de CPU por cuenta: procesar decenas de imágenes de 24 megapíxeles a toda
// velocidad puede hacer que el hosting frene la cuenta entera y el menú se
// ponga lento justo mientras corre la conversión. Con la pausa tarda más y no
// se nota desde afuera.
const PAUSA_MS = Number(opcion('--pausa', 250));
// Cuántas convertir como máximo en esta corrida. Permite hacerlo por tandas y
// ver el efecto antes de seguir.
const LIMITE = Number(opcion('--limite', Infinity));
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const DIR = path.resolve(opcion('--dir', path.join(__dirname, '..', 'uploads')));
const RESPALDO = path.resolve(opcion('--respaldo', path.join(DIR, '..', 'uploads-originales')));
const MINIMO_KB = Number(opcion('--minimo-kb', 200));

const EXTENSIONES = ['.jpg', '.jpeg', '.png', '.webp'];

function listarImagenes(dir) {
  const encontradas = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) encontradas.push(...listarImagenes(completa));
    else if (EXTENSIONES.includes(path.extname(entrada.name).toLowerCase())) encontradas.push(completa);
  }
  return encontradas;
}

function respaldar(ruta) {
  const relativa = path.relative(DIR, ruta);
  const destino = path.join(RESPALDO, relativa);
  // Si ya hay respaldo de esa foto, se respeta: es el original de la PRIMERA
  // corrida, y ese es el que interesa conservar.
  if (fs.existsSync(destino)) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(ruta, destino);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error('No existe la carpeta ' + DIR);
    process.exit(1);
  }
  if (!imagenOptimizada.disponible()) {
    console.error('sharp no está disponible en este entorno; no se puede optimizar.');
    process.exit(1);
  }

  const todas = listarImagenes(DIR).filter(r => fs.statSync(r).size > MINIMO_KB * 1024);
  const imagenes = Number.isFinite(LIMITE) ? todas.slice(0, LIMITE) : todas;

  console.log((APLICAR ? 'APLICANDO' : 'SIMULACRO (nada se modifica)') + ' sobre ' + DIR);
  console.log('candidatas: ' + imagenes.length + ' de ' + todas.length + ' fotos de más de ' + MINIMO_KB + ' KB');
  if (APLICAR && PAUSA_MS) console.log('pausa entre fotos: ' + PAUSA_MS + ' ms (para no saturar el servidor)');
  if (APLICAR) console.log('respaldo de originales en: ' + RESPALDO);
  console.log('');

  let antesTotal = 0, despuesTotal = 0, cambiadas = 0, fallidas = 0;

  for (const ruta of imagenes) {
    const antes = fs.statSync(ruta).size;
    antesTotal += antes;

    if (!APLICAR) {
      // El simulacro mide de verdad: optimiza una copia y compara. La copia va
      // al directorio temporal del sistema y NO al lado del original —
      // escribir dentro de uploads/ es exactamente lo que no debe hacer un
      // proceso que promete no tocar nada.
      const copia = path.join(os.tmpdir(), 'simulacro-' + crypto.randomUUID() + path.extname(ruta));
      fs.copyFileSync(ruta, copia);
      const r = await imagenOptimizada.optimizar(copia);
      despuesTotal += r.optimizada ? r.despues : antes;
      if (r.optimizada) cambiadas++;
      // El simulacro también informa lo que falla. La primera versión callaba,
      // y un error que hacía fracasar TODAS las conversiones se leyó como "el
      // ahorro es modesto" en vez de como un problema.
      else if (r.motivo && !r.motivo.startsWith('ya estaba') && !r.motivo.startsWith('formato')) {
        fallidas++;
        console.log('  ' + path.relative(DIR, ruta) + ': fallaría (' + r.motivo + ')');
      }
      // En Windows el archivo puede quedar tomado un instante después de
      // procesarlo; si no se puede borrar, lo limpia el sistema.
      try { fs.unlinkSync(copia); } catch (e) { /* lo limpia el sistema */ }
      continue;
    }

    respaldar(ruta);
    const r = await imagenOptimizada.optimizar(ruta);
    if (r.optimizada) {
      cambiadas++;
      despuesTotal += r.despues;
      console.log('  ' + path.relative(DIR, ruta) + ': ' + Math.round(antes / 1024) + ' KB -> ' + Math.round(r.despues / 1024) + ' KB');
      if (PAUSA_MS) await esperar(PAUSA_MS);
    } else {
      despuesTotal += antes;
      if (r.motivo && !r.motivo.startsWith('ya estaba')) {
        fallidas++;
        console.log('  ' + path.relative(DIR, ruta) + ': SIN CAMBIOS (' + r.motivo + ')');
      }
    }
  }

  console.log('');
  console.log('fotos modificadas: ' + cambiadas + (fallidas ? ' | con problemas: ' + fallidas : ''));
  console.log('peso: ' + mb(antesTotal) + ' -> ' + mb(despuesTotal) +
              '  (ahorro ' + mb(antesTotal - despuesTotal) + ')');
  if (!APLICAR) console.log('\nNo se modificó nada. Para hacerlo: agrega --aplicar');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
