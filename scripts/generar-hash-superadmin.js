// Genera el valor de SUPER_PASS_HASH sin que la contraseña quede escrita en
// ningún lado.
//
//   node scripts/generar-hash-superadmin.js
//
// La contraseña se pide por teclado, sin mostrarse, y dos veces. No se pasa
// como argumento a propósito: un argumento queda en el historial de la
// terminal y en la lista de procesos. Lo único que se imprime es el hash, que
// es lo que va en la variable de entorno de cPanel.
//
// Corre en local: nunca en el servidor ni en un chat.

const readline = require('readline');
const bcrypt = require('bcryptjs');

const LARGO_MINIMO = 12;
// Mismo costo que usan las contraseñas de los admins de negocio.
const COSTO = 10;

function preguntarOculto(pregunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    process.stdout.write(pregunta);
    // Silencia el eco: lo que se teclea no aparece en pantalla.
    rl._writeToOutput = () => {};
    rl.question('', (respuesta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
  });
}

async function main() {
  const primera = await preguntarOculto('Nueva contraseña del superadmin: ');

  if (primera.length < LARGO_MINIMO) {
    console.error('Tiene que tener al menos ' + LARGO_MINIMO + ' caracteres. No se generó nada.');
    process.exit(1);
  }

  const segunda = await preguntarOculto('Repítela: ');
  if (primera !== segunda) {
    console.error('No coinciden. No se generó nada.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(primera, COSTO);

  // Se verifica antes de entregarlo: un hash que no valida la contraseña que
  // lo generó dejaría al superadmin afuera sin ninguna pista.
  if (!bcrypt.compareSync(primera, hash)) {
    console.error('El hash generado no verifica. No lo uses.');
    process.exit(1);
  }

  console.log('\nValor para SUPER_PASS_HASH (copia la línea completa, 60 caracteres):\n');
  console.log(hash);
  console.log('\nGuarda la contraseña en un lugar seguro: el hash no permite recuperarla.');
}

main();
