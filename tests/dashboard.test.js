const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

let context;

async function startTestServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-platform-dashboard-'));
  const server = createServer({
    dataDir: path.join(root, 'data'),
    uploadDir: path.join(root, 'uploads'),
    tokenSecret: 'dashboard-test'
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

async function seedClassroom() {
  const teacher = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'teacher',
      name: 'Teacher Dashboard',
      email: 'dashboard-teacher@example.com',
      password: 'teacher123',
      subject: '外科学',
      inviteCode: 'TEACHER2026'
    }
  });
  assert.equal(teacher.response.status, 201);

  const student = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Dashboard',
      email: 'dashboard-student@example.com',
      password: 'student123',
      className: '一年级',
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

  const teacherToken = await login('dashboard-teacher@example.com', 'teacher123', 'teacher');
  const studentToken = await login('dashboard-student@example.com', 'student123', 'student');

  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Dashboard Course',
      description: 'Dashboard data source',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);
  const courseId = course.data.course.id;

  const section = await api(`/api/courses/${courseId}/sections`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Video Task',
      contentType: 'video',
      textContent: 'Watch the lesson'
    }
  });
  assert.equal(section.response.status, 201);

  const assignment = await api(`/api/courses/${courseId}/assignments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Reflection',
      description: 'Submit one paragraph',
      dueDate: '2026-07-01'
    }
  });
  assert.equal(assignment.response.status, 201);

  const announcement = await api(`/api/courses/${courseId}/announcements`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: '课前提醒',
      content: '请先看任务点。'
    }
  });
  assert.equal(announcement.response.status, 201);

  const discussion = await api(`/api/courses/${courseId}/discussions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: {
      title: '学习问题',
      content: '这节课的重点是什么？'
    }
  });
  assert.equal(discussion.response.status, 201);

  const submission = await api(`/api/assignments/${assignment.data.assignment.id}/submissions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: { content: 'My homework.' }
  });
  assert.equal(submission.response.status, 201);

  return { adminToken, teacherToken, studentToken };
}

beforeEach(async () => {
  context = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(context);
  context = undefined;
});

test('builds a student dashboard with continue learning, todos, courses, and announcements', async () => {
  const { studentToken } = await seedClassroom();

  const dashboard = await api('/api/dashboard', {
    headers: { authorization: `Bearer ${studentToken}` }
  });

  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.dashboard.role, 'student');
  assert.equal(dashboard.data.dashboard.metrics.availableCourses, 1);
  assert.equal(dashboard.data.dashboard.continueLearning.courseTitle, 'Dashboard Course');
  assert.equal(dashboard.data.dashboard.todayTodos.some((item) => item.type === 'section' && item.title === 'Video Task'), true);
  assert.equal(dashboard.data.dashboard.recentAnnouncements[0].title, '课前提醒');
});

test('builds a teacher dashboard with quick course stats, pending reviews, progress, and interactions', async () => {
  const { teacherToken } = await seedClassroom();

  const dashboard = await api('/api/dashboard', {
    headers: { authorization: `Bearer ${teacherToken}` }
  });

  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.dashboard.role, 'teacher');
  assert.equal(dashboard.data.dashboard.metrics.courses, 1);
  assert.equal(dashboard.data.dashboard.metrics.pendingReviews, 1);
  assert.equal(dashboard.data.dashboard.pendingReviews[0].assignmentTitle, 'Reflection');
  assert.equal(dashboard.data.dashboard.progressSnapshot[0].courseTitle, 'Dashboard Course');
  assert.equal(dashboard.data.dashboard.recentInteractions[0].title, '学习问题');
});

test('builds an admin dashboard with data overview and account/course management summaries', async () => {
  const { adminToken } = await seedClassroom();

  const dashboard = await api('/api/dashboard', {
    headers: { authorization: `Bearer ${adminToken}` }
  });

  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.dashboard.role, 'admin');
  assert.equal(dashboard.data.dashboard.metrics.totalCourses, 1);
  assert.equal(dashboard.data.dashboard.metrics.publishedCourses, 1);
  assert.equal(dashboard.data.dashboard.metrics.students, 1);
  assert.equal(dashboard.data.dashboard.metrics.teachers, 1);
  assert.equal(dashboard.data.dashboard.courseOverview[0].title, 'Dashboard Course');
  assert.equal(dashboard.data.dashboard.teacherReviews.pending, 0);
});
