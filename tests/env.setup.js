// Fuerza incondicionalmente la DB de test, sin importar qué haya en el shell.
// Nunca usar `||` acá: el objetivo es que sea IMPOSIBLE que `npm test` toque
// otra base, aunque el entorno esté mal configurado. Ver regla no-negociable
// #1 de .claude/skills/enelmapa-dev/SKILL.md (npm run seed borra TODO).
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'enelmapa_dev';
process.env.DB_PASS = 'enelmapa_dev_local';
process.env.DB_NAME = 'enelmapa_test';
process.env.SESSION_SECRET = 'test-secret-not-for-production';

// Desactiva el rate limiting de los logins: la suite hace decenas de logins
// desde la misma IP y no tiene por qué chocar contra un límite pensado para
// atacantes. El limitador se prueba aparte, con su propio límite chico, en
// tests/integration/rate-limit.test.js.
process.env.RATE_LIMIT_LOGIN_MAX = '0';
process.env.RATE_LIMIT_SUPER_MAX = '0';
