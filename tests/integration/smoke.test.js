const request = require('supertest');
const { createTestApp } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');

const app = createTestApp();

describe('smoke test', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  // Host: 'localhost' a propósito — el Host default de supertest/agentes
  // HTTP sin dominio real (ej. una IP tipo 127.0.0.1) tiene 3+ partes
  // separadas por punto y hace que app.js lo confunda con un subdominio de
  // negocio (ver getSubdomain en app.js), devolviendo 404 de "negocio no
  // encontrado" en vez de la home. 'localhost' (1 parte) evita ese falso
  // positivo, igual que pasaría con cualquier hostname real sin subdominio.
  test('GET / responde 200 y renderiza la home', async () => {
    const res = await request(app).get('/').set('Host', 'localhost');
    expect(res.status).toBe(200);
  });

  test('ruta inexistente responde 404', async () => {
    const res = await request(app).get('/esto-no-existe').set('Host', 'localhost');
    expect(res.status).toBe(404);
  });
});
