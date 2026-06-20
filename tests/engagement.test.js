const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

let context;

async function startTestServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-platform-engagement-'));
  const server = createServer({
    dataDir: path.join(root, 'data'),
    uploadDir: path.join(root, 'uploads'),
    tokenSecret: 'engagement-test'
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

async function createUsersAndCourse() {
  const teacher = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'teacher',
      name: 'Teacher Liu',
      email: 'teacher-liu@example.com',
      password: 'teacher123',
      subject: 'Clinical Skills',
      inviteCode: 'TEACHER2026'
    }
  });
  assert.equal(teacher.response.status, 201);

  const student = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student He',
      email: 'student-he@example.com',
      password: 'student123',
      className: '三年级',
      inviteCode: 'STUDENT2026'
    }
  });
  assert.equal(student.response.status, 201);

  const adminToken = await login('admin@example.com', 'admin123456', 'admin');
  const approved = await api(`/api/admin/users/${teacher.data.user.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { approved: true }
  });
  assert.equal(approved.response.status, 200);

  const teacherToken = await login('teacher-liu@example.com', 'teacher123', 'teacher');
  const studentToken = await login('student-he@example.com', 'student123', 'student');

  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Learning App Style Course',
      description: 'Course with notices, check-ins, discussions, and quizzes.',
      className: '三年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  return {
    courseId: course.data.course.id,
    studentToken,
    teacherToken
  };
}

beforeEach(async () => {
  context = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(context);
  context = undefined;
});

test('supports course announcements visible to students', async () => {
  const { courseId, studentToken, teacherToken } = await createUsersAndCourse();

  const created = await api(`/api/courses/${courseId}/announcements`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: '课前提醒',
      content: '请在周五前完成第一章任务点。'
    }
  });
  assert.equal(created.response.status, 201);

  const list = await api(`/api/courses/${courseId}/announcements`, {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(list.response.status, 200);
  assert.equal(list.data.announcements[0].title, '课前提醒');
});

test('supports teacher check-ins and student sign-in records', async () => {
  const { courseId, studentToken, teacherToken } = await createUsersAndCourse();

  const checkin = await api(`/api/courses/${courseId}/checkins`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: '第一节课签到',
      code: '2468'
    }
  });
  assert.equal(checkin.response.status, 201);

  const signed = await api(`/api/checkins/${checkin.data.checkin.id}/records`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: { code: '2468' }
  });
  assert.equal(signed.response.status, 201);
  assert.equal(signed.data.record.status, 'signed');

  const report = await api(`/api/courses/${courseId}/checkins`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(report.response.status, 200);
  assert.equal(report.data.checkins[0].records[0].studentName, 'Student He');
});

test('supports course discussion posts and replies', async () => {
  const { courseId, studentToken, teacherToken } = await createUsersAndCourse();

  const post = await api(`/api/courses/${courseId}/discussions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: {
      title: '第一章问题',
      content: '视频里的重点概念能否再解释一次？'
    }
  });
  assert.equal(post.response.status, 201);

  const reply = await api(`/api/discussions/${post.data.discussion.id}/replies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: { content: '课堂上会结合病例再讲一遍。' }
  });
  assert.equal(reply.response.status, 201);

  const list = await api(`/api/courses/${courseId}/discussions`, {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(list.response.status, 200);
  assert.equal(list.data.discussions[0].replyCount, 1);
  assert.equal(list.data.discussions[0].replies[0].authorRole, 'teacher');
});

test('supports simple quizzes and auto-scored student submissions', async () => {
  const { courseId, studentToken, teacherToken } = await createUsersAndCourse();

  const quiz = await api(`/api/courses/${courseId}/quizzes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: '课后测验',
      question: '第一章学习完成后应点击什么？',
      answer: '标记完成'
    }
  });
  assert.equal(quiz.response.status, 201);

  const submitted = await api(`/api/quizzes/${quiz.data.quiz.id}/submissions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: { answer: '标记完成' }
  });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.data.submission.correct, true);
  assert.equal(submitted.data.submission.score, 100);

  const report = await api(`/api/quizzes/${quiz.data.quiz.id}/submissions`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(report.response.status, 200);
  assert.equal(report.data.submissions[0].studentName, 'Student He');
  assert.equal(report.data.submissions[0].score, 100);
});
