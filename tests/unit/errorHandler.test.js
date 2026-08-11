const { createErrorHandler, wantsJson } = require('../../middleware/errorHandler');
const { ForbiddenError, NotFoundError } = require('../../errors');
const { createLogger } = require('../../services/logger');

// La config y el logger entran inyectados: antes el handler importaba el
// singleton de config y escribía con `console.error` suelto, así que ni la rama
// de producción ni el formato del log se podían ejercitar desde un unit test.
//
// El logger va explícitamente NO silencioso: la suite corre con LOG_SILENT, y
// acá justamente se quiere ver que escribe.
const logger = createLogger({ level: 'debug', silent: false });
const errorHandler = createErrorHandler({ config: { isProduction: false }, logger });
const errorHandlerEnProduccion = createErrorHandler({ config: { isProduction: true }, logger });

function fakeReq({ url = '/admin/products', accept = 'text/html', xhr = false } = {}) {
  return { method: 'GET', originalUrl: url, xhr, get: () => accept };
}

function fakeRes() {
  const res = {
    headersSent: false,
    statusCode: null,
    jsonBody: null,
    renderedView: null,
    renderedLocals: null
  };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.jsonBody = body; return res; };
  res.render = (view, locals) => { res.renderedView = view; res.renderedLocals = locals; return res; };
  return res;
}

describe('wantsJson', () => {
  test('todo lo que cuelga de /api es JSON', () => {
    expect(wantsJson(fakeReq({ url: '/api/products/3' }))).toBe(true);
  });

  test('las páginas del panel no', () => {
    expect(wantsJson(fakeReq({ url: '/admin/products' }))).toBe(false);
  });

  test('también responde JSON si el cliente lo pidió por Accept', () => {
    expect(wantsJson(fakeReq({ url: '/admin/products', accept: 'application/json' }))).toBe(true);
  });
});

describe('errorHandler', () => {
  let consoleError;
  let consoleWarn;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('un error de dominio en /api sale como JSON con su status', () => {
    const res = fakeRes();
    errorHandler(new ForbiddenError('La categoría no es tuya'), fakeReq({ url: '/api/products' }), res, () => {});

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toEqual({ ok: false, error: 'La categoría no es tuya' });
  });

  test('el mismo error en una página se renderiza como vista', () => {
    const res = fakeRes();
    errorHandler(new NotFoundError('Negocio no encontrado'), fakeReq({ url: '/s/no-existe' }), res, () => {});

    expect(res.statusCode).toBe(404);
    expect(res.renderedView).toBe('404');
    expect(res.renderedLocals).toEqual({ message: 'Negocio no encontrado' });
  });

  test('un error inesperado es 500 y se loguea con stack', () => {
    const res = fakeRes();
    errorHandler(new Error('la DB explotó'), fakeReq({ url: '/api/categories' }), res, () => {});

    expect(res.statusCode).toBe(500);
    expect(consoleError).toHaveBeenCalled();
  });

  test('los errores previstos se loguean sin stack (console.warn)', () => {
    errorHandler(new ForbiddenError(), fakeReq({ url: '/api/products' }), fakeRes(), () => {});

    expect(consoleWarn).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  // Un 500 puede traer SQL o rutas del filesystem en el mensaje. Los errores
  // previstos no: su mensaje está escrito para que lo lea el usuario.
  test('en producción el mensaje de un 500 se enmascara', () => {
    const res = fakeRes();
    errorHandlerEnProduccion(new Error('ER_ACCESS_DENIED para root@localhost'), fakeReq({ url: '/api/categories' }), res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ ok: false, error: 'Error interno' });
  });

  test('en producción un error de dominio conserva su mensaje', () => {
    const res = fakeRes();
    errorHandlerEnProduccion(new ForbiddenError('La categoría no es tuya'), fakeReq({ url: '/api/products' }), res, () => {});

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toEqual({ ok: false, error: 'La categoría no es tuya' });
  });

  test('si la respuesta ya empezó, delega en Express en vez de romper', () => {
    const res = fakeRes();
    res.headersSent = true;
    const next = jest.fn();

    errorHandler(new Error('tarde'), fakeReq(), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });
});
