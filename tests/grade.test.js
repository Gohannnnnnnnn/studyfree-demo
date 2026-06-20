const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

let context;

async function startTestServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-platform-grade-'));
  const server = createServer({
    dataDir: path.join(root, 'data'),
    uploadDir: path.join(root, 'uploads'),
    tokenSecret: 'grade-test'
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    root,
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function stopTestServer(ctx) {
  if (!ctx) return;
  await new Promise((resolve) => ctx.server.close(resolve));
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

async function api(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${context.baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') && text ? JSON.parse(text) : text;
  return { response, data };
}

async function login(email, password, role) {
  const result = await api('/api/login', {
    method: 'POST',
    body: { email, password, role }
  });
  assert.equal(result.response.status, 200);
  return result.data.token;
}

async function createApprovedTeacher() {
  const registered = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'teacher',
      name: 'Teacher Gao',
      email: 'grade-teacher@example.com',
      password: 'teacher123',
      subject: '外科学',
      inviteCode: 'TEACHER2026'
    }
  });
  assert.equal(registered.response.status, 201);

  const adminToken = await login('admin@example.com', 'admin123456', 'admin');
  const approved = await api(`/api/admin/users/${registered.data.user.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { approved: true }
  });
  assert.equal(approved.response.status, 200);

  return login('grade-teacher@example.com', 'teacher123', 'teacher');
}

beforeEach(async () => {
  context = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(context);
  context = undefined;
});

test('normalizes numeric student grades and rejects unsupported grades', async () => {
  const normalized = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student One',
      email: 'student-one@example.com',
      password: 'student123',
      className: '1',
      inviteCode: 'STUDENT2026'
    }
  });
  assert.equal(normalized.response.status, 201);
  assert.equal(normalized.data.user.className, '一年级');

  const invalid = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Four',
      email: 'student-four@example.com',
      password: 'student123',
      className: '四年级',
      inviteCode: 'STUDENT2026'
    }
  });
  assert.equal(invalid.response.status, 400);
});

test('normalizes and validates course grades for teacher and admin edits', async () => {
  const teacherToken = await createApprovedTeacher();
  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Grade Limited Course',
      description: 'Only one grade can see this course.',
      className: '2',
      published: true
    }
  });
  assert.equal(course.response.status, 201);
  assert.equal(course.data.course.className, '二年级');

  const invalidUpdate = await api(`/api/courses/${course.data.course.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: { className: '四年级' }
  });
  assert.equal(invalidUpdate.response.status, 400);
});

test('students with legacy numeric grade values can still see matching courses', async () => {
  const teacherToken = await createApprovedTeacher();
  const student = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Legacy Grade Student',
      email: 'legacy-grade@example.com',
      password: 'student123',
      className: '1',
      inviteCode: 'STUDENT2026'
    }
  });
  assert.equal(student.response.status, 201);

  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'First Grade Course',
      description: 'Visible to first grade students.',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  const studentToken = await login('legacy-grade@example.com', 'student123', 'student');
  const courses = await api('/api/courses', {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(courses.response.status, 200);
  assert.deepEqual(courses.data.courses.map((item) => item.title), ['First Grade Course']);
});
