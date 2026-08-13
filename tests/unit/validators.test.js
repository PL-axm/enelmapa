const { schemas, SLUGS_RESERVADOS } = require('../../validators');
const tema = require('../../theme');

// Los esquemas son puros: se prueban sin DB ni HTTP. Lo que se fija acá es el
// contrato del borde — qué entra, qué se rechaza, y con qué tipo sale.
describe('validators', () => {
  const ok = (schema, datos) => {
    const r = schema.safeParse(datos);
    if (!r.success) throw new Error('Debía pasar y falló: ' + r.error.issues[0].message);
    return r.data;
  };
  const falla = (schema, datos) => {
    const r = schema.safeParse(datos);
    expect(r.success).toBe(false);
    return r.error.issues[0].message;
  };

  describe('precio (hallazgo B5)', () => {
    // Era el bug: parseFloat('abc') da NaN, NaN llegaba a una columna DECIMAL
    // y MySQL respondía con error — un 500 por un dato mal escrito.
    test('un precio no numérico se rechaza en el borde', () => {
      expect(falla(schemas.productCreate, { name: 'X', price: 'abc', category_id: '1' }))
        .toMatch(/número/);
    });

    test('un precio negativo se rechaza', () => {
      expect(falla(schemas.productCreate, { name: 'X', price: '-5', category_id: '1' }))
        .toMatch(/negativo/);
    });

    // Los formularios mandan todo como texto: el esquema tiene que convertirlo,
    // porque de eso depende que el handler ya no haga parseFloat.
    test('un precio en texto sale como número', () => {
      const datos = ok(schemas.productCreate, { name: 'X', price: '20000', category_id: '3' });
      expect(datos.price).toBe(20000);
      expect(typeof datos.price).toBe('number');
      expect(datos.category_id).toBe(3);
    });

    test('el 0 se acepta: hay productos de cortesía', () => {
      expect(ok(schemas.productCreate, { name: 'X', price: '0', category_id: '1' }).price).toBe(0);
    });

    test('un precio absurdo se rechaza antes de desbordar la columna', () => {
      expect(falla(schemas.productCreate, { name: 'X', price: '999999999999', category_id: '1' }))
        .toMatch(/alto/);
    });
  });

  describe('slug (hallazgo S7)', () => {
    const base = {
      name: 'Negocio', admin_email: 'a@b.co', admin_password: 'clave1234'
    };

    test('acepta minúsculas, números y guiones internos', () => {
      for (const s of ['el-silvestre-cm', 'cafe123', 'a-b-c']) {
        expect(ok(schemas.businessCreate, { ...base, slug: s }).slug).toBe(s);
      }
    });

    test('normaliza mayúsculas y espacios alrededor', () => {
      expect(ok(schemas.businessCreate, { ...base, slug: '  El-Silvestre  ' }).slug).toBe('el-silvestre');
    });

    test('rechaza espacios, acentos, guiones al borde y caracteres raros', () => {
      for (const s of ['con espacio', 'acentué', '-empieza', 'termina-', 'do--ble', 'con/slash', 'con_guion_bajo']) {
        expect(schemas.businessCreate.safeParse({ ...base, slug: s }).success).toBe(false);
      }
    });

    test('rechaza slugs demasiado cortos', () => {
      expect(falla(schemas.businessCreate, { ...base, slug: 'a' })).toMatch(/2 caracteres/);
    });

    // El motivo concreto: getSubdomain() excluye 'www' y 'admin' para
    // reservarlos, así que un negocio con esos slugs quedaría inalcanzable por
    // subdominio — la URL existiría pero resolvería a la home.
    test('rechaza los slugs reservados por la plataforma', () => {
      for (const s of SLUGS_RESERVADOS) {
        expect(falla(schemas.businessCreate, { ...base, slug: s })).toMatch(/reservado/);
      }
    });

    test('www y admin están entre los reservados, que es el caso que importa', () => {
      expect(SLUGS_RESERVADOS).toContain('www');
      expect(SLUGS_RESERVADOS).toContain('admin');
    });
  });

  describe('credenciales del admin', () => {
    const base = { slug: 'valido', name: 'N' };

    test('exige un email con forma de email', () => {
      expect(falla(schemas.businessCreate, { ...base, admin_email: 'no-es-email', admin_password: 'clave1234' }))
        .toMatch(/email/);
    });

    test('normaliza el email a minúsculas', () => {
      expect(ok(schemas.businessCreate, { ...base, admin_email: 'Admin@Negocio.CO', admin_password: 'clave1234' }).admin_email)
        .toBe('admin@negocio.co');
    });

    test('exige contraseña de al menos 8 caracteres', () => {
      expect(falla(schemas.businessCreate, { ...base, admin_email: 'a@b.co', admin_password: 'corta' }))
        .toMatch(/8 caracteres/);
    });
  });

  describe('nombres', () => {
    test('un nombre vacío o de sólo espacios se rechaza', () => {
      expect(falla(schemas.categoryName, { name: '' })).toMatch(/vacío/);
      expect(falla(schemas.categoryName, { name: '   ' })).toMatch(/vacío/);
    });

    test('se recortan los espacios de los extremos', () => {
      expect(ok(schemas.categoryName, { name: '  Bebidas  ' }).name).toBe('Bebidas');
    });

    test('un nombre larguísimo se rechaza antes de truncarse en la columna', () => {
      expect(falla(schemas.categoryName, { name: 'x'.repeat(300) })).toMatch(/255/);
    });
  });

  describe('reorder', () => {
    test('convierte los ids a enteros', () => {
      expect(ok(schemas.reorder, { order: ['3', '1', '2'] }).order).toEqual([3, 1, 2]);
    });

    test('rechaza lo que no es un array', () => {
      expect(schemas.reorder.safeParse({ order: 'reorder' }).success).toBe(false);
      expect(schemas.reorder.safeParse({}).success).toBe(false);
    });

    test('rechaza ids no positivos', () => {
      expect(schemas.reorder.safeParse({ order: [1, 0] }).success).toBe(false);
      expect(schemas.reorder.safeParse({ order: [1, -2] }).success).toBe(false);
    });
  });

  describe('horarios de settings', () => {
    const base = { name: 'Negocio' };

    test('parsea el JSON y valida cada día', () => {
      const datos = ok(schemas.settings, {
        ...base,
        hours: JSON.stringify([{ day_index: 1, open_time: '08:00', close_time: '20:00', is_closed: false }])
      });
      expect(datos.hours[0].open_time).toBe('08:00');
      expect(datos.hours[0].is_closed).toBe(0);
    });

    test('un JSON malformado da un mensaje claro, no una excepción', () => {
      expect(falla(schemas.settings, { ...base, hours: '{roto' })).toMatch(/JSON válido/);
    });

    test('una hora con formato inválido se rechaza', () => {
      expect(falla(schemas.settings, {
        ...base,
        hours: JSON.stringify([{ day_index: 1, open_time: '25:99', close_time: '20:00' }])
      })).toMatch(/Hora inválida/);
    });

    test('un day_index fuera de 0..6 se rechaza', () => {
      expect(schemas.settings.safeParse({
        ...base,
        hours: JSON.stringify([{ day_index: 9, open_time: '08:00', close_time: '20:00' }])
      }).success).toBe(false);
    });

    test('sin horarios el campo queda undefined, no vacío', () => {
      expect(ok(schemas.settings, base).hours).toBeUndefined();
    });
  });

  describe('checkbox de HTML', () => {
    // Un checkbox desmarcado NO se envía: la ausencia del campo es el valor.
    test('ausente significa cerrado, presente significa abierto', () => {
      expect(ok(schemas.settings, { name: 'N' }).is_open).toBe(0);
      expect(ok(schemas.settings, { name: 'N', is_open: 'on' }).is_open).toBe(1);
      expect(ok(schemas.settings, { name: 'N', is_open: '1' }).is_open).toBe(1);
    });

    // is_active es al revés: ausente significa activo, y sólo el '0' explícito
    // lo desactiva. Es la semántica que ya tenía el formulario de productos.
    test('is_active: ausente es activo, sólo el "0" desactiva', () => {
      const p = { name: 'X', price: '1', category_id: '1' };
      expect(ok(schemas.productUpdate, p).is_active).toBe(true);
      expect(ok(schemas.productUpdate, { ...p, is_active: '0' }).is_active).toBe(false);
      expect(ok(schemas.productUpdate, { ...p, is_active: '1' }).is_active).toBe(true);
    });
  });

  describe('tema del menú', () => {
    // Este test decía "acepta los temas que ofrece la vista" y recorría una
    // lista escrita a mano que incluía `blue` — un tema que la vista NO ofrecía
    // y que no tenía CSS. O sea que afirmaba lo contrario de su propio nombre y
    // dejaba pasar el bug en verde. Ahora la lista sale de `theme/`, la misma
    // fuente que usan el validador y el panel.
    //
    // La coherencia entre las tres puntas se verifica en tests/unit/theme.test.js;
    // acá quedan las reglas propias del schema.
    test('acepta las paletas declaradas en theme/', () => {
      for (const id of tema.idsDePaletas()) {
        expect(ok(schemas.settings, { name: 'N', menu_theme: id }).menu_theme).toBe(id);
      }
    });

    test('rechaza un tema inventado', () => {
      expect(schemas.settings.safeParse({ name: 'N', menu_theme: 'fucsia' }).success).toBe(false);
    });

    test('sin tema cae al de por defecto', () => {
      expect(ok(schemas.settings, { name: 'N' }).menu_theme).toBe(tema.PALETA_POR_DEFECTO);
    });
  });
});
