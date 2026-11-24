'use strict';

/** Express 4 não captura rejeições de handlers async: encaminha para o handler de erros. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };