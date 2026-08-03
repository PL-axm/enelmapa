const express = require('express');
const router = express.Router();

router.get('*', (req, res) => {
  const { business, businessHours, categories, products } = req;

  const menuData = categories.map(cat => ({
    id: cat.id,
    name: cat.name,
    products: products
      .filter(p => p.category_id === cat.id)
      .map(p => ({
        id: p.id,
        name: p.name,
        desc: p.description,
        price: p.price,
        img: p.image || ''
      }))
  })).filter(cat => cat.products.length > 0);

  res.render('menu', {
    business,
    hours: businessHours,
    menuData
  });
});

module.exports = router;
