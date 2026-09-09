// Landing de la plataforma. Dos comportamientos, sin librerías: el proyecto no
// tiene bundler ni paso de build, y nada de esto lo necesita.
(function () {
  'use strict';

  var raiz = document.documentElement;

  // Quien pidió menos movimiento no recibe ninguno: se muestra todo de una y
  // no se observa nada. El CSS ya lo contempla, esto evita además el trabajo
  // del observer.
  var quietud = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Si el navegador no tiene IntersectionObserver, se revela todo de entrada.
  // Vale la misma regla que el <head>: antes contenido visible sin animación
  // que contenido animado que nunca aparece.
  if (quietud || !('IntersectionObserver' in window)) {
    raiz.classList.remove('js');
  } else {
    var observer = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (!entrada.isIntersecting) return;
        entrada.target.classList.add('visible');
        // Se revela una sola vez: reaparecer al volver a subir distrae y
        // además obliga a mantener observados elementos que ya cumplieron.
        observer.unobserve(entrada.target);
      });
    }, {
      // Un poco antes de que entre del todo, para que el elemento ya esté
      // asentado cuando el ojo llega.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.08
    });

    var ocultos = document.querySelectorAll('.reveal');
    for (var i = 0; i < ocultos.length; i++) {
      observer.observe(ocultos[i]);
    }
  }

  // La barra superior se separa del fondo apenas se scrollea. `passive` porque
  // este listener nunca cancela el scroll, y sin la marca el navegador tiene
  // que esperar a ver si lo hace.
  var nav = document.getElementById('nav');
  if (nav) {
    var marcar = function () {
      nav.classList.toggle('pegado', window.scrollY > 12);
    };
    marcar();
    window.addEventListener('scroll', marcar, { passive: true });
  }
})();
