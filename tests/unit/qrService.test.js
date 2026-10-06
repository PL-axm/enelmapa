const qrService = require('../../services/qrService');

// La generación del QR estaba escrita dos veces, con los colores y el armado de
// la URL copiados a mano (E3). Ahora hay un solo lugar, y este test fija que la
// URL sale del dominio de config — no de una constante escrita en el handler.
describe('qrService', () => {
  const qr = qrService({ config: { domain: 'enelmapa.co' } });

  test('la URL del menú sale del dominio configurado', () => {
    expect(qr.menuUrl('caficultor')).toBe('https://enelmapa.co/s/caficultor');
  });

  test('un dominio distinto cambia la URL, sin tocar el servicio', () => {
    const otro = qrService({ config: { domain: 'staging.enelmapa.co' } });
    expect(otro.menuUrl('x')).toBe('https://staging.enelmapa.co/s/x');
  });

  test('forSlug devuelve la URL y el PNG en data-url', async () => {
    const { url, dataUrl } = await qr.forSlug('caficultor');

    expect(url).toBe('https://enelmapa.co/s/caficultor');
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  // Los dos consumidores necesitan la URL y el PNG juntos: el panel muestra la
  // URL debajo del código y el JSON la usa para el botón de descarga. Que salgan
  // de la misma llamada es lo que impide que uno arme una y el otro otra.
  test('el PNG codifica la URL del menú con la marca de origen QR', async () => {
    const { url, urlQr, dataUrl } = await qr.forSlug('el-silvestre-cm');

    expect(url).toBe('https://enelmapa.co/s/el-silvestre-cm');
    expect(urlQr).toBe(url + '?o=qr');

    const QRCode = require('qrcode');
    const esperado = await QRCode.toDataURL(urlQr, { margin: 2, color: { dark: '#1A1A18', light: '#FFFFFF' }, width: qrService.TAMAÑO_POR_DEFECTO });
    expect(dataUrl).toBe(esperado);
  });

  // La URL que el dueño lee y copia queda SIN el parámetro: si lo llevara, lo
  // que comparta en Instagram contaría como visita por QR.
  test('la URL para mostrar no lleva la marca de QR', async () => {
    const { url } = await qr.forSlug('x');
    expect(url).not.toContain('o=qr');
  });

  test('un tamaño mayor produce una imagen mayor', async () => {
    const chico = await qr.forSlug('x', { size: 100 });
    const grande = await qr.forSlug('x', { size: 600 });

    expect(grande.dataUrl.length).toBeGreaterThan(chico.dataUrl.length);
  });

  test('sin tamaño usa el default', async () => {
    const porDefecto = await qr.forSlug('x');
    const explicito = await qr.forSlug('x', { size: qrService.TAMAÑO_POR_DEFECTO });

    expect(porDefecto.dataUrl).toBe(explicito.dataUrl);
  });
});
