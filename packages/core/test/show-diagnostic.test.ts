import { expect, it } from 'vitest';
import { showErrorDiagnostic } from '../src/show-diagnostic';

it('retains fixed messages and numeric statuses without serializing error properties', () => {
  const error = Object.assign(new Error('fal show: provider'), {
    name: 'FalShowError',
    httpStatus: 429,
    requestId: 'private-id',
    cause: new Error('https://private.test/?key=secret'),
    media: 'data:image/png;base64,PRIVATE',
  });
  expect(showErrorDiagnostic(error)).toEqual({
    errorClass: 'FalShowError',
    message: 'fal show: provider',
    httpStatus: 429,
  });
  expect(showErrorDiagnostic(new Error('show generation lease lost')).message).toBe(
    'show generation lease lost',
  );
  expect(showErrorDiagnostic(new Error('put: rate limited (10058)')).storageCode).toBe(10058);
  expect(
    showErrorDiagnostic(Object.assign(new Error('private validation input'), { name: 'ZodError' })),
  ).toEqual({ errorClass: 'ZodError', message: 'Schema validation failed' });
});

it.each([
  'https://private.test/path?key=arbitrary-secret',
  'Bearer arbitrary-secret',
  'Key arbitrary-secret',
  'data:image/png;base64,PRIVATE',
  'show generation lease lost\nAuthorization: arbitrary-secret',
  'D1_ERROR: SQL containing arbitrary-secret',
])('redacts untrusted message %s and custom class names', (message) => {
  const error = Object.assign(new Error(message), {
    name: 'arbitrary-secret',
    httpStatus: 'secret',
  });
  const diagnostic = showErrorDiagnostic(error);
  expect(diagnostic.errorClass).toBe('UnknownError');
  expect(diagnostic).not.toHaveProperty('httpStatus');
  expect(JSON.stringify(diagnostic)).not.toMatch(/arbitrary-secret|PRIVATE|private\.test/);
});
