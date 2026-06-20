const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_MAX_BODY_SIZE, createServer } = require('../src/server');

let context;

async function startTestServer(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-platform-'));
  const server = createServer({
    dataDir: path.join(root, 'data'),
    uploadDir: path.join(root, 'uploads'),
    tokenSecret: 'test-secret',
    maxBodySize: options.maxBodySize
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    root,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
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

async function createApprovedTeacher(overrides = {}) {
  const email = overrides.email || 'teacher@example.com';
  const password = overrides.password || 'teacher123';
  const registered = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'teacher',
      name: overrides.name || 'Teacher Chen',
      email,
      password,
      subject: overrides.subject || 'Thoracic Surgery',
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

  return login(email, password, 'teacher');
}

function multipartBody(boundary, parts) {
  const buffers = [];
  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${part.name}"`));
    if (part.filename) buffers.push(Buffer.from(`; filename="${part.filename}"`));
    buffers.push(Buffer.from('\r\n'));
    if (part.contentType) buffers.push(Buffer.from(`content-type: ${part.contentType}\r\n`));
    buffers.push(Buffer.from('\r\n'));
    buffers.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
    buffers.push(Buffer.from('\r\n'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(buffers);
}

beforeEach(async () => {
  context = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(context);
  context = undefined;
});

test('registers students, keeps login roles separate, and requires teacher approval', async () => {
  const student = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Li',
      email: 'student@example.com',
      password: 'student123',
      className: '一年级',
      inviteCode: 'STUDENT2026'
    }
  });
  assert.equal(student.response.status, 201);
  assert.equal(student.data.user.role, 'student');
  assert.equal(student.data.user.approved, true);

  const studentLogin = await api('/api/login', {
    method: 'POST',
    body: { role: 'student', email: 'student@example.com', password: 'student123' }
  });
  assert.equal(studentLogin.response.status, 200);
  assert.ok(studentLogin.data.token);

  const wrongPortal = await api('/api/login', {
    method: 'POST',
    body: { role: 'teacher', email: 'student@example.com', password: 'student123' }
  });
  assert.equal(wrongPortal.response.status, 401);

  const teacher = await api('/api/register', {
    method: 'POST',
    body: {
      role: 'teacher',
      name: 'Teacher Wang',
      email: 'pending-teacher@example.com',
      password: 'teacher123',
      subject: 'Biology',
      inviteCode: 'TEACHER2026'
    }
  });
  assert.equal(teacher.response.status, 201);
  assert.equal(teacher.data.user.approved, false);

  const pendingLogin = await api('/api/login', {
    method: 'POST',
    body: { role: 'teacher', email: 'pending-teacher@example.com', password: 'teacher123' }
  });
  assert.equal(pendingLogin.response.status, 403);
});

test('lets teachers publish a course, upload a section file, and view student progress', async () => {
  const teacherToken = await createApprovedTeacher();

  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Basic Clinical Course',
      description: 'Introductory material for 一年级',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  const boundary = '----course-platform-test';
  const body = Buffer.from([
    `--${boundary}\r\ncontent-disposition: form-data; name="title"\r\n\r\nLesson 1 Handout\r\n`,
    `--${boundary}\r\ncontent-disposition: form-data; name="contentType"\r\n\r\ndocument\r\n`,
    `--${boundary}\r\ncontent-disposition: form-data; name="textContent"\r\n\r\nRead before class.\r\n`,
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="handout.txt"\r\ncontent-type: text/plain\r\n\r\nhello course material\r\n`,
    `--${boundary}--\r\n`
  ].join(''));

  const section = await api(`/api/courses/${course.data.course.id}/sections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${teacherToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  assert.equal(section.response.status, 201);
  assert.ok(section.data.section.fileId);

  const material = await api(`/api/files/${section.data.section.fileId}`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(material.response.status, 200);
  assert.equal(material.data, 'hello course material');

  await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Zhao',
      email: 'learner@example.com',
      password: 'student123',
      className: '一年级',
      inviteCode: 'STUDENT2026'
    }
  });
  const studentToken = await login('learner@example.com', 'student123', 'student');

  const courses = await api('/api/courses', {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(courses.response.status, 200);
  assert.equal(courses.data.courses.length, 1);
  assert.equal(courses.data.courses[0].title, 'Basic Clinical Course');

  const progress = await api('/api/progress', {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: {
      courseId: course.data.course.id,
      sectionId: section.data.section.id,
      percent: 80
    }
  });
  assert.equal(progress.response.status, 200);
  assert.equal(progress.data.progress.completed, false);

  const progressReport = await api(`/api/progress/course/${course.data.course.id}`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(progressReport.response.status, 200);
  assert.equal(progressReport.data.progress[0].studentName, 'Student Zhao');
  assert.equal(progressReport.data.progress[0].percent, 80);
});


test('lets course owners delete task points and clears related progress', async () => {
  const teacherToken = await createApprovedTeacher({ email: 'section-owner@example.com' });
  const otherTeacherToken = await createApprovedTeacher({ email: 'other-section-teacher@example.com' });

  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Task Point Course',
      description: 'Delete task point regression',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  const firstSection = await api(`/api/courses/${course.data.course.id}/sections`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: { title: 'First task', contentType: 'text', textContent: 'Keep learning' }
  });
  assert.equal(firstSection.response.status, 201);

  await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Progress Student',
      email: 'progress-student@example.com',
      password: 'student123',
      className: '一年级',
      inviteCode: 'STUDENT2026'
    }
  });
  const studentToken = await login('progress-student@example.com', 'student123', 'student');
  const progress = await api('/api/progress', {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: { courseId: course.data.course.id, sectionId: firstSection.data.section.id, percent: 100 }
  });
  assert.equal(progress.response.status, 200);

  const blocked = await api(`/api/courses/${course.data.course.id}/sections/${firstSection.data.section.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${otherTeacherToken}` }
  });
  assert.equal(blocked.response.status, 404);

  const deleted = await api(`/api/courses/${course.data.course.id}/sections/${firstSection.data.section.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.section.id, firstSection.data.section.id);

  const detail = await api(`/api/courses/${course.data.course.id}`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.course.sections.length, 0);

  const progressReport = await api(`/api/progress/course/${course.data.course.id}`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(progressReport.response.status, 200);
  assert.equal(progressReport.data.progress.length, 0);
});

test('uses a 10GB default request body limit and honors smaller configured upload limits', async () => {
  assert.equal(DEFAULT_MAX_BODY_SIZE, 10 * 1024 * 1024 * 1024);

  await stopTestServer(context);
  context = await startTestServer({ maxBodySize: 512 });
  const teacherToken = await createApprovedTeacher();
  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Video Upload Limits',
      description: 'Checks friendly upload failure',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  const boundary = '----video-limit-test';
  const body = multipartBody(boundary, [
    { name: 'title', value: 'Large Video' },
    { name: 'contentType', value: 'video' },
    { name: 'textContent', value: 'Video material' },
    { name: 'file', filename: 'large.mp4', contentType: 'video/mp4', value: Buffer.alloc(2048, 1) }
  ]);

  const rejected = await api(`/api/courses/${course.data.course.id}/sections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${teacherToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  assert.equal(rejected.response.status, 413);
  assert.match(rejected.data.error, /too large|exceeds/i);
});

test('reports video watch progress to teachers and administrators', async () => {
  const teacherToken = await createApprovedTeacher();
  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Video Analytics Course',
      description: 'Records video watch progress',
      className: '一年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  const boundary = '----video-progress-test';
  const body = multipartBody(boundary, [
    { name: 'title', value: 'Surgery Video' },
    { name: 'contentType', value: 'video' },
    { name: 'textContent', value: 'Watch this lesson' },
    { name: 'file', filename: 'lesson.mp4', contentType: 'video/mp4', value: Buffer.from('fake video bytes') }
  ]);

  const section = await api(`/api/courses/${course.data.course.id}/sections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${teacherToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  assert.equal(section.response.status, 201);

  await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Video',
      email: 'video-student@example.com',
      password: 'student123',
      className: '一年级',
      inviteCode: 'STUDENT2026'
    }
  });
  const studentToken = await login('video-student@example.com', 'student123', 'student');

  const progress = await api('/api/progress', {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: {
      courseId: course.data.course.id,
      sectionId: section.data.section.id,
      percent: 42,
      watchedSeconds: 125,
      durationSeconds: 300,
      lastPositionSeconds: 126
    }
  });
  assert.equal(progress.response.status, 200);
  assert.equal(progress.data.progress.watchedSeconds, 125);
  assert.equal(progress.data.progress.durationSeconds, 300);
  assert.equal(progress.data.progress.lastPositionSeconds, 126);

  const teacherReport = await api(`/api/progress/course/${course.data.course.id}`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(teacherReport.response.status, 200);
  assert.equal(teacherReport.data.progress[0].studentName, 'Student Video');
  assert.equal(teacherReport.data.progress[0].sectionTitle, 'Surgery Video');
  assert.equal(teacherReport.data.progress[0].sectionContentType, 'video');
  assert.equal(teacherReport.data.progress[0].watchedSeconds, 125);
  assert.equal(teacherReport.data.progress[0].durationSeconds, 300);
  assert.equal(teacherReport.data.progress[0].lastPositionSeconds, 126);

  const adminToken = await login('admin@example.com', 'admin123456', 'admin');
  const adminReport = await api(`/api/progress/course/${course.data.course.id}`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminReport.response.status, 200);
  assert.equal(adminReport.data.progress[0].studentEmail, 'video-student@example.com');
  assert.equal(adminReport.data.progress[0].sectionContentType, 'video');
});

test('supports assignments, student submissions, and teacher review', async () => {
  const teacherToken = await createApprovedTeacher();
  const course = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Surgery Reading',
      description: 'Weekly learning',
      className: '二年级',
      published: true
    }
  });
  assert.equal(course.response.status, 201);

  await api('/api/register', {
    method: 'POST',
    body: {
      role: 'student',
      name: 'Student Sun',
      email: 'assignment-student@example.com',
      password: 'student123',
      className: '二年级',
      inviteCode: 'STUDENT2026'
    }
  });
  const studentToken = await login('assignment-student@example.com', 'student123', 'student');

  const assignment = await api(`/api/courses/${course.data.course.id}/assignments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: {
      title: 'Reflection',
      description: 'Write a short reflection.',
      dueDate: '2026-07-01'
    }
  });
  assert.equal(assignment.response.status, 201);

  const visibleAssignments = await api(`/api/courses/${course.data.course.id}/assignments`, {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(visibleAssignments.response.status, 200);
  assert.equal(visibleAssignments.data.assignments[0].title, 'Reflection');

  const submission = await api(`/api/assignments/${assignment.data.assignment.id}/submissions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: { content: 'My completed work.' }
  });
  assert.equal(submission.response.status, 201);

  const reviewed = await api(`/api/submissions/${submission.data.submission.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${teacherToken}` },
    body: { feedback: 'Good work', score: 95 }
  });
  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.data.submission.feedback, 'Good work');

  const submissions = await api(`/api/assignments/${assignment.data.assignment.id}/submissions`, {
    headers: { authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(submissions.response.status, 200);
  assert.equal(submissions.data.submissions[0].studentName, 'Student Sun');
  assert.equal(submissions.data.submissions[0].score, 95);
});

test('lets admins manage all courses and lets teachers delete only their own courses', async () => {
  const firstTeacherToken = await createApprovedTeacher({
    email: 'teacher-one@example.com',
    name: 'Teacher One'
  });
  const secondTeacherToken = await createApprovedTeacher({
    email: 'teacher-two@example.com',
    name: 'Teacher Two'
  });

  const firstCourse = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${firstTeacherToken}` },
    body: {
      title: 'Teacher One Course',
      description: 'Original description',
      className: '一年级',
      published: false
    }
  });
  assert.equal(firstCourse.response.status, 201);

  const secondCourse = await api('/api/courses', {
    method: 'POST',
    headers: { authorization: `Bearer ${secondTeacherToken}` },
    body: {
      title: 'Teacher Two Course',
      description: 'Second description',
      className: '二年级',
      published: true
    }
  });
  assert.equal(secondCourse.response.status, 201);

  const adminToken = await login('admin@example.com', 'admin123456', 'admin');
  const adminCourses = await api('/api/courses', {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminCourses.response.status, 200);
  assert.deepEqual(
    adminCourses.data.courses.map((course) => course.title).sort(),
    ['Teacher One Course', 'Teacher Two Course']
  );

  const updatedByAdmin = await api(`/api/courses/${firstCourse.data.course.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${adminToken}` },
    body: {
      title: 'Admin Updated Course',
      description: 'Updated by administrator',
      className: '三年级',
      published: true
    }
  });
  assert.equal(updatedByAdmin.response.status, 200);
  assert.equal(updatedByAdmin.data.course.title, 'Admin Updated Course');
  assert.equal(updatedByAdmin.data.course.description, 'Updated by administrator');
  assert.equal(updatedByAdmin.data.course.className, '三年级');
  assert.equal(updatedByAdmin.data.course.published, true);

  const blockedDelete = await api(`/api/courses/${secondCourse.data.course.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${firstTeacherToken}` }
  });
  assert.equal(blockedDelete.response.status, 404);

  const teacherDeletedOwn = await api(`/api/courses/${firstCourse.data.course.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${firstTeacherToken}` }
  });
  assert.equal(teacherDeletedOwn.response.status, 200);
  assert.equal(teacherDeletedOwn.data.course.id, firstCourse.data.course.id);

  const adminDeletedRemaining = await api(`/api/courses/${secondCourse.data.course.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminDeletedRemaining.response.status, 200);

  const remainingCourses = await api('/api/courses', {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(remainingCourses.response.status, 200);
  assert.deepEqual(remainingCourses.data.courses, []);
});
