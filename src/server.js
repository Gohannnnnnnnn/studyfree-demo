const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createToken, publicUser, verifyPassword, verifyToken } = require('./auth');
const { parseMultipart } = require('./multipart');
const { JsonStore } = require('./store');

const DEFAULT_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-before-production';
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, {
    error: status >= 500 ? 'Internal server error.' : error.message
  });
}

function resolveMaxBodySize(value) {
  const configured = Number(value || process.env.MAX_BODY_SIZE || DEFAULT_MAX_BODY_SIZE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BODY_SIZE;
}

function readBody(req, maxBodySize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBodySize) {
        tooLarge = true;
        chunks.length = 0;
        const maxMb = Math.round(maxBodySize / 1024 / 1024);
        reject(Object.assign(new Error(`Request body exceeds the ${maxMb}MB upload limit.`), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function parseRequestBody(req, maxBodySize) {
  const raw = await readBody(req, maxBodySize);
  const contentType = req.headers['content-type'] || '';
  if (!raw.length) return {};
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
    }
  }
  return raw;
}

function getBearerToken(req, url) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return url.searchParams.get('token') || '';
}

function createStaticHandler(publicDir) {
  return function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(publicDir, safePath);
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}

function createServer(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const store = new JsonStore({
    dataDir: options.dataDir || process.env.DATA_DIR || path.join(rootDir, 'data'),
    uploadDir: options.uploadDir || process.env.UPLOAD_DIR || path.join(rootDir, 'uploads')
  });
  const tokenSecret = options.tokenSecret || DEFAULT_SECRET;
  const maxBodySize = resolveMaxBodySize(options.maxBodySize);
  const publicDir = path.join(rootDir, 'public');
  const serveStatic = createStaticHandler(publicDir);

  async function requireUser(req, url) {
    const token = getBearerToken(req, url);
    const payload = verifyToken(token, tokenSecret);
    if (!payload) {
      throw Object.assign(new Error('Authentication is required.'), { status: 401 });
    }
    const user = store.findUserById(payload.sub);
    if (!user || user.role !== payload.role || !user.approved) {
      throw Object.assign(new Error('Account is not active.'), { status: 403 });
    }
    return user;
  }

  async function handleApi(req, res, url) {
    const segments = url.pathname.split('/').filter(Boolean);
    const method = req.method;

    if (method === 'POST' && url.pathname === '/api/register') {
      const body = await parseRequestBody(req, maxBodySize);
      const user = store.createUser(body);
      return sendJson(res, 201, { user });
    }

    if (method === 'POST' && url.pathname === '/api/login') {
      const body = await parseRequestBody(req, maxBodySize);
      const user = store.findUserByEmailAndRole(body.email, body.role);
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        throw Object.assign(new Error('Email, password, or login role is incorrect.'), { status: 401 });
      }
      if (!user.approved) {
        throw Object.assign(new Error('This account is waiting for approval.'), { status: 403 });
      }
      const token = createToken(user, tokenSecret);
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    if (method === 'GET' && url.pathname === '/api/me') {
      const user = await requireUser(req, url);
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (method === 'GET' && url.pathname === '/api/dashboard') {
      const user = await requireUser(req, url);
      return sendJson(res, 200, { dashboard: store.dashboardFor(user) });
    }

    if (method === 'GET' && url.pathname === '/api/courses') {
      const user = await requireUser(req, url);
      return sendJson(res, 200, { courses: store.listCoursesFor(user) });
    }

    if (method === 'POST' && url.pathname === '/api/courses') {
      const user = await requireUser(req, url);
      const course = store.createCourse(user, await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { course });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments.length === 3 && method === 'GET') {
      const user = await requireUser(req, url);
      const course = store.getCourseWithSections(user, segments[2]);
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { course });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments.length === 3 && method === 'PATCH') {
      const user = await requireUser(req, url);
      const course = store.updateCourse(user, segments[2], await parseRequestBody(req, maxBodySize));
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { course });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments.length === 3 && method === 'DELETE') {
      const user = await requireUser(req, url);
      const course = store.deleteCourse(user, segments[2]);
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { course });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'sections' && method === 'POST') {
      const user = await requireUser(req, url);
      const contentType = req.headers['content-type'] || '';
      let input;
      if (contentType.includes('multipart/form-data')) {
        const raw = await readBody(req, maxBodySize);
        const parsed = parseMultipart(raw, contentType);
        const file = parsed.files[0] ? store.createFile(user, parsed.files[0]) : null;
        input = { ...parsed.fields, fileId: file?.id || '' };
      } else {
        input = await parseRequestBody(req, maxBodySize);
      }
      const section = store.createSection(user, segments[2], input);
      return sendJson(res, 201, { section });
    }

    if (segments[0] === 'api' && segments[1] === 'files' && segments.length === 3 && method === 'GET') {
      const user = await requireUser(req, url);
      const file = store.findFile(segments[2]);
      if (!file || !store.userCanAccessFile(user, file.id)) {
        throw Object.assign(new Error('File not found.'), { status: 404 });
      }
      const filePath = store.filePathFor(file);
      if (!fs.existsSync(filePath)) {
        throw Object.assign(new Error('File is missing on disk.'), { status: 404 });
      }
      res.writeHead(200, {
        'content-type': file.mimeType,
        'content-length': file.size,
        'content-disposition': `inline; filename="${encodeURIComponent(file.originalName)}"`
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (method === 'POST' && url.pathname === '/api/progress') {
      const user = await requireUser(req, url);
      const progress = store.upsertProgress(user, await parseRequestBody(req, maxBodySize));
      return sendJson(res, 200, { progress });
    }

    if (segments[0] === 'api' && segments[1] === 'progress' && segments[2] === 'course' && method === 'GET') {
      const user = await requireUser(req, url);
      const progress = store.listProgressForCourse(user, segments[3]);
      if (!progress) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { progress });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'assignments' && method === 'POST') {
      const user = await requireUser(req, url);
      const assignment = store.createAssignment(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { assignment });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'assignments' && method === 'GET') {
      const user = await requireUser(req, url);
      const assignments = store.listAssignments(user, segments[2]);
      if (!assignments) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { assignments });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'announcements' && method === 'POST') {
      const user = await requireUser(req, url);
      const announcement = store.createAnnouncement(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { announcement });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'announcements' && method === 'GET') {
      const user = await requireUser(req, url);
      const announcements = store.listAnnouncements(user, segments[2]);
      if (!announcements) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { announcements });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'checkins' && method === 'POST') {
      const user = await requireUser(req, url);
      const checkin = store.createCheckin(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { checkin });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'checkins' && method === 'GET') {
      const user = await requireUser(req, url);
      const checkins = store.listCheckins(user, segments[2]);
      if (!checkins) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { checkins });
    }

    if (segments[0] === 'api' && segments[1] === 'checkins' && segments[3] === 'records' && method === 'POST') {
      const user = await requireUser(req, url);
      const record = store.signCheckin(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { record });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'discussions' && method === 'POST') {
      const user = await requireUser(req, url);
      const discussion = store.createDiscussion(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { discussion });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'discussions' && method === 'GET') {
      const user = await requireUser(req, url);
      const discussions = store.listDiscussions(user, segments[2]);
      if (!discussions) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { discussions });
    }

    if (segments[0] === 'api' && segments[1] === 'discussions' && segments[3] === 'replies' && method === 'POST') {
      const user = await requireUser(req, url);
      const reply = store.createDiscussionReply(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { reply });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'quizzes' && method === 'POST') {
      const user = await requireUser(req, url);
      const quiz = store.createQuiz(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { quiz });
    }

    if (segments[0] === 'api' && segments[1] === 'courses' && segments[3] === 'quizzes' && method === 'GET') {
      const user = await requireUser(req, url);
      const quizzes = store.listQuizzes(user, segments[2]);
      if (!quizzes) throw Object.assign(new Error('Course not found.'), { status: 404 });
      return sendJson(res, 200, { quizzes });
    }

    if (segments[0] === 'api' && segments[1] === 'quizzes' && segments[3] === 'submissions' && method === 'POST') {
      const user = await requireUser(req, url);
      const submission = store.createQuizSubmission(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { submission });
    }

    if (segments[0] === 'api' && segments[1] === 'quizzes' && segments[3] === 'submissions' && method === 'GET') {
      const user = await requireUser(req, url);
      const submissions = store.listQuizSubmissions(user, segments[2]);
      if (!submissions) throw Object.assign(new Error('Quiz not found.'), { status: 404 });
      return sendJson(res, 200, { submissions });
    }

    if (segments[0] === 'api' && segments[1] === 'assignments' && segments[3] === 'submissions' && method === 'POST') {
      const user = await requireUser(req, url);
      const submission = store.createSubmission(user, segments[2], await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { submission });
    }

    if (segments[0] === 'api' && segments[1] === 'assignments' && segments[3] === 'submissions' && method === 'GET') {
      const user = await requireUser(req, url);
      const submissions = store.listSubmissions(user, segments[2]);
      if (!submissions) throw Object.assign(new Error('Assignment not found.'), { status: 404 });
      return sendJson(res, 200, { submissions });
    }

    if (segments[0] === 'api' && segments[1] === 'submissions' && segments.length === 3 && method === 'PATCH') {
      const user = await requireUser(req, url);
      const submission = store.reviewSubmission(user, segments[2], await parseRequestBody(req, maxBodySize));
      if (!submission) throw Object.assign(new Error('Submission not found.'), { status: 404 });
      return sendJson(res, 200, { submission });
    }

    if (method === 'GET' && url.pathname === '/api/admin/users') {
      const user = await requireUser(req, url);
      if (user.role !== 'admin') throw Object.assign(new Error('Admin access is required.'), { status: 403 });
      return sendJson(res, 200, { users: store.listUsers(), invites: store.listInvites() });
    }

    if (segments[0] === 'api' && segments[1] === 'admin' && segments[2] === 'users' && method === 'PATCH') {
      const user = await requireUser(req, url);
      if (user.role !== 'admin') throw Object.assign(new Error('Admin access is required.'), { status: 403 });
      const updated = store.updateUser(segments[3], await parseRequestBody(req, maxBodySize));
      if (!updated) throw Object.assign(new Error('User not found.'), { status: 404 });
      return sendJson(res, 200, { user: updated });
    }

    if (method === 'POST' && url.pathname === '/api/admin/invites') {
      const user = await requireUser(req, url);
      if (user.role !== 'admin') throw Object.assign(new Error('Admin access is required.'), { status: 403 });
      const invite = store.createInvite(await parseRequestBody(req, maxBodySize));
      return sendJson(res, 201, { invite });
    }

    throw Object.assign(new Error('Route not found.'), { status: 404 });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization'
        });
        return res.end();
      }
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(req, res, url);
      }
      if (serveStatic(req, res, url)) return;
      sendJson(res, 404, { error: 'Page not found.' });
    } catch (error) {
      sendError(res, error);
    }
  });

  server.store = store;
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`Course platform running at http://localhost:${DEFAULT_PORT}`);
  });
}

module.exports = {
  DEFAULT_MAX_BODY_SIZE,
  createServer
};
