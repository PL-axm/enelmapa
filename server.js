const { initDb } = require('./db/schema');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'enelmapa.co';

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('EnElMapa corriendo en puerto ' + PORT);
    console.log('Dominio: ' + DOMAIN);
  });
}).catch(err => {
  console.error('Error iniciando DB:', err);
  process.exit(1);
});
