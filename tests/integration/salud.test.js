const request = require('supertest');
const { createApp } = require('../../app');
const { getTestContainer, createTestApp } = require('../helpers/container');
const { closeDb } = require('../helpers/db');

// /salud es lo que consulta el monitor externo. La caída del 2026-09-09 la
// descubrió el dueño y no un aviso, mientras el panel de cPanel decía que la
// app estaba "started".

// La app real con un repositorio de salud sustituido, para simular una base
// caída o colgada sin tocar la base de los tests.
function appConPing(ping) {
  const container = getTestContainer();
  return createApp({ ...container, repos: { ...container.repos, salud: { ping } } });
}

describe('/salud', () => {
  afterAll(async () => {
    await closeDb();
  });

  test('con la base respondiendo: 200', async () => {
    const res = await request(createTestApp()).get('/salud').set('Host', 'localhost');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
  });

  test('con la base caída: 503, sin tirar el proceso y sin detalles', async () => {
    const app = appConPing(async () => {
      throw new Error("Access denied for user 'root'@'localhost'");
    });
    const res = await request(app).get('/salud').set('Host', 'localhost');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ estado: 'error' });
    // Es público: el motivo va al log, nunca a la respuesta.
    expect(res.text).not.toContain('Access denied');
  });

  test('con la base colgada: 503 dentro del tiempo máximo, no espera para siempre', async () => {
    const app = appConPing(() => new Promise(() => {}));
    const inicio = Date.now();
    const res = await request(app).get('/salud').set('Host', 'localhost');

    expect(res.status).toBe(503);
    expect(Date.now() - inicio).toBeLessThan(5000);
  });

  test('no se cachea y no crea sesión', async () => {
    const res = await request(createTestApp()).get('/salud').set('Host', 'localhost');
    // Un caché que respondiera "ok" por un sitio caído anularía el monitor.
    expect(res.headers['cache-control']).toBe('no-store');
    // El monitor pega cada pocos minutos: cada visita no puede sumar una fila
    // a la tabla de sesiones.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('también responde desde el subdominio de un negocio', async () => {
    // El middleware de subdominios sólo intercepta "/", así que /salud tiene
    // que llegar igual aunque el monitor apunte a un subdominio.
    const res = await request(createTestApp()).get('/salud').set('Host', 'caficultor.enelmapa.co');
    expect(res.status).toBe(200);
  });
});
