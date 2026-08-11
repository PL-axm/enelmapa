const { createLogger } = require('../../services/logger');

// Cubre E8. Lo que se fija acá es lo que hacía falta y no había: nivel, hora, y
// que el nivel filtre de verdad para poder bajar el ruido en producción.
describe('logger', () => {
  let salidas;

  beforeEach(() => {
    salidas = { error: [], warn: [], log: [] };
    for (const metodo of ['error', 'warn', 'log']) {
      jest.spyOn(console, metodo).mockImplementation((...args) => salidas[metodo].push(args));
    }
  });

  afterEach(() => jest.restoreAllMocks());

  test('cada nivel va a la salida que le corresponde', () => {
    const log = createLogger({ level: 'debug' });
    log.error('un error');
    log.warn('un aviso');
    log.info('info');
    log.debug('debug');

    expect(salidas.error).toHaveLength(1);
    expect(salidas.warn).toHaveLength(1);
    expect(salidas.log).toHaveLength(2);
  });

  // Que error vaya a stderr y el resto a stdout importa bajo Passenger, que los
  // separa.
  test('los errores van por stderr y la información por stdout', () => {
    const log = createLogger({ level: 'debug' });
    log.error('a stderr');
    log.info('a stdout');

    expect(salidas.error[0][0]).toContain('a stderr');
    expect(salidas.log[0][0]).toContain('a stdout');
  });

  test('cada línea lleva hora ISO y nivel', () => {
    createLogger().warn('algo pasó');

    expect(salidas.warn[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN algo pasó$/);
  });

  describe('el nivel filtra', () => {
    test('con level=warn no salen info ni debug', () => {
      const log = createLogger({ level: 'warn' });
      log.error('sí'); log.warn('sí'); log.info('no'); log.debug('no');

      expect(salidas.error).toHaveLength(1);
      expect(salidas.warn).toHaveLength(1);
      expect(salidas.log).toHaveLength(0);
    });

    test('con level=error sólo salen errores', () => {
      const log = createLogger({ level: 'error' });
      log.error('sí'); log.warn('no');

      expect(salidas.error).toHaveLength(1);
      expect(salidas.warn).toHaveLength(0);
    });

    test('un nivel desconocido cae a info en vez de silenciar todo', () => {
      const log = createLogger({ level: 'inventado' });
      log.info('debe salir'); log.debug('no debe');

      expect(salidas.log).toHaveLength(1);
    });
  });

  test('silent apaga todo, que es lo que usa la suite', () => {
    const log = createLogger({ level: 'debug', silent: true });
    log.error('x'); log.warn('x'); log.info('x');
    log.excepcion('x', new Error('y'));

    expect(salidas.error).toHaveLength(0);
    expect(salidas.warn).toHaveLength(0);
    expect(salidas.log).toHaveLength(0);
  });

  describe('contexto', () => {
    test('se agrega como JSON al final', () => {
      createLogger().warn('403', { url: '/api/x', status: 403 });

      expect(salidas.warn[0][0]).toContain('{"url":"/api/x","status":403}');
    });

    // Un objeto vacío en cada línea haría el log más difícil de leer, que es lo
    // contrario de lo que se busca.
    test('un contexto vacío no ensucia la línea', () => {
      createLogger().warn('sin contexto', {});

      expect(salidas.warn[0][0]).not.toContain('{}');
      expect(salidas.warn[0][0]).toMatch(/WARN sin contexto$/);
    });
  });

  // El stack es lo único que delata dónde está un bug, así que va aparte del
  // mensaje y no se pierde en la serialización del contexto.
  test('excepcion escribe el mensaje y el error por separado', () => {
    const err = new Error('la DB explotó');
    createLogger().excepcion('Error no previsto', err, { url: '/api/x' });

    expect(salidas.error).toHaveLength(2);
    expect(salidas.error[0][0]).toContain('Error no previsto');
    expect(salidas.error[0][0]).toContain('/api/x');
    expect(salidas.error[1][0]).toBe(err);
  });
});
