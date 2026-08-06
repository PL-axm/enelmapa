const { getSubdomain } = require('../../services/subdomain');

describe('getSubdomain', () => {
  test('extrae el slug de un subdominio de negocio', () => {
    expect(getSubdomain('caficultor.enelmapa.co')).toBe('caficultor');
  });

  test('excluye "www" (reservado de la plataforma)', () => {
    expect(getSubdomain('www.enelmapa.co')).toBeNull();
  });

  test('excluye "admin" (reservado del panel admin)', () => {
    expect(getSubdomain('admin.enelmapa.co')).toBeNull();
  });

  test('dominio raíz sin subdominio (solo 2 partes) devuelve null', () => {
    expect(getSubdomain('enelmapa.co')).toBeNull();
  });

  test('hostname sin punto (ej. localhost) devuelve null', () => {
    expect(getSubdomain('localhost')).toBeNull();
  });

  test('comportamiento actual con 4+ partes: toma la primera (documentado, no "arreglado")', () => {
    expect(getSubdomain('a.b.enelmapa.co')).toBe('a');
  });
});
