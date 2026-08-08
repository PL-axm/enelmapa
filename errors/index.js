// Errores de dominio. La idea es que las rutas (y más adelante los servicios
// y repositories) puedan decir *qué* salió mal sin saber nada de HTTP, y que
// un único lugar — middleware/errorHandler.js — traduzca eso a un status y a
// un formato de respuesta.
//
// `expected: true` distingue "esto es una condición prevista del negocio"
// (categoría ajena, negocio inexistente) de "esto es un bug o la DB se cayó".
// Los primeros no ensucian los logs con stack traces; los segundos sí.

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.expected = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Datos inválidos') {
    super(message, 400);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'No tenés permiso para esto') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'No encontrado') {
    super(message, 404);
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiados intentos. Esperá unos minutos.') {
    super(message, 429);
  }
}

module.exports = {
  AppError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, TooManyRequestsError
};
