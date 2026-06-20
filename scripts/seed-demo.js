const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../src/auth');

const DEMO_STUDENT_EMAIL = 'demo-student@example.com';
const DEMO_TEACHER_EMAIL = 'demo-teacher@example.com';
const DEMO_ADMIN_EMAIL = 'admin@example.com';

function now() {
  return new Date().toISOString();
}

function emptyDatabase(createdAt = now()) {
  return {
    users: [],
    invites: [
      { id: 'invite_student_default', code: 'STUDENT2026', role: 'student', active: true, createdAt },
      { id: 'invite_teacher_default', code: 'TEACHER2026', role: 'teacher', active: true, createdAt }
    ],
    courses: [],
    sections: [],
    files: [],
    progress: [],
    assignments: [],
    submissions: [],
    announcements: [],
    checkins: [],
    checkinRecords: [],
    discussions: [],
    discussionReplies: [],
    quizzes: [],
    quizSubmissions: []
  };
}

function ensureArrays(db) {
  const empty = emptyDatabase();
  for (const key of Object.keys(empty)) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
}

function upsertById(items, id, value) {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    items[index] = { ...items[index], ...value };
    return;
  }
  items.push(value);
}

function seedDemo(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(rootDir, 'demo-data');
  const uploadDir = options.uploadDir || process.env.UPLOAD_DIR || path.join(rootDir, 'demo-uploads');
  const filePath = path.join(dataDir, 'db.json');
  const createdAt = now();

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const db =
    !options.reset && fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
      : emptyDatabase(createdAt);

  ensureArrays(db);

  upsertById(db.users, 'user_admin', {
    id: 'user_admin',
    role: 'admin',
    name: '演示管理员',
    email: DEMO_ADMIN_EMAIL,
    passwordHash: hashPassword('admin123456'),
    className: '',
    subject: '',
    approved: true,
    createdAt
  });

  upsertById(db.users, 'user_demo_teacher', {
    id: 'user_demo_teacher',
    role: 'teacher',
    name: '演示教师',
    email: DEMO_TEACHER_EMAIL,
    passwordHash: hashPassword('teacher123'),
    className: '',
    subject: '在线课程',
    approved: true,
    createdAt
  });

  upsertById(db.users, 'user_demo_student', {
    id: 'user_demo_student',
    role: 'student',
    name: '演示学生',
    email: DEMO_STUDENT_EMAIL,
    passwordHash: hashPassword('student123'),
    className: '一年级',
    subject: '',
    approved: true,
    createdAt
  });

  upsertById(db.invites, 'invite_student_default', {
    id: 'invite_student_default',
    code: 'STUDENT2026',
    role: 'student',
    active: true,
    createdAt
  });

  upsertById(db.invites, 'invite_teacher_default', {
    id: 'invite_teacher_default',
    code: 'TEACHER2026',
    role: 'teacher',
    active: true,
    createdAt
  });

  upsertById(db.courses, 'course_demo', {
    id: 'course_demo',
    title: '客户演示课程',
    description: '用于体验课程空间、任务点、资料、公告和学习进度。',
    className: '一年级',
    teacherId: 'user_demo_teacher',
    teacherName: '演示教师',
    published: true,
    createdAt,
    updatedAt: createdAt
  });

  upsertById(db.sections, 'section_demo_intro', {
    id: 'section_demo_intro',
    courseId: 'course_demo',
    title: '课程介绍',
    contentType: 'text',
    textContent: '这是一个演示任务点。学生端可以进入课程学习，并看到任务进度变化。',
    fileId: '',
    order: 1,
    createdAt
  });

  upsertById(db.sections, 'section_demo_upload', {
    id: 'section_demo_upload',
    courseId: 'course_demo',
    title: '批量资料上传说明',
    contentType: 'document',
    textContent: '教师端课程页顶部支持一次选择多个视频、文档或图片资料，系统会自动生成任务点。',
    fileId: '',
    order: 2,
    createdAt
  });

  upsertById(db.assignments, 'assignment_demo', {
    id: 'assignment_demo',
    courseId: 'course_demo',
    title: '课后反馈',
    description: '提交一句学习反馈即可。',
    dueDate: '',
    createdAt
  });

  upsertById(db.announcements, 'announcement_demo', {
    id: 'announcement_demo',
    courseId: 'course_demo',
    title: '欢迎体验',
    content: '这是公开演示课程。请使用提供的学生、教师或管理员账号体验主要流程。',
    createdAt
  });

  upsertById(db.discussions, 'discussion_demo', {
    id: 'discussion_demo',
    courseId: 'course_demo',
    authorId: 'user_demo_teacher',
    authorName: '演示教师',
    title: '课程答疑区',
    content: '客户可以在这里体验讨论区的发布和回复。',
    createdAt
  });

  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
  return { dataDir, uploadDir, filePath };
}

if (require.main === module) {
  const result = seedDemo({
    reset: process.env.DEMO_RESET_ON_START === 'true'
  });
  console.log('Demo data ready at ' + result.filePath);
  console.log('Admin: ' + DEMO_ADMIN_EMAIL + ' / admin123456');
  console.log('Student: ' + DEMO_STUDENT_EMAIL + ' / student123');
  console.log('Teacher: ' + DEMO_TEACHER_EMAIL + ' / teacher123');
}

module.exports = {
  DEMO_ADMIN_EMAIL,
  DEMO_STUDENT_EMAIL,
  DEMO_TEACHER_EMAIL,
  seedDemo
};
