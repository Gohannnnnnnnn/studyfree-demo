const path = require('node:path');
const { seedDemo } = require('./seed-demo');
const { createServer, DEFAULT_MAX_BODY_SIZE } = require('../src/server');

const rootDir = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'demo-data');
const uploadDir = process.env.UPLOAD_DIR || path.join(rootDir, 'demo-uploads');
const port = Number(process.env.PORT || 3000);

seedDemo({
  rootDir,
  dataDir,
  uploadDir,
  reset: process.env.DEMO_RESET_ON_START === 'true'
});

const server = createServer({
  rootDir,
  dataDir,
  uploadDir,
  tokenSecret: process.env.TOKEN_SECRET || 'studyfree-demo-secret',
  maxBodySize: process.env.MAX_BODY_SIZE || DEFAULT_MAX_BODY_SIZE
});

server.listen(port, () => {
  console.log('StudyFree demo running at http://localhost:' + port);
});
