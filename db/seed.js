const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrate');
const { createPool } = require('./pool');
const { loadConfig } = require('../config');
const { createContainer } = require('../container');

const menuData = [
  {
    name: "Desayunos & Brunch 🥞",
    products: [
      { name: "Snack Saludable", desc: "Banano con Yogurt griego y mermelada de frutos rojos", price: 6000, img: "9ed37018-32db-4577-ab51-2d117f67783e.png" },
      { name: "Porción de Fruta", desc: "Piña, fresa, banano, arándanos azules y naranja.", price: 10000, img: "5df5ce3d-3a58-4910-971e-95f15f5efe58.jpg" },
      { name: "Waffles de Pandebono x 6", desc: "6 Unidades de waffle de pandebono, queso crema y miel de maple", price: 16000, img: "038b3269-7ea6-44e3-a864-50b5b6d7fcff.jpg" },
      { name: "Waffles de Pandebono x 8", desc: "8 Unidades de waffle de pandebono, queso crema y miel de maple", price: 19500, img: "b3f58dc4-afd5-430f-9fd0-3b132466759d.jpg" },
      { name: "Huevos en Cacerola", desc: "Huevos en cacerola con brotes, tocineta, chorizo y un croissant sencillo", price: 22000, img: "d9534462-ada8-4c81-9351-e111ec5104d5.jpg" },
      { name: "Huevos Pesto", desc: "Huevos fritos en salsa de tomate, queso mozzarella de búfala, parmesano y pesto", price: 22000, img: "c8c601b7-39fb-4eef-b486-7d86590ceb3a.png" },
      { name: "Huevos Criollos", desc: "Dos huevos en cacerola con Hogao, tostones de Parmesano, pan de masa madre", price: 21000, img: "23920f9d-6124-4425-9edf-40640ed385b2.jpg" },
      { name: "Huevos Pochados", desc: "Huevos pochados con brotes, tocineta, crema de aguacate, salsa holandesa", price: 23000, img: "cb46d57e-35e3-4def-8a46-0dd693076c77.jpg" },
      { name: "Huevos Revueltos", desc: "Huevos revueltos con tocineta crujiente, parmesano y croissant", price: 19000, img: "36a250c8-b34f-49ad-9669-316a56aaacdc.jpg" },
      { name: "Huevos Napolitanos", desc: "Huevos cocidos en salsa napolitana y mozzarella, con tostadas", price: 20000, img: "e0bd8a06-de13-4c48-a157-c6506d3cee56.png" },
      { name: "Granola Frutos Amarillos", desc: "Yogurt griego, piña, mango, uchuva y banano", price: 20000, img: "94803035-b1de-4ad7-925d-e59dba64437a.jpg" },
      { name: "Granola Frutos Rojos", desc: "Yogurt griego, fresas, ciruela y banano", price: 20000, img: "7e6aeeee-b9c1-4bdb-a096-e9552682b8a8.jpg" },
      { name: "Tostadas Francesas", desc: "Tostadas francesas con frutas, mermelada y miel de maple", price: 19000, img: "f6bd6065-f33c-4093-a7e8-75c2a2ba5620.jpg" },
      { name: "Waffles con Fruta", desc: "4 mini waffles con banano, fresa, arándanos azules y miel de maple", price: 17000, img: "ee320088-8e76-4531-814f-3a6e5f6573c1.jpg" },
      { name: "Pancakes", desc: "4 pancakes con arándanos azules, banano, fresa y miel de maple", price: 19000, img: "4eb7af72-51a6-4c04-b380-9cd8b6e2971b.jpg" },
      { name: "Pancakes Nutella", desc: "4 Pancakes con Nutella y fruta", price: 24000, img: "3543bfe4-3e89-4c1a-91e3-2ee9e183ed44.png" },
      { name: "Pancakes con Tocineta", desc: "Pancakes con tocineta caramelizada, queso crema y miel de maple", price: 28000, img: "5210ed7d-00b9-4cec-a273-d0e4f1ef50ce.jpg" },
      { name: "Bowl de Acai", desc: "Açai con granola, arándanos azules, banano, fresa y kiwi", price: 28000, img: "4a7382e2-269a-42a4-8e9e-bdcd6853a553.jpg" },
      { name: "Tostada Teriyaki", desc: "Tostada de masa madre con aguacate, carne de res en salsa teriyaki", price: 28000, img: "2e7d2035-a796-4f64-ba91-52859cccaf3a.png" },
      { name: "Tostadas Jamón Serrano", desc: "Tostada de masa madre con queso crema, jamón serrano y ensalada", price: 23000, img: "42e9180b-94b4-4940-a314-eee78dd199a6.jpg" },
      { name: "Panne Cook Stroganoff", desc: "Pan artesanal francés relleno de carne de res con stroganoff", price: 28000, img: "6fd423cc-e125-45ee-9bf6-409db6f7ee88.jpg" },
    ]
  },
  {
    name: "Croñuelos",
    products: [
      { name: "Croñuelos x3", desc: "Croissant de mantequilla en forma redonda, elige los rellenos", price: 21000, img: "2d4e0c49-305c-445c-8ac4-4449fd7aa8e6.jpg" },
      { name: "Croñuelo", desc: "1 Unidad: sencillo, con arequipe, crema pastelera o nutella", price: 8000, img: "d805a38f-d684-41ba-8f61-779485bb7737.jpg" },
    ]
  },
  {
    name: "Croissant Dulces 🥐",
    products: [
      { name: "Croissant CroMilo", desc: "Croissant Relleno de Crema de Milo con Fresas", price: 18000, img: "43f2411e-ff7e-4a62-8003-a1b549f65a0c.jpg" },
      { name: "Croissant de Temporada", desc: "Croissant con helado de vainilla, mermelada de frutos amarillos y chantilly", price: 15000, img: "a6a55f6a-3390-4a1a-aadb-fc1c723a09c9.png" },
      { name: "Croissant Chocoalmendras", desc: "Cubierto con chocolate blanco y almendras laminadas", price: 14000, img: "169d6d20-a389-4ed5-af95-dae5197d76a4.jpg" },
      { name: "Croissant Almendras", desc: "Relleno de crema de almendras y decorado con almendras laminadas", price: 13000, img: "37563106-993c-4dcb-a809-577acbd8dc1c.jpg" },
      { name: "Croissant Arequipe", desc: "Relleno con arequipe", price: 11000, img: "169446f3-a865-406d-9ba9-05da80fac4ba.jpg" },
      { name: "Croissant Chocomaní", desc: "Cubierto con chocolate semiamargo negro y maní", price: 14000, img: "66e3cee0-2421-4af8-aa9d-036002b75176.jpg" },
      { name: "Croissant Frutos Rojos", desc: "Relleno de queso crema y mermelada de frutos rojos", price: 13000, img: "05003eb1-69c2-4d46-ae79-98bf88e9e449.jpg" },
      { name: "Croissant Chocolate Negro", desc: "Cubierto con chocolate semiamargo negro 43%", price: 10000, img: "f5f5b6d6-34e4-4435-a01d-6d178631cf74.jpg" },
      { name: "Croissant Nutella", desc: "Con relleno de nutella y cubierto con la misma", price: 10000, img: "64196b53-7606-4793-9025-32d142aac8aa.jpg" },
      { name: "Croissant Chocolate Blanco", desc: "", price: 11000, img: "" },
    ]
  },
  {
    name: "Croissant Salados 🥐",
    products: [
      { name: "Croissant Mediterráneo", desc: "Queso crema, jamón de pavo, ajonjolí y rúgula", price: 18000, img: "549cd7f3-7f80-4759-925a-7b380df61c9a.jpg" },
      { name: "Croissant Tres Quesos", desc: "Queso crema, queso mozzarella y queso parmesano", price: 12000, img: "8f7c5e92-8b60-489b-8912-78fb4de06b87.jpg" },
      { name: "Croissant Capresse", desc: "Queso crema, tomates secos, queso mozzarella de búfala y albahaca", price: 18000, img: "aabbd4ba-feac-44c2-bb39-f928dc94d060.jpg" },
      { name: "Croissant con Chorizo", desc: "Con lechuga, crema de aguacate, chorizo y tomate cherry", price: 18000, img: "cd60ec09-bea1-43fd-ac5b-b63770ec12ed.jpg" },
      { name: "Croissant con Aguacate", desc: "Lechuga, crema de aguacate, huevo duro, tomate cherry y balsámico", price: 12000, img: "d5a1ed7f-369f-412d-b692-9b47b324935f.jpg" },
      { name: "Croissant Huevo y Cheddar", desc: "Croissant con huevo y queso cheddar", price: 13000, img: "452be294-f6bd-4631-8897-77877192d076.jpg" },
      { name: "Croissant con Carne", desc: "Con carne desmechada, pico de gallo, cilantro y mix de lechugas", price: 24000, img: "b4be48c1-9845-4fcd-82fb-8f73af2cdc62.jpg" },
      { name: "Croissant de Mantequilla", desc: "Croissant 100% de mantequilla", price: 8000, img: "d6ee50cc-5b72-40ee-8a41-e9fb0297698e.jpg" },
      { name: "Croissant Jamón y Queso", desc: "Ham and cheese", price: 12000, img: "02be25eb-d119-4f51-afd8-b5d2c95f3436.jpg" },
      { name: "Croissant Argentino", desc: "Con queso crema, chorizo dorado y chimichurri", price: 20000, img: "ec56958c-1e7b-4f00-bad9-4934126dde24.jpg" },
      { name: "Croissant CroiBurger", desc: "Queso crema, carne de res, lechugas, cebolla caramelizada, cheddar, tocineta", price: 25000, img: "f2471f9b-db77-4a54-ac65-534dc590d616.jpg" },
    ]
  },
  {
    name: "Ensaladas 🥗",
    products: [
      { name: "Ensalada Annie", desc: "Frutas con mango, kiwi, piña, arándanos, manzana, banano, granola y yogurt griego", price: 26000, img: "b5396410-e646-4b0d-8fe8-faac0eb36263.jpg" },
      { name: "Ensalada de Mango y Aguacate", desc: "Mango, aguacate, lechuga crespa, queso, pepino, semillas de girasol", price: 18000, img: "258b9969-94b8-4259-9bf2-be218a7e9b54.jpg" },
    ]
  },
  {
    name: "Helados 🍦",
    products: [
      { name: "Cono de Helado Suave", desc: "Sabores: Café, Yogurt, Mix", price: 7000, img: "98e74975-5afa-4122-98f7-ce9d5723ed5c.jpeg" },
      { name: "Cronie", desc: "Sabores: Café, Yogurt, Mix", price: 13000, img: "7617975b-d948-4002-957a-8f7b22b99c4c.jpg" },
      { name: "Vaso con Helado Pequeño", desc: "Sabores: Café, Yogurt, Mix", price: 10000, img: "8bcd78cc-2cd5-4b2e-8e9f-403023e6d750.jpg" },
      { name: "Vaso con Helado Grande", desc: "Sabores: Café, Yogurt, Mix", price: 11000, img: "a9589631-e65d-4a94-9857-6b5bff5bc333.jpg" },
    ]
  },
  {
    name: "Pastelería 🍰",
    products: [
      { name: "Torta de Croissant", desc: "", price: 10000, img: "a49248f2-933b-4014-9d9f-48b3b5ca27f6.jpeg" },
      { name: "New York Cookie", desc: "Galleta caliente con Helado", price: 17000, img: "500d3c29-efaf-4363-9925-289e28d62567.jpg" },
      { name: "Tartaleta de arándanos", desc: "", price: 18000, img: "361b13e7-0a59-443e-bfee-cd8e896f5e62.jpg" },
      { name: "Cheesecake", desc: "", price: 10000, img: "90de9182-f881-4f55-9ecf-4edf86fdfee4.jpg" },
      { name: "Pie de limón", desc: "Con arándanos azules", price: 8000, img: "96f57efb-907b-4c90-a377-8a0a9992193b.jpg" },
      { name: "Brownie con Helado", desc: "Esfera de chocolate negro con brownie, helado de vainilla, caramelo y fresas", price: 20000, img: "f69854b5-d1e2-4ca5-a9b6-8ffdcfc02e9e.png" },
      { name: "Cremosito de Arequipe", desc: "Postre cremoso con dulce de leche y banano", price: 6000, img: "30de2c01-50eb-4b9b-a059-24a92131f26e.png" },
      { name: "Torta de Amapola y Naranja", desc: "", price: 10000, img: "2741cd20-f916-4e8b-bbb3-8b31a9a9de1f.jpg" },
      { name: "Torta de Chocolate", desc: "", price: 10000, img: "8a60f3e6-d3a3-4e76-b9b2-705738673cd6.jpg" },
      { name: "Torta de Zanahoria", desc: "", price: 10000, img: "df792a2c-ac45-42fa-8cd5-c4358b8013fb.jpg" },
      { name: "Torta de Red Velvet", desc: "", price: 10000, img: "c2daa4c6-78f1-426e-91d0-0dc284c9d12d.jpg" },
      { name: "Waffles con Helado", desc: "4 mini Waffles con helado de vainilla, mermelada de frutos rojos", price: 19000, img: "50eac086-b262-4ea8-a279-1e76845d7e91.png" },
      { name: "Paquete de galletas", desc: "", price: 7000, img: "81aa8411-4337-4a33-b198-27ad2925744c.jpg" },
    ]
  },
  {
    name: "Bebidas Calientes ☕️",
    products: [
      { name: "Vino caliente", desc: "", price: 22000, img: "ab9ae58a-ace3-4f33-81c5-15957a62e0a5.jpg" },
      { name: "Capuccino", desc: "Desde Tradicional, Baileys, Vainilla, Almendras, Amaretto", price: 11000, img: "ed5759ad-9390-41ce-936e-557a7d3cb8a9.JPG" },
      { name: "Chocolate", desc: "Variaciones: Sin Azúcar, Suizo en agua, leche o almendras", price: 9000, img: "12a30466-85c0-49e7-9ac9-27532f2ce4e6.jpg" },
      { name: "Chocolate con Chantilly", desc: "", price: 12000, img: "d0bb3778-c93e-4c1c-818c-7a46bbf59199.png" },
      { name: "Chocolate con masmelos", desc: "Chocolate suizo con leche más masmelos", price: 12000, img: "c89dfe3c-ddb6-44b5-baf1-293da8734b9b.jpg" },
      { name: "Chocolate Parisino", desc: "Chocolate espeso con crema de chantilly para untar", price: 16000, img: "d3c01f4c-374a-4992-903e-0a3e7ffb464d.jpg" },
      { name: "Colada", desc: "Tradicional, Con Café, Con Leche de Almendras", price: 9000, img: "45a66ead-9d75-4e70-8b25-3de7b0564c52.jpg" },
      { name: "Espresso", desc: "Extracción 25 segundos aprox.", price: 6000, img: "485ab017-d64e-4bab-9ba6-51de5bc33866.jpg" },
      { name: "Dopio", desc: "Espresso doble", price: 6000, img: "ca6f8477-b779-4b49-a1e5-2013b712f377.jpg" },
      { name: "Mocaccino", desc: "Espresso con cocoa más leche", price: 12000, img: "343b35fd-f40b-409a-97ad-704cd419fb91.JPG" },
      { name: "Americano", desc: "Espresso más agua. Pequeño o Mediano", price: 6000, img: "c6a45808-8b7b-4e27-be2a-eb04bd67e1c8.png" },
      { name: "Café Affogato", desc: "Espresso con helado de vainilla más chantilly", price: 16000, img: "adbe86bd-71dd-4744-8c7b-033dd8a002c8.png" },
      { name: "Latte", desc: "Pequeño o Grande, en leche o almendras", price: 8000, img: "be7201c3-455e-4cb0-a74f-52cabf26f68d.png" },
      { name: "Café de Finca", desc: "Espresso con panela y canela", price: 7000, img: "c92bd7cc-5608-47ff-acc2-36aff4c03504.jpeg" },
      { name: "Macchiato", desc: "Espresso con leche caliente y espumada", price: 6500, img: "5c249e83-56ff-4f32-8f7e-5760a352d36a.jpeg" },
      { name: "Milo Caliente", desc: "Milo con leche deslactosada", price: 10000, img: "987f655f-c6a0-492f-8061-eb58ad9841de.JPG" },
      { name: "Te chai", desc: "Con leche deslactosada o almendras", price: 10000, img: "0f22a09c-0529-4b1a-a106-3918d8ce5821.JPG" },
      { name: "Chai Latte", desc: "Te chai con café más leche deslactosada", price: 11000, img: "74f269f7-9795-4544-bbfc-b44814679626.JPG" },
      { name: "Aromática Frutos Amarillos", desc: "Con Fruta o De Bolsa", price: 6000, img: "38ffba75-3e1c-477f-90c5-0a7081128b87.jpg" },
      { name: "Aromática Frutos Rojos", desc: "Con Frutas o De Bolsa", price: 6000, img: "866b764a-6331-47c1-a54f-db29bf85bdb2.jpg" },
    ]
  },
  {
    name: "Bebidas Frías 🍹",
    products: [
      { name: "Tinto de verano", desc: "", price: 25000, img: "a84cb20f-6a05-4446-9a2b-0e4d9eedb92d.jpg" },
      { name: "Mimosa", desc: "Jugo de naranja con champaña", price: 17000, img: "94dcb831-ae51-41be-b9dd-5e32f22509ff.jpeg" },
      { name: "Mimosa blueberry", desc: "Jugo de naranja con champaña y syrup de blueberry", price: 17000, img: "161c9f1c-8a23-4edb-bd5e-14013da216d7.jpeg" },
      { name: "Orange Coffee", desc: "Espresso con Jugo de naranja", price: 12000, img: "2f85ec44-d13b-4b8d-90a1-cce7a297ba04.jpg" },
      { name: "Frappe de Café", desc: "", price: 15000, img: "259699a9-509b-49a2-9099-bb4cf3231ebb.jpg" },
      { name: "Frappe de Arequipe", desc: "", price: 16000, img: "ec9cd47f-378c-40c7-983f-72a6c741fcf7.jpg" },
      { name: "Latte Caramelo Frío", desc: "", price: 13500, img: "7a58b22e-83dd-4aae-a77a-f8227d95db9e.jpeg" },
      { name: "Frappe Café con Baileys", desc: "", price: 20000, img: "" },
      { name: "Milo Frío", desc: "En leche deslactosada o almendras", price: 15000, img: "10ba7d38-c595-406d-b544-9f7d7c69d27d.png" },
      { name: "Malteada de Baileys", desc: "", price: 25000, img: "afbf87a7-8cf4-45ff-ac83-e6327e0adf04.jpg" },
      { name: "Malteadas", desc: "Sabores: Vainilla, Oreo y Café", price: 18000, img: "2d213d8f-6ad5-48fa-923e-780f11bb19a5.jpeg" },
      { name: "Limonada de Coco", desc: "", price: 17000, img: "784df5df-8f7e-45e3-8fdb-5018ec812508.jpg" },
      { name: "Limonada de Mango Biche", desc: "", price: 15000, img: "8f2c6cdc-4742-465d-8467-3165cee37db1.jpg" },
      { name: "Limonada de Yerbabuena", desc: "", price: 15000, img: "fcd86b66-aa35-467f-9a90-f16611d755ad.jpg" },
      { name: "Limonada natural", desc: "Agua con limón y azúcar", price: 10000, img: "27e44ce7-f6f3-4bf6-bddb-7a2503e9a620.png" },
      { name: "Soda", desc: "", price: 8000, img: "61e355c3-9d6d-4db6-82c4-8ad0522f3201.jpeg" },
      { name: "Soda de Fresa", desc: "", price: 15000, img: "1fd72c0d-bf8c-4803-930c-596da10db07c.jpg" },
      { name: "Soda de Mango", desc: "", price: 15000, img: "b742d6bc-da01-4375-816d-2bc968f513da.jpg" },
      { name: "Soda de Lychee", desc: "Lychee o Lychee con Vino", price: 19000, img: "043dfc7d-0c43-4f59-8e14-59070fc7bb55.jpg" },
      { name: "Te chai Frío", desc: "", price: 12000, img: "d5560475-e713-487d-a5c9-236de3e0811d.jpeg" },
      { name: "Copa Baileys", desc: "Helado de Vainilla, Baileys, Chantilly, Brownie y Café", price: 23000, img: "3c7d4a02-8593-4402-a20b-0ace66eab7e6.png" },
      { name: "Te Hatsu", desc: "", price: 10000, img: "ff3664e6-9fd3-42b7-8ce8-be8e7275018e.jpeg" },
      { name: "Jugos", desc: "Guanabana, Mora, Mango y Maracuyá", price: 11000, img: "6f1a0cb0-136c-419a-a5ef-04d7e952d689.jpeg" },
      { name: "Jugo de Naranja", desc: "", price: 11000, img: "12542b0c-4bf5-4f52-8418-28c99101a567.jpeg" },
      { name: "Botella con Agua", desc: "", price: 6000, img: "4b41afb6-4c2a-4d1d-9d68-4c5a8701c1d1.png" },
      { name: "Botella Agua con Gas", desc: "", price: 6000, img: "33403841-4794-4016-adc8-00d5f795322e.jpeg" },
      { name: "Cerveza Brudder", desc: "Sabores: Café, Imperial Stout, Radler, Maracuyá, Chocolate", price: 12000, img: "09294165-c9fb-4fa5-a3b3-42cd3ef915b8.png" },
    ]
  },
  {
    name: "Mascoticas 🐶🐱",
    products: [
      { name: "Helado perros y gatos", desc: "Sabores: Carne, Pollo, Pollo con zanahoria, Costilla, Tocineta, Hígado", price: 8000, img: "93cd1b5b-027f-43d0-9e3a-73383daab5b0.jpeg" },
    ]
  },
  {
    name: "Panes 🍞",
    products: [
      { name: "Pan de Masa Madre", desc: "", price: 11000, img: "67745779-e74b-4ca5-b57e-4fc61f00ad59.jpeg" },
      { name: "Pan Brioche", desc: "", price: 14000, img: "96551a12-a435-43c8-a41c-a12e43f93146.jpeg" },
      { name: "Pan de Chocolate", desc: "", price: 14000, img: "3ddb88e3-2fba-4f7e-92b3-071de5b41264.jpg" },
    ]
  },
];

