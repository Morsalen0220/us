// CommonJS Passenger / cPanel Node.js entrypoint (used by BiswasHost & cPanel "Setup Node.js App")
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PASSENGER_APP_ENV = process.env.PASSENGER_APP_ENV || 'production';

import('./server.js')
  .then((mod) => {
    if (typeof mod.startServer === 'function' && !process.env.__TECHHAVEN_STARTED) {
      process.env.__TECHHAVEN_STARTED = '1';
      return mod.startServer();
    }
  })
  .catch((err) => {
    console.error('Failed to boot TechHaven US via app.cjs:', err);
    process.exit(1);
  });
