---
name: cargar-menu-pdf
description: Carga el menú (PDF) de un restaurante/cafetería al admin de EnElMapa (enelmapa.co) — crea categorías, productos con precio/descripción/imagen, logo y banner. Usar cuando el usuario comparte un PDF de carta/menú junto con credenciales de /admin/login de enelmapa.co, o pide subir/cargar/actualizar el menú de un negocio en EnElMapa.
---

# Cargar menú (PDF) al admin de EnElMapa

Playbook operativo. El razonamiento y los hallazgos completos (con ejemplos
reales de The Burguery y Caficultor) están en
`PROCEDIMIENTO_CARGA_MENU.md` en la raíz del proyecto — este skill es la
versión accionable, léelo si algo acá queda corto.

No hay navegador headless disponible: todo se hace por `curl`/`requests`
contra los endpoints internos del admin (server-rendered, no es una API
pública). El admin **no tiene subcategorías ni variantes de producto**.

## Antes de escribir nada

Necesitas: credenciales (`email`/`password` de `/admin/login`), el PDF de la
carta, y el slug público (`/s/<slug>`) para verificar al final.

Transcribe el PDF a un JSON intermedio en el scratchpad:
`[{"cat": "...", "name": "...", "desc": "...", "price": N}, ...]`.

**Antes de crear nada**, decide con el usuario (usar `AskUserQuestion`, no
asumir en silencio) — presenta primero el plan completo (categorías, conteo
de productos, todas las ambigüedades de una vez) y espera confirmación antes
de ejecutar:

- **Subcategorías del PDF** → el admin es plano, ¿una categoría por cada
  sección/subsección del PDF, o fusionar? (default recomendado: una por
  sección, es más navegable).
- **Precios que parecen error de tipeo** (ej. un ítem a $1.500-2.000 en medio
  de una sección donde todo lo demás cuesta $6.000+) — puede ser un típo, o
  puede ser en realidad un **adicional/topping**, no un producto independiente
  (ver abajo). No corregir el número sin preguntar.
- **Ítems que son toppings/adicionales**, no platos/bebidas en sí (ej.
  "Michelado $1.500" al final de una lista de cervezas = salsa/sal para
  agregarle a la cerveza, no una cerveza más; "Leche vegetal $2.000" = swap
  de leche en cualquier bebida). Si se confirma, van en su **propia categoría
  "Adicionales"**, no mezclados con productos reales.
- **Ítems sin precio listado** (ej. "pregunta por nuestro café: grano o
  molido"). El campo `price` es numérico y obligatorio → crear el producto
  con `price=0` y aclarar "precio a consultar" en la descripción. No inventar
  un precio ni omitir el producto.
- **Notas generales sin campo propio** (tipo de pan a elegir, "todas las
  malteadas traen galleta", "gratinados con bechamel") → van como texto en la
  `description` de cada producto afectado, avisando que no es una opción real
  seleccionable en el menú público.
- **Variantes de tamaño/peso con precio distinto** (ej. "Chocolatina 65gr
  $17.000 / 20gr $7.000") → dos productos separados, uno por tamaño.

## Procedimiento

1. **Login + explorar estructura** (ver tabla de endpoints abajo). Cada
   negocio puede tener el admin ligeramente distinto — confirma leyendo el
   HTML/JS server-rendered de `/admin/categories`, `/admin/products`,
   `/admin/settings` antes de asumir payloads.
2. **Extraer imágenes del PDF** con `pdfimages -list` / `pdfimages -png` /
   `pdftoppm -png -r 300`. Solo hay fotos reales para los ítems que el PDF
   trae con foto de verdad (normalmente pocos: 1 hero item, o una sección
   destacada) — recortar con Pillow, revisar el recorte con `Read` antes de
   subir. Todo lo demás va con placeholder generado (confirmar con el usuario
   que la resolución no importa).
3. **Crear categorías** → `POST /api/categories {name}`, guardar el mapeo
   `nombre → id` devuelto.
4. **Crear productos** → `POST /api/products` multipart (`name, description,
   price, category_id, image?`). Revisar `{"ok": true, "id": N}` en cada
   respuesta, no asumir éxito en bloque — imprimir cada resultado.
5. **Logo y banner** (`POST /api/settings`, manda el form completo cada vez,
   no solo lo que cambió) → **antes de subir, arreglar el aspect ratio**:
   - Logo → paddear a **cuadrado** (canvas transparente, lockup centrado).
   - Banner → **letterbox** horizontal (~2.4:1), fondo del color muestreado
     de la propia foto, foto centrada.
   Si no se hace esto, `object-fit: cover` / `background: cover` del menú
   público recorta la imagen (logo pierde texto de los costados, banner
   pierde cabeza/pies de una foto vertical).
6. **Verificar** → `curl "https://enelmapa.co/s/<slug>"` y grepear
   `menuData`, `banner`, `logo` (vienen server-rendered en un `<script>`, no
   hace falta adivinar ni abrir navegador).

## Endpoints (mismos para todos los negocios, misma sesión de cookie)

| Acción | Método | Endpoint |
|---|---|---|
| Login | POST | `/admin/login` (`email`, `password` form-urlencoded) |
| Crear categoría | POST | `/api/categories` `{name}` JSON |
| Borrar categoría (+ sus productos, cascada) | DELETE | `/api/categories/:id` |
| Crear producto | POST | `/api/products` multipart |
| Editar producto | PUT | `/api/products/:id` multipart + `is_active` |
| Borrar producto | DELETE | `/api/products/:id` |
| Config del negocio / banner / logo | POST | `/api/settings` multipart (manda **todo** el form) |

No hay endpoint para "quitar" banner/logo, solo reemplazar (subir un PNG
transparente 1×1 si piden dejarlo vacío).

## Gotchas

- **Sesión inestable**: Phusion Passenger recicla procesos Node y el session
  store parece ser en memoria → a veces una request da `302` a
  `/admin/login` aunque el login anterior haya funcionado. Cada script debe
  loguearse de nuevo al arrancar; no asumas que una sesión de hace varios
  minutos sigue viva.
- Rutas con/sin `/` final a veces se comportan distinto (`/admin/dashboard`
  vs `/admin/dashboard/`) — no es un patrón fijo, probar ambas si una da
  404/302 sin motivo aparente.

## Plantilla de script

```python
import json, requests

BASE = "https://enelmapa.co"
EMAIL, PASSWORD = "admin@NEGOCIO.com", "xxxxx"

sess = requests.Session()
r = sess.post(f"{BASE}/admin/login", data={"email": EMAIL, "password": PASSWORD})
assert "login" not in r.url, "login falló"

cat_ids = {}
for name in categorias_en_orden:
    cat_ids[name] = sess.post(f"{BASE}/api/categories", data={"name": name}).json()["id"]

for p in productos:  # [{cat, name, desc, price, img_path?}]
    files = {"image": (p["name"]+".jpg", open(p["img_path"], "rb"), "image/jpeg")} if p.get("img_path") else {}
    data = {"name": p["name"], "description": p.get("desc",""),
            "price": str(p["price"]), "category_id": str(cat_ids[p["cat"]])}
    resp = sess.post(f"{BASE}/api/products", data=data, files=files)
    print(p["name"], resp.status_code, resp.text[:120])
```

## Después de cargar

Preguntar si documentar algo nuevo en `PROCEDIMIENTO_CARGA_MENU.md` (y en
este skill) cuando aparezca un caso que no esté cubierto arriba — este
documento se actualiza cada vez que sale un patrón nuevo, no solo la primera
vez.