async function seed() {
  // Este script borra TODOS los negocios, no sólo el demo (regla
  // no-negociable #1 del skill). Se avisa a qué base apunta antes de tocarla:
  // con la config centralizada, esa base ya no está escondida en un
  // `process.env.DB_NAME || 'enelmapa'` adentro del pool.
  const config = loadConfig();
  console.log('Seed sobre la base "' + config.db.database + '" en ' + config.db.host);

  const container = createContainer(config);
  const { pool: db, repos, services } = container;

  // El seed también migra: una base recién creada tiene que quedar con el
  // schema al día antes de que se le escriba nada.
  await runMigrations(config.db, container.logger);

  await db.query('DELETE FROM products');
  await db.query('DELETE FROM categories');
  await db.query('DELETE FROM business_hours');
  await db.query('DELETE FROM users');
  await db.query('DELETE FROM businesses');

  // El alta de negocio + admin + horarios pasa por los mismos repositories que
  // usa el superadmin. Antes esto era una tercera copia del mismo INSERT, con
  // su propio array de días (hallazgo E3): cambiar uno y olvidar el otro era
  // cuestión de tiempo.
  // El alta pasa por el mismo servicio que usa el superadmin, así que el seed
  // ya no puede divergir de él: negocio + admin + horarios en una transacción.
  const bizId = await services.businesses.createWithDefaults({
    business: {
      slug: 'caficultor',
      name: 'CAFICULTOR',
      address: 'Calle 7 # 14-19 mall del parque local 1 Circasia, Quindío, Colombia',
      phone: '+57 300 219 2895',
      whatsapp: '573002192895',
      instagram: 'anniecroissantycafe',
      facebook: 'anniecroissantycafe'
    },
    admin: { email: 'admin@caficultor.com', password: 'admin123', name: 'Administrador' }
  });

  // Lo que createWithDefaults no cubre porque es específico del demo.
  await repos.businesses.forBusiness(bizId).update({
    banner_img: '/uploads/1/banner.jpg',
    logo_img: '/uploads/1/logo.jpg',
    is_open: 0
  });

  const cats = repos.categories.forBusiness(bizId);
  const prods = repos.products.forBusiness(bizId);

  for (const cat of menuData) {
    const catId = await cats.create({ name: cat.name });

    for (const p of cat.products) {
      await prods.create({
        name: p.name,
        description: p.desc,
        price: p.price,
        categoryId: catId,
        image: p.img ? '/uploads/1/' + p.img : ''
      });
    }
  }

  console.log('Seed completado!');
  console.log('Negocio: CAFICULTOR (slug: caficultor)');
  console.log('Admin: admin@caficultor.com / admin123');
  console.log('Categorias: ' + menuData.length);
  console.log('Productos: ' + menuData.reduce((sum, c) => sum + c.products.length, 0));
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
