# Procedimiento: cargar un menú (PDF) al admin de EnElMapa

Guía reutilizable para tomar el PDF de una carta de un restaurante y dejarlo
100% cargado en su panel admin (`https://enelmapa.co/admin`): categorías,
productos con precio/descripción/imagen, logo y banner.

Se hizo la primera vez con **The Burguery** (Armenia) como prueba de concepto,
y una segunda vez con **Caficultor** (menú mucho más grande: 24 categorías,
132 productos, con toppings/adicionales y un ítem sin precio). El admin no
tiene navegador headless disponible en este entorno, así que todo se hace por
`curl`/`requests` contra los endpoints internos del panel (descubiertos
leyendo el HTML server-rendered, no es una API pública documentada).

> Para ejecutar esto de forma guiada (en vez de releer todo el documento),
> usar el skill `cargar-menu-pdf` (`.claude/skills/cargar-menu-pdf/`).

---

## 0. Qué necesitas antes de empezar

- Credenciales del admin del negocio: `email` + `password` de `/admin/login`.
- El PDF de la carta (mejor si el usuario lo adjunta directo en el chat).
- El slug público del negocio (`/s/<slug>`) para verificar el resultado.

## 1. Autenticarse y detectar la estructura del admin

El admin es server-rendered (Express + sesión por cookie `connect.sid`), no
una SPA. El login es un POST normal:

```bash
curl -sS -c cookies.txt -X POST "https://enelmapa.co/admin/login" \
  --data-urlencode "email=admin@negocio.com" \
  --data-urlencode "password=xxxxx"
```

Con la cookie ya se puede navegar `/admin/dashboard`, `/admin/categories`,
`/admin/products`, `/admin/settings`, `/admin/qr`. Cada página trae en su HTML
el JS que llama a los endpoints reales — léelo para confirmar payloads antes
de asumir nada, puede cambiar entre negocios/versiones del admin.

**Endpoints encontrados (multipart o JSON, misma sesión de cookie):**

| Acción | Método | Endpoint |
|---|---|---|
| Crear categoría | POST | `/api/categories` `{name}` (JSON) |
| Editar categoría | PUT | `/api/categories/:id` `{name}` (JSON) |
| Reordenar categorías | PUT | `/api/categories/reorder` `{order:[ids]}` |
| Borrar categoría (+ sus productos) | DELETE | `/api/categories/:id` |
| Crear producto | POST | `/api/products` multipart: `name, description, price, category_id, image?` |
| Editar producto | PUT | `/api/products/:id` multipart: igual + `is_active` |
| Borrar producto | DELETE | `/api/products/:id` |
| Config del negocio (nombre, contacto, tema, horarios, banner, logo) | POST | `/api/settings` multipart: `name, address, phone, whatsapp, instagram, facebook, tiktok, is_open, menu_theme, hours (JSON string), banner?, logo?` |

No hay endpoint para "quitar" banner/logo — solo reemplazarlos subiendo un
archivo nuevo (ver sección de gotchas).

## 2. Extraer y estructurar el menú del PDF

Si el PDF se adjunta en el chat, Claude ya recibe el texto de cada página.
Transcribir a mano a un JSON intermedio (uno por negocio, en el scratchpad):

```json
[
  {"cat": "Starters", "name": "Nachos", "desc": "...", "price": 30000},
  ...
]
```

Decisiones a tomar con el usuario **antes** de escribir nada (usar
`AskUserQuestion` si hay ambigüedad real, no asumir):

