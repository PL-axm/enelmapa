const { AppError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } = require('../../errors');

describe('errores de dominio', () => {
  test.each([
    [ValidationError, 400],
    [UnauthorizedError, 401],
    [ForbiddenError, 403],
    [NotFoundError, 404]
  ])('%p lleva su status HTTP', (ErrorClass, statusCode) => {
    const err = new ErrorClass();
    expect(err.statusCode).toBe(statusCode);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  test('se marcan como esperados, para que el handler no los loguee con stack', () => {
    expect(new ForbiddenError().expected).toBe(true);
    // Un error cualquiera (bug, DB caída) no tiene la marca: ese sí es ruido
    // que hay que ver en la consola.
    expect(new Error('boom').expected).toBeUndefined();
  });

  test('aceptan un mensaje propio y traen uno por defecto', () => {
    expect(new ForbiddenError('La categoría no es tuya').message).toBe('La categoría no es tuya');
    expect(new NotFoundError().message).toBe('No encontrado');
  });

  test('el name refleja la clase (sirve en los logs)', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});
