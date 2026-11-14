'use strict';
const { clean } = require('./validate');
const { HttpError } = require('./http');

function feedbackFields(body = {}) {
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 ||
      (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 1000))) {
    throw new HttpError(422, 'validation', 'Choose a whole rating from 1 to 5 and an optional comment up to 1000 characters.');
  }
  return { rating: body.rating, comment: clean(body.comment, 1000) };
}

module.exports = { feedbackFields };