- Cómo aplanar subcategorías si el admin no soporta jerarquía (ej. "Burger
  Master" dentro de "Burgers" en el PDF → ¿categoría propia o fusionada?).
- Precios o datos que parezcan error de tipeo del PDF (confirmar con el
  usuario en vez de "corregir" en silencio).
- Notas que no tienen campo propio en el admin (ej. "elige el pan: brioche/
  amapola/campesino" — no hay variantes de producto, como mucho se agrega a
  la descripción y se avisa la limitación).
- **Toppings/adicionales que el PDF lista como si fueran un producto más**
  (ej. "Michelado $1.500" al final de la lista de cervezas, o "Leche vegetal
  $2.000" — no son un plato/bebida independiente, son un extra que se le
  agrega a otro producto). Si el precio es sospechosamente bajo comparado con
  el resto de la sección, preguntar antes de asumir que es un producto normal
  — puede que sea un adicional. Una vez confirmado, sacarlo de su categoría
  original y meterlo en una categoría aparte tipo **"Adicionales"** (en vez de
  dejarlo mezclado con productos reales, que confunde el precio en el menú
  público).
- **Ítems sin precio en el PDF** (ej. "Nuestros diversos cafés de origen por
  340gr" sin `$` al lado, solo "pregunta por nuestro café: grano o molido").
  El campo `price` del admin es numérico y obligatorio (`required min=0`), así
  que no se puede omitir. Preguntar al usuario qué hacer — la respuesta que ha
  salido hasta ahora es: crear el producto igual con `price=0` y aclarar en la
  `description` que el precio es "a consultar", en vez de inventar un número o
  saltarse el producto por completo.

## 3. Extraer imágenes del PDF

Herramientas usadas (`poppler-utils` + Pillow, ya disponibles en el entorno):

```bash
# Listar imágenes embebidas y su página/tamaño real
pdfimages -list archivo.pdf

# Extraer una imagen embebida tal cual (fotos que son un solo objeto raster,
# sin texto vectorial encima — mejor calidad que renderizar la página)
pdfimages -png -f <pagina> -l <pagina> archivo.pdf salida

# Renderizar una página completa a alta resolución (necesario cuando la
# imagen que quieres está mezclada con texto/gráficos vectoriales, como
# fotos de producto con precio al lado, o un logo dibujado en vectores)
pdftoppm -png -r 300 -f <pagina> -l <pagina> archivo.pdf pagina
```

Luego recortar con Pillow mirando la imagen renderizada (usar el `Read` tool
sobre el PNG para ver coordenadas, recortar, volver a mirar el recorte antes
de subirlo — no asumir el bounding box a la primera).

Solo hay fotos reales de producto para los ítems que el diseño del PDF trae
con foto (normalmente una sección "hero" tipo burgers premium). El resto del
menú suele ser texto plano → esos productos quedan con imagen placeholder
(generada, ver más abajo) hasta que el negocio mande fotos reales.

## 4. Placeholder de imagen para productos sin foto

Cuando la resolución no importa (confirmar con el usuario), generar un
placeholder simple en vez de dejar el producto sin imagen:

```python
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (320, 220), color)  # color por categoría
draw = ImageDraw.Draw(img)
draw.text((x, y), nombre_producto, fill="white", font=font)
```

## 5. Crear categorías y productos vía API

Login con `requests.Session()` (mantiene cookies solo), luego:

```python
sess.post(f"{BASE}/api/categories", data={"name": ...})   # -> {"id": N}
sess.post(f"{BASE}/api/products", data={...}, files={"image": (...)})
```

Guardar el mapeo `nombre_categoria -> id` porque `category_id` es obligatorio
en cada producto. Revisar en la respuesta `{"ok": true, "id": N}` que cada
llamada haya funcionado antes de seguir (no asumir éxito en bloque).

## 6. Logo y banner del negocio (`/api/settings`)

Dos problemas de recorte que **hay que resolver en la imagen antes de subir**,
porque el CSS del menú público usa `object-fit: cover` / `background: cover`
y por lo tanto recorta cualquier imagen que no tenga ya el aspect ratio de su
contenedor:

- **Logo**: se muestra en un círculo/cuadrado de 80×80px. Si el logo del PDF
  es un lockup ancho (texto + badge), hay que rellenarlo (padding transparente)
  hasta volverlo **cuadrado** antes de subirlo, si no `cover` recorta los
  costados y se pierde texto.
- **Banner**: es una caja corta y ancha (~200px alto, todo el ancho). Si la
  foto original es un retrato (vertical), `cover` la recorta brutalmente
  (se pierde cabeza y pies, solo queda el torso). Hay que **hacer letterbox**:
  crear un lienzo horizontal (ratio ~2.4:1 fue lo usado), pegar la foto
  centrada, y rellenar los costados con un color muestreado de la propia foto
  (para que el padding no se note como una barra artificial).

```python
photo = Image.open("foto.png").convert("RGB")
fill = photo.crop((x0,y0,x1,y1)).resize((1,1)).getpixel((0,0))  # color de fondo
canvas = Image.new("RGB", (int(h*2.4), h), fill)
canvas.paste(photo, ((canvas.width - w)//2, 0))
```

```python
logo = Image.open("logo.png").convert("RGBA")
square = Image.new("RGBA", (lw, lw), (0,0,0,0))
square.paste(logo, (0, (lw - lh)//2), logo)
```

Subir ambos junto con el resto de campos del form de settings (el submit del
admin manda **todo el formulario** cada vez, no solo lo que cambió — replicar
eso: incluir `name`, `is_open`, `menu_theme`, `hours` como JSON, etc.).

## 7. Verificar

El menú público (`/s/<slug>`) es server-rendered y trae los datos ya
embebidos en un `<script>` como `const menuData = [...]`. Es la forma más
rápida de confirmar sin adivinar: `curl` la página y grepear `menuData`,
`banner`, `logo`.

## 8. Vaciar todo (reset de prueba de concepto)

- Borrar categorías por id vía `DELETE /api/categories/:id` — **esto borra en
  cascada sus productos**, no hace falta borrar productos uno por uno.
- Banner/logo no tienen endpoint de borrado. Para dejarlos "vacíos" hay que
  subir un PNG transparente de 1×1px por ese campo (no es lo mismo que "sin
  imagen", pero es lo más cercano que permite el admin).

---

## Problemas conocidos (gotchas)

- **Sesión inestable — causa confirmada** (ver código fuente en
  `enelmapa/server.js`, clonado después de escribir esto por primera vez): la
  sesión usa el `MemoryStore` por defecto de `express-session`, sin store
  persistente. El server corre bajo Phusion Passenger, que recicla procesos
  Node — cuando eso pasa se pierde la sesión en memoria y una request cae en
  `302` a `/admin/login` aunque el login anterior haya sido exitoso segundos
  antes. Mitigación: reintentar login si una request da 302 inesperado; no
  asumir que la sesión sigue viva entre pasos separados por minutos de
  conversación. (Detalle completo en el skill `enelmapa-dev`.)
- Lo que en su momento parecía ser "rutas con/sin `/` final se comportan
  distinto" **no es un patrón real** — revisando las rutas del código
  (`routes/admin.js`) no hay tal distinción. Lo que se observó era la misma
  inestabilidad de sesión de arriba, coincidiendo por casualidad con esas
  pruebas. No perder tiempo probando variantes con/sin slash — si una request
  autenticada falla, sospechar primero de la sesión.
- **No hay endpoint para quitar imágenes** de settings, solo reemplazar.
- El admin no soporta subcategorías ni variantes de producto (ej. elegir tipo
  de pan) — cualquier estructura del PDF que dependa de eso hay que aplanarla
  o resolverla como texto en la descripción, y avisarle al usuario de la
  limitación.

## Plantilla de script (genérico, ajustar BASE/credenciales/paths)

```python
import json, requests

BASE = "https://enelmapa.co"
EMAIL = "admin@NEGOCIO.com"
PASSWORD = "xxxxx"

sess = requests.Session()
r = sess.post(f"{BASE}/admin/login", data={"email": EMAIL, "password": PASSWORD})
assert "login" not in r.url, "login falló"

cat_ids = {}
for name in ["Categoria 1", "Categoria 2", "..."]:
    resp = sess.post(f"{BASE}/api/categories", data={"name": name}).json()
    cat_ids[name] = resp["id"]

for p in productos:  # [{cat, name, desc, price, img_path?}]
    files = {}
    if p.get("img_path"):
        files["image"] = (p["name"] + ".jpg", open(p["img_path"], "rb"), "image/jpeg")
    data = {
        "name": p["name"], "description": p.get("desc", ""),
        "price": str(p["price"]), "category_id": str(cat_ids[p["cat"]]),
    }
    resp = sess.post(f"{BASE}/api/products", data=data, files=files)
    print(p["name"], resp.status_code, resp.text[:120])
```

Para el próximo menú: repetir desde el paso 2 con el PDF nuevo, reutilizando
tal cual los pasos 1, 3, 4, 5 y 6.
