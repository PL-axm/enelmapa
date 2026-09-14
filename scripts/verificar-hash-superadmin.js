// Comprueba EN LOCAL si una contraseña corresponde a un hash de SUPER_PASS_HASH,
// sin gastar intentos de login en producción (el superadmin permite 5 fallidos
// cada 15 minutos).
//
//   node scripts/verificar-hash-superadmin.js
//
// Sirve para separar dos causas de "la contraseña nueva no entra":
//   - Si aquí COINCIDE: el hash y la contraseña están bien, y el problema está
//     en cómo se guardó el valor en el servidor (por ejemplo, cPanel recortando
//     los `$`).
//   - Si aquí NO COINCIDE: la contraseña que se escribe no es la que se usó al
//     generar el hash.
//
// La contraseña se pide sin mostrarse y no se imprime nunca.

const readline = require('readline');
const bcrypt = require('bcryptjs');

const FORMATO_BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function preguntar(pregunta, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(pregunta);
    if (oculto) rl._writeToOutput = () => {};
    rl.question('', (respuesta) => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolve(respuesta);
    });
  });
}

async function main() {
  const pegado = await preguntar('Pega el hash (el mismo que pusiste en cPanel): ');
  const hash = pegado.trim();

  if (hash !== pegado) {
    console.log('AVISO: el valor pegado tenía espacios al principio o al final.');
  }
  if (!FORMATO_BCRYPT.test(hash)) {
    console.log('El hash NO tiene formato bcrypt válido (largo: ' + hash.length + ', esperado: 60).');
    process.exit(1);
  }

  const password = await preguntar('Escribe la contraseña nueva (no se ve): ', { oculto: true });
  console.log('Largo de lo que se capturó: ' + password.length + ' caracteres.');

  if (bcrypt.compareSync(password, hash)) {
    console.log('\nCOINCIDE: el hash y la contraseña están bien.');
    console.log('El problema está en cómo quedó guardado el valor en el servidor.');
  } else {
    console.log('\nNO COINCIDE: esa contraseña no es la que generó este hash.');
  }
}

main();
