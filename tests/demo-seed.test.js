const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { seedDemo } = require('../scripts/seed-demo');
const { createServer } = require('../src/server');

test('demo seed creates working student and teacher demo accounts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studyfree-demo-'));
  const dataDir = path.join(root, 'data');
  const uploadDir = path.join(root, 'uploads');
  let server;

  try {
    seedDemo({ rootDir: process.cwd(), dataDir, uploadDir, reset: true });
    server = createServer({ dataDir, uploadDir, tokenSecret: 'demo-test-secret' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = 'http://127.0.0.1:' + server.address().port;

    const login = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'student', email: 'demo-student@example.com', password: 'student123' })
    });
    assert.equal(login.status, 200);
    const loginJson = await login.json();

    const courses = await fetch(baseUrl + '/api/courses', {
      headers: { authorization: 'Bearer ' + loginJson.token }
    });
    assert.equal(courses.status, 200);
    const coursesJson = await courses.json();
    assert.equal(coursesJson.courses.length, 1);
    assert.equal(coursesJson.courses[0].className, '???');

    const teacher = await fetch(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'teacher', email: 'demo-teacher@example.com', password: 'teacher123' })
    });
    assert.equal(teacher.status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
