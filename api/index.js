const { handler } = require('../server').createApp();

module.exports = (req, res) => {
  const route = req.query?.route ?? new URL(req.url, 'http://localhost').searchParams.get('route');
  if (route) req.url = `/api/${Array.isArray(route) ? route.join('/') : route}`;
  return handler(req, res);
};
