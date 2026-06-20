const { createServer } = require('./server');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      cleanup();
      reject(error);
    }

    function onListening() {
      cleanup();
      resolve();
    }

    function cleanup() {
      server.off('error', onError);
      server.off('listening', onListening);
    }

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startLocalAppServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const preferredPort = Number.isInteger(options.preferredPort)
    ? options.preferredPort
    : Number(process.env.PORT || DEFAULT_PORT);
  const attempts = preferredPort === 0 ? 1 : MAX_PORT_ATTEMPTS;

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = preferredPort === 0 ? 0 : preferredPort + attempt;
    const server = createServer({
      rootDir: options.rootDir,
      dataDir: options.dataDir,
      uploadDir: options.uploadDir,
      tokenSecret: options.tokenSecret
    });

    try {
      await listen(server, port, host);
      const actualPort = server.address().port;
      return {
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () => closeServer(server)
      };
    } catch (error) {
      lastError = error;
      await closeServer(server).catch(() => {});
      if (error.code !== 'EADDRINUSE' || preferredPort === 0) {
        throw error;
      }
    }
  }

  throw Object.assign(new Error(`No available local port found near ${preferredPort}.`), {
    cause: lastError
  });
}

module.exports = {
  startLocalAppServer
};
