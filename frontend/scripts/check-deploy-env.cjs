// Produção usa /api na mesma origem para manter o cookie HttpOnly first-party.
// O upstream HTTPS é definido pelo proxy em netlify.toml ou nginx.conf.
console.log('API de produção: /api (proxy da mesma origem).')
