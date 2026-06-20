const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword, publicUser } = require('./auth');

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const GRADE_ALIASES = new Map([
  ['1', '一年级'],
  ['一', '一年级'],
  ['一年', '一年级'],
  ['一年级', '一年级'],
  ['2', '二年级'],
  ['二', '二年级'],
  ['二年', '二年级'],
  ['二年级', '二年级'],
  ['3', '三年级'],
  ['三', '三年级'],
  ['三年', '三年级'],
  ['三年级', '三年级']
]);

function gradeError() {
  return Object.assign(new Error('年级只能选择一年级、二年级或三年级。'), { status: 400 });
}

function normalizeGrade(value, { allowEmpty = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    if (allowEmpty) return '';
    throw gradeError();
  }
  const normalized = GRADE_ALIASES.get(raw);
  if (!normalized) throw gradeError();
  return normalized;
}

function normalizeGradeIfKnown(value) {
  const raw = String(value || '').trim();
  return GRADE_ALIASES.get(raw) || raw;
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clampPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function safeSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds);
}

function createEmptyDatabase() {
  const createdAt = now();
  return {
    users: [
      {
        id: 'user_admin',
        role: 'admin',
        name: 'System Admin',
        email: 'admin@example.com',
        passwordHash: hashPassword('admin123456'),
        className: '',
        subject: '',
        approved: true,
        createdAt
      }
    ],
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

class JsonStore {
  constructor({ dataDir, uploadDir }) {
    this.dataDir = dataDir;
    this.uploadDir = uploadDir;
    this.filePath = path.join(dataDir, 'db.json');
    ensureDirectory(dataDir);
    ensureDirectory(uploadDir);
    this.data = this.load();
    this.migrateGrades();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      const seeded = createEmptyDatabase();
      this.write(seeded);
      return seeded;
    }
    const loaded = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    const empty = createEmptyDatabase();
    let migrated = false;
    for (const key of Object.keys(empty)) {
      if (!Array.isArray(loaded[key])) {
        loaded[key] = [];
        migrated = true;
      }
    }
    if (migrated) this.write(loaded);
    return loaded;
  }

  migrateGrades() {
    let migrated = false;
    for (const user of this.data.users) {
      if (user.role !== 'student') continue;
      const normalized = normalizeGradeIfKnown(user.className);
      if (normalized !== user.className) {
        user.className = normalized;
        migrated = true;
      }
    }
    for (const course of this.data.courses) {
      const normalized = normalizeGradeIfKnown(course.className);
      if (normalized !== course.className) {
        course.className = normalized;
        migrated = true;
      }
    }
    if (migrated) this.save();
  }

  write(data = this.data) {
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, this.filePath);
  }

  save() {
    this.write(this.data);
  }

  findUserById(userId) {
    return this.data.users.find((user) => user.id === userId) || null;
  }

  findUserByEmailAndRole(email, role) {
    const normalized = normalizeEmail(email);
    return this.data.users.find((user) => user.email === normalized && user.role === role) || null;
  }

  emailExists(email) {
    const normalized = normalizeEmail(email);
    return this.data.users.some((user) => user.email === normalized);
  }

  findInvite(code, role) {
    const normalized = String(code || '').trim();
    return this.data.invites.find((invite) => invite.code === normalized && invite.role === role && invite.active) || null;
  }

  createUser(input) {
    const role = String(input.role || '').trim();
    if (!['student', 'teacher'].includes(role)) {
      throw Object.assign(new Error('Only students and teachers can register.'), { status: 400 });
    }
    if (!this.findInvite(input.inviteCode, role)) {
      throw Object.assign(new Error('Invite code is invalid or inactive.'), { status: 403 });
    }
    const email = normalizeEmail(input.email);
    if (!email || !String(input.password || '').trim() || !String(input.name || '').trim()) {
      throw Object.assign(new Error('Name, email, and password are required.'), { status: 400 });
    }
    if (this.emailExists(email)) {
      throw Object.assign(new Error('This email is already registered.'), { status: 409 });
    }
    const className = role === 'student' ? normalizeGrade(input.className) : '';
    if (role === 'teacher' && !String(input.subject || '').trim()) {
      throw Object.assign(new Error('Subject is required for teachers.'), { status: 400 });
    }

    const user = {
      id: id('user'),
      role,
      name: String(input.name).trim(),
      email,
      passwordHash: hashPassword(input.password),
      className,
      subject: role === 'teacher' ? String(input.subject).trim() : '',
      approved: role === 'student',
      createdAt: now()
    };
    this.data.users.push(user);
    this.save();
    return publicUser(user);
  }

  updateUser(userId, patch) {
    const user = this.findUserById(userId);
    if (!user) return null;
    if (typeof patch.approved === 'boolean') user.approved = patch.approved;
    if (typeof patch.name === 'string' && patch.name.trim()) user.name = patch.name.trim();
    if (typeof patch.className === 'string') user.className = normalizeGrade(patch.className);
    if (typeof patch.subject === 'string') user.subject = patch.subject.trim();
    this.save();
    return publicUser(user);
  }

  listUsers() {
    return this.data.users.map(publicUser);
  }

  createInvite(input) {
    const role = String(input.role || '').trim();
    if (!['student', 'teacher'].includes(role)) {
      throw Object.assign(new Error('Invite role must be student or teacher.'), { status: 400 });
    }
    const code = String(input.code || '').trim() || crypto.randomBytes(5).toString('hex').toUpperCase();
    const invite = {
      id: id('invite'),
      code,
      role,
      active: input.active !== false,
      createdAt: now()
    };
    this.data.invites.push(invite);
    this.save();
    return invite;
  }

  listInvites() {
    return this.data.invites;
  }

  createCourse(user, input) {
    if (!['teacher', 'admin'].includes(user.role)) {
      throw Object.assign(new Error('Only teachers and admins can create courses.'), { status: 403 });
    }
    if (!String(input.title || '').trim()) {
      throw Object.assign(new Error('Course title is required.'), { status: 400 });
    }
    const timestamp = now();
    const course = {
      id: id('course'),
      teacherId: user.role === 'teacher' ? user.id : String(input.teacherId || user.id),
      title: String(input.title).trim(),
      description: String(input.description || '').trim(),
      className: normalizeGrade(input.className, { allowEmpty: true }),
      cover: String(input.cover || '').trim(),
      published: Boolean(input.published),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.courses.push(course);
    this.save();
    return course;
  }

  updateCourse(user, courseId, patch) {
    const course = this.findCourse(courseId);
    if (!course || !this.canManageCourse(user, course)) return null;
    for (const key of ['title', 'description', 'cover']) {
      if (typeof patch[key] === 'string') course[key] = patch[key].trim();
    }
    if (typeof patch.className === 'string') course.className = normalizeGrade(patch.className, { allowEmpty: true });
    if (typeof patch.published === 'boolean') course.published = patch.published;
    course.updatedAt = now();
    this.save();
    return course;
  }

  deleteCourse(user, courseId) {
    const course = this.findCourse(courseId);
    if (!course || !this.canManageCourse(user, course)) return null;

    const sectionFileIds = new Set(
      this.data.sections
        .filter((section) => section.courseId === courseId && section.fileId)
        .map((section) => section.fileId)
    );
    const assignmentIds = new Set(this.data.assignments.filter((assignment) => assignment.courseId === courseId).map((assignment) => assignment.id));
    const checkinIds = new Set(this.data.checkins.filter((checkin) => checkin.courseId === courseId).map((checkin) => checkin.id));
    const discussionIds = new Set(this.data.discussions.filter((discussion) => discussion.courseId === courseId).map((discussion) => discussion.id));
    const quizIds = new Set(this.data.quizzes.filter((quiz) => quiz.courseId === courseId).map((quiz) => quiz.id));

    this.data.courses = this.data.courses.filter((candidate) => candidate.id !== courseId);
    this.data.sections = this.data.sections.filter((section) => section.courseId !== courseId);
    this.data.progress = this.data.progress.filter((record) => record.courseId !== courseId);
    this.data.announcements = this.data.announcements.filter((announcement) => announcement.courseId !== courseId);
    this.data.assignments = this.data.assignments.filter((assignment) => assignment.courseId !== courseId);
    this.data.submissions = this.data.submissions.filter((submission) => !assignmentIds.has(submission.assignmentId));
    this.data.checkins = this.data.checkins.filter((checkin) => checkin.courseId !== courseId);
    this.data.checkinRecords = this.data.checkinRecords.filter((record) => !checkinIds.has(record.checkinId));
    this.data.discussions = this.data.discussions.filter((discussion) => discussion.courseId !== courseId);
    this.data.discussionReplies = this.data.discussionReplies.filter((reply) => !discussionIds.has(reply.discussionId));
    this.data.quizzes = this.data.quizzes.filter((quiz) => quiz.courseId !== courseId);
    this.data.quizSubmissions = this.data.quizSubmissions.filter((submission) => !quizIds.has(submission.quizId));

    const removableFileIds = [...sectionFileIds].filter(
      (fileId) => !this.data.sections.some((section) => section.fileId === fileId)
    );
    for (const fileId of removableFileIds) {
      const file = this.findFile(fileId);
      if (!file) continue;
      const storedPath = this.filePathFor(file);
      if (fs.existsSync(storedPath)) fs.rmSync(storedPath, { force: true });
    }
    this.data.files = this.data.files.filter((file) => !removableFileIds.includes(file.id));

    this.save();
    return course;
  }

  findCourse(courseId) {
    return this.data.courses.find((course) => course.id === courseId) || null;
  }

  canManageCourse(user, course) {
    return Boolean(user && course && (user.role === 'admin' || (user.role === 'teacher' && course.teacherId === user.id)));
  }

  canAccessCourse(user, course) {
    if (!user || !course) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'teacher') return course.teacherId === user.id;
    if (user.role === 'student') {
      const courseGrade = normalizeGradeIfKnown(course.className);
      const studentGrade = normalizeGradeIfKnown(user.className);
      return course.published && (!courseGrade || courseGrade === studentGrade);
    }
    return false;
  }

  listCoursesFor(user) {
    return this.data.courses
      .filter((course) => this.canAccessCourse(user, course))
      .map((course) => ({
        ...course,
        teacherName: this.findUserById(course.teacherId)?.name || 'Unknown Teacher',
        sectionCount: this.data.sections.filter((section) => section.courseId === course.id).length
      }));
  }

  dashboardFor(user) {
    if (user.role === 'student') return this.studentDashboard(user);
    if (user.role === 'teacher') return this.teacherDashboard(user);
    if (user.role === 'admin') return this.adminDashboard(user);
    return { role: user.role };
  }

  courseSummary(course) {
    return {
      ...course,
      teacherName: this.findUserById(course.teacherId)?.name || 'Unknown Teacher',
      sectionCount: this.data.sections.filter((section) => section.courseId === course.id).length
    };
  }

  courseProgressForStudent(user, course) {
    const sections = this.data.sections
      .filter((section) => section.courseId === course.id)
      .sort((a, b) => a.order - b.order);
    const records = this.data.progress.filter((record) => record.courseId === course.id && record.studentId === user.id);
    const completed = sections.filter((section) => records.find((record) => record.sectionId === section.id)?.completed).length;
    const nextSection = sections.find((section) => !records.find((record) => record.sectionId === section.id)?.completed) || sections[0] || null;
    return {
      courseId: course.id,
      courseTitle: course.title,
      percent: sections.length ? Math.round((completed / sections.length) * 100) : 0,
      completedSections: completed,
      totalSections: sections.length,
      nextSectionTitle: nextSection?.title || ''
    };
  }

  studentDashboard(user) {
    const courses = this.listCoursesFor(user);
    const courseIds = new Set(courses.map((course) => course.id));
    const progressByCourse = courses.map((course) => this.courseProgressForStudent(user, course));
    const continueLearning = progressByCourse.find((item) => item.percent < 100) || progressByCourse[0] || null;
    const todayTodos = [];

    for (const course of courses) {
      const progress = this.courseProgressForStudent(user, course);
      if (progress.nextSectionTitle && progress.percent < 100) {
        todayTodos.push({
          type: 'section',
          title: progress.nextSectionTitle,
          courseId: course.id,
          courseTitle: course.title,
          hint: '继续任务点'
        });
      }

      for (const assignment of this.data.assignments.filter((item) => item.courseId === course.id)) {
        const submitted = this.data.submissions.some((submission) => submission.assignmentId === assignment.id && submission.studentId === user.id);
        if (!submitted) {
          todayTodos.push({
            type: 'assignment',
            title: assignment.title,
            courseId: course.id,
            courseTitle: course.title,
            hint: assignment.dueDate ? `截止 ${assignment.dueDate}` : '待提交'
          });
        }
      }

      for (const checkin of this.data.checkins.filter((item) => item.courseId === course.id && item.active)) {
        const signed = this.data.checkinRecords.some((record) => record.checkinId === checkin.id && record.studentId === user.id);
        if (!signed) {
          todayTodos.push({
            type: 'checkin',
            title: checkin.title,
            courseId: course.id,
            courseTitle: course.title,
            hint: '待签到'
          });
        }
      }

      for (const quiz of this.data.quizzes.filter((item) => item.courseId === course.id)) {
        const submitted = this.data.quizSubmissions.some((submission) => submission.quizId === quiz.id && submission.studentId === user.id);
        if (!submitted) {
          todayTodos.push({
            type: 'quiz',
            title: quiz.title,
            courseId: course.id,
            courseTitle: course.title,
            hint: '待测验'
          });
        }
      }
    }

    const recentAnnouncements = this.data.announcements
      .filter((announcement) => courseIds.has(announcement.courseId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((announcement) => ({
        ...announcement,
        courseTitle: this.findCourse(announcement.courseId)?.title || ''
      }));

    return {
      role: 'student',
      metrics: {
        availableCourses: courses.length,
        unfinishedTasks: todayTodos.length,
        recentAnnouncements: recentAnnouncements.length,
        averageProgress: progressByCourse.length
          ? Math.round(progressByCourse.reduce((sum, item) => sum + item.percent, 0) / progressByCourse.length)
          : 0
      },
      continueLearning,
      progressByCourse,
      todayTodos: todayTodos.slice(0, 8),
      recentAnnouncements,
      courses
    };
  }

  teacherDashboard(user) {
    const courses = this.listCoursesFor(user);
    const courseIds = new Set(courses.map((course) => course.id));
    const pendingReviews = [];
    for (const assignment of this.data.assignments.filter((item) => courseIds.has(item.courseId))) {
      const course = this.findCourse(assignment.courseId);
      for (const submission of this.data.submissions.filter((item) => item.assignmentId === assignment.id && !item.reviewedAt)) {
        pendingReviews.push({
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          courseId: assignment.courseId,
          courseTitle: course?.title || '',
          studentName: this.findUserById(submission.studentId)?.name || 'Unknown Student',
          submittedAt: submission.submittedAt
        });
      }
    }

    const progressSnapshot = courses.map((course) => {
      const sections = this.data.sections.filter((section) => section.courseId === course.id);
      const records = this.data.progress.filter((record) => record.courseId === course.id);
      const activeStudents = new Set(records.map((record) => record.studentId)).size;
      const completedRecords = records.filter((record) => record.completed).length;
      return {
        courseId: course.id,
        courseTitle: course.title,
        sectionCount: sections.length,
        activeStudents,
        completedRecords
      };
    });

    const recentInteractions = this.data.discussions
      .filter((discussion) => courseIds.has(discussion.courseId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((discussion) => ({
        id: discussion.id,
        title: discussion.title,
        courseId: discussion.courseId,
        courseTitle: this.findCourse(discussion.courseId)?.title || '',
        authorName: this.findUserById(discussion.authorId)?.name || 'Unknown User',
        createdAt: discussion.createdAt
      }));

    return {
      role: 'teacher',
      metrics: {
        courses: courses.length,
        sections: this.data.sections.filter((section) => courseIds.has(section.courseId)).length,
        pendingReviews: pendingReviews.length,
        recentInteractions: recentInteractions.length
      },
      courses,
      pendingReviews: pendingReviews.slice(0, 8),
      progressSnapshot,
      recentInteractions
    };
  }

  adminDashboard(user) {
    const courses = this.listCoursesFor(user);
    const students = this.data.users.filter((candidate) => candidate.role === 'student');
    const teachers = this.data.users.filter((candidate) => candidate.role === 'teacher');
    const pendingTeachers = teachers.filter((teacher) => !teacher.approved);
    return {
      role: 'admin',
      metrics: {
        totalCourses: courses.length,
        publishedCourses: courses.filter((course) => course.published).length,
        students: students.length,
        teachers: teachers.filter((teacher) => teacher.approved).length,
        pendingTeachers: pendingTeachers.length,
        totalUsers: this.data.users.length
      },
      teacherReviews: {
        pending: pendingTeachers.length,
        users: pendingTeachers.map(publicUser)
      },
      studentAccounts: students.map(publicUser),
      courseOverview: courses
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10),
      invites: this.listInvites()
    };
  }

  getCourseWithSections(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    const sections = this.data.sections
      .filter((section) => section.courseId === courseId)
      .sort((a, b) => a.order - b.order);
    return { ...course, sections };
  }

  createFile(user, file) {
    const storedName = `${crypto.randomUUID()}-${path.basename(file.filename || 'upload.bin').replace(/[^\w.\-]+/g, '_')}`;
    const storedPath = path.join(this.uploadDir, storedName);
    fs.writeFileSync(storedPath, file.content);
    const record = {
      id: id('file'),
      ownerId: user.id,
      originalName: file.filename || 'upload.bin',
      storedName,
      mimeType: file.mimeType || 'application/octet-stream',
      size: file.content.length,
      createdAt: now()
    };
    this.data.files.push(record);
    this.save();
    return record;
  }

  findFile(fileId) {
    return this.data.files.find((file) => file.id === fileId) || null;
  }

  filePathFor(file) {
    return path.join(this.uploadDir, file.storedName);
  }

  createSection(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canManageCourse(user, course)) {
      throw Object.assign(new Error('Course not found or not manageable.'), { status: 404 });
    }
    if (!String(input.title || '').trim()) {
      throw Object.assign(new Error('Section title is required.'), { status: 400 });
    }
    const order = this.data.sections.filter((section) => section.courseId === courseId).length + 1;
    const section = {
      id: id('section'),
      courseId,
      title: String(input.title).trim(),
      contentType: String(input.contentType || 'text').trim(),
      textContent: String(input.textContent || '').trim(),
      fileId: input.fileId || '',
      order,
      createdAt: now()
    };
    this.data.sections.push(section);
    this.save();
    return section;
  }

  userCanAccessFile(user, fileId) {
    const file = this.findFile(fileId);
    if (!user || !file) return false;
    if (user.role === 'admin' || file.ownerId === user.id) return true;
    const section = this.data.sections.find((candidate) => candidate.fileId === fileId);
    if (!section) return false;
    const course = this.findCourse(section.courseId);
    return this.canAccessCourse(user, course);
  }

  upsertProgress(user, input) {
    if (user.role !== 'student') {
      throw Object.assign(new Error('Only students can update progress.'), { status: 403 });
    }
    const course = this.findCourse(input.courseId);
    if (!this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Course not found.'), { status: 404 });
    }
    const section = this.data.sections.find((candidate) => candidate.id === input.sectionId && candidate.courseId === input.courseId);
    if (!section) {
      throw Object.assign(new Error('Section not found.'), { status: 404 });
    }
    const hasPercent = input.percent !== undefined && input.percent !== null && input.percent !== '';
    const durationSeconds = safeSeconds(input.durationSeconds);
    const watchedSeconds = safeSeconds(input.watchedSeconds);
    const lastPositionSeconds = safeSeconds(input.lastPositionSeconds ?? input.watchedSeconds);
    let percent = hasPercent ? clampPercent(input.percent) : 0;
    if (!hasPercent && durationSeconds > 0 && lastPositionSeconds > 0) {
      percent = clampPercent((lastPositionSeconds / durationSeconds) * 100);
    }
    let record = this.data.progress.find(
      (candidate) => candidate.studentId === user.id && candidate.courseId === input.courseId && candidate.sectionId === input.sectionId
    );
    if (!record) {
      record = {
        id: id('progress'),
        studentId: user.id,
        courseId: input.courseId,
        sectionId: input.sectionId,
        percent: 0,
        completed: false,
        watchedSeconds: 0,
        durationSeconds: 0,
        lastPositionSeconds: 0,
        updatedAt: now()
      };
      this.data.progress.push(record);
    }
    record.percent = hasPercent || percent > 0 ? percent : clampPercent(record.percent);
    record.watchedSeconds = Math.max(safeSeconds(record.watchedSeconds), watchedSeconds);
    if (durationSeconds > 0) record.durationSeconds = durationSeconds;
    if (input.lastPositionSeconds !== undefined || input.watchedSeconds !== undefined) {
      record.lastPositionSeconds = lastPositionSeconds;
    } else {
      record.lastPositionSeconds = safeSeconds(record.lastPositionSeconds);
    }
    record.completed = record.percent >= 100
      || (record.durationSeconds > 0 && record.lastPositionSeconds >= Math.max(1, record.durationSeconds - 1));
    record.updatedAt = now();
    this.save();
    return record;
  }

  listProgressForCourse(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    let records = this.data.progress.filter((record) => record.courseId === courseId);
    if (user.role === 'student') {
      records = records.filter((record) => record.studentId === user.id);
    }
    return records.map((record) => {
      const section = this.data.sections.find((candidate) => candidate.id === record.sectionId);
      return {
        ...record,
        watchedSeconds: safeSeconds(record.watchedSeconds),
        durationSeconds: safeSeconds(record.durationSeconds),
        lastPositionSeconds: safeSeconds(record.lastPositionSeconds),
        studentName: this.findUserById(record.studentId)?.name || 'Unknown Student',
        studentEmail: this.findUserById(record.studentId)?.email || '',
        sectionTitle: section?.title || '',
        sectionContentType: section?.contentType || 'text',
        sectionOrder: section?.order || 0
      };
    });
  }

  createAssignment(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canManageCourse(user, course)) {
      throw Object.assign(new Error('Course not found or not manageable.'), { status: 404 });
    }
    if (!String(input.title || '').trim()) {
      throw Object.assign(new Error('Assignment title is required.'), { status: 400 });
    }
    const assignment = {
      id: id('assignment'),
      courseId,
      teacherId: user.role === 'teacher' ? user.id : course.teacherId,
      title: String(input.title).trim(),
      description: String(input.description || '').trim(),
      dueDate: String(input.dueDate || '').trim(),
      createdAt: now()
    };
    this.data.assignments.push(assignment);
    this.save();
    return assignment;
  }

  listAssignments(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    return this.data.assignments.filter((assignment) => assignment.courseId === courseId);
  }

  findAssignment(assignmentId) {
    return this.data.assignments.find((assignment) => assignment.id === assignmentId) || null;
  }

  createSubmission(user, assignmentId, input) {
    if (user.role !== 'student') {
      throw Object.assign(new Error('Only students can submit assignments.'), { status: 403 });
    }
    const assignment = this.findAssignment(assignmentId);
    const course = assignment ? this.findCourse(assignment.courseId) : null;
    if (!assignment || !this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Assignment not found.'), { status: 404 });
    }
    let submission = this.data.submissions.find(
      (candidate) => candidate.assignmentId === assignmentId && candidate.studentId === user.id
    );
    if (!submission) {
      submission = {
        id: id('submission'),
        assignmentId,
        studentId: user.id,
        content: '',
        feedback: '',
        score: null,
        submittedAt: now(),
        reviewedAt: ''
      };
      this.data.submissions.push(submission);
    }
    submission.content = String(input.content || '').trim();
    submission.submittedAt = now();
    this.save();
    return submission;
  }

  listSubmissions(user, assignmentId) {
    const assignment = this.findAssignment(assignmentId);
    const course = assignment ? this.findCourse(assignment.courseId) : null;
    if (!assignment || !this.canManageCourse(user, course)) return null;
    return this.data.submissions
      .filter((submission) => submission.assignmentId === assignmentId)
      .map((submission) => ({
        ...submission,
        studentName: this.findUserById(submission.studentId)?.name || 'Unknown Student',
        studentEmail: this.findUserById(submission.studentId)?.email || ''
      }));
  }

  reviewSubmission(user, submissionId, input) {
    const submission = this.data.submissions.find((candidate) => candidate.id === submissionId);
    const assignment = submission ? this.findAssignment(submission.assignmentId) : null;
    const course = assignment ? this.findCourse(assignment.courseId) : null;
    if (!submission || !this.canManageCourse(user, course)) return null;
    submission.feedback = String(input.feedback || '').trim();
    submission.score = input.score === null || input.score === undefined || input.score === '' ? null : Number(input.score);
    submission.reviewedAt = now();
    this.save();
    return submission;
  }

  createAnnouncement(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canManageCourse(user, course)) {
      throw Object.assign(new Error('Course not found or not manageable.'), { status: 404 });
    }
    if (!String(input.title || '').trim() || !String(input.content || '').trim()) {
      throw Object.assign(new Error('Announcement title and content are required.'), { status: 400 });
    }
    const announcement = {
      id: id('announcement'),
      courseId,
      teacherId: user.role === 'teacher' ? user.id : course.teacherId,
      title: String(input.title).trim(),
      content: String(input.content).trim(),
      createdAt: now()
    };
    this.data.announcements.push(announcement);
    this.save();
    return announcement;
  }

  listAnnouncements(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    return this.data.announcements
      .filter((announcement) => announcement.courseId === courseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createCheckin(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canManageCourse(user, course)) {
      throw Object.assign(new Error('Course not found or not manageable.'), { status: 404 });
    }
    if (!String(input.title || '').trim()) {
      throw Object.assign(new Error('Check-in title is required.'), { status: 400 });
    }
    const checkin = {
      id: id('checkin'),
      courseId,
      teacherId: user.role === 'teacher' ? user.id : course.teacherId,
      title: String(input.title).trim(),
      code: String(input.code || Math.floor(1000 + Math.random() * 9000)).trim(),
      active: input.active !== false,
      createdAt: now()
    };
    this.data.checkins.push(checkin);
    this.save();
    return checkin;
  }

  listCheckins(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    return this.data.checkins
      .filter((checkin) => checkin.courseId === courseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((checkin) => {
        const records = this.data.checkinRecords
          .filter((record) => record.checkinId === checkin.id)
          .filter((record) => user.role === 'student' ? record.studentId === user.id : true)
          .map((record) => ({
            ...record,
            studentName: this.findUserById(record.studentId)?.name || 'Unknown Student',
            studentEmail: this.findUserById(record.studentId)?.email || ''
          }));
        const safeCheckin = { ...checkin, records };
        if (user.role === 'student') delete safeCheckin.code;
        return safeCheckin;
      });
  }

  signCheckin(user, checkinId, input) {
    if (user.role !== 'student') {
      throw Object.assign(new Error('Only students can sign in.'), { status: 403 });
    }
    const checkin = this.data.checkins.find((candidate) => candidate.id === checkinId);
    const course = checkin ? this.findCourse(checkin.courseId) : null;
    if (!checkin || !checkin.active || !this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Check-in not found.'), { status: 404 });
    }
    if (String(input.code || '').trim() !== checkin.code) {
      throw Object.assign(new Error('Check-in code is incorrect.'), { status: 403 });
    }
    let record = this.data.checkinRecords.find(
      (candidate) => candidate.checkinId === checkinId && candidate.studentId === user.id
    );
    if (!record) {
      record = {
        id: id('checkin_record'),
        checkinId,
        studentId: user.id,
        status: 'signed',
        signedAt: now()
      };
      this.data.checkinRecords.push(record);
    } else {
      record.status = 'signed';
      record.signedAt = now();
    }
    this.save();
    return record;
  }

  createDiscussion(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Course not found.'), { status: 404 });
    }
    if (!String(input.title || '').trim() || !String(input.content || '').trim()) {
      throw Object.assign(new Error('Discussion title and content are required.'), { status: 400 });
    }
    const discussion = {
      id: id('discussion'),
      courseId,
      authorId: user.id,
      title: String(input.title).trim(),
      content: String(input.content).trim(),
      createdAt: now()
    };
    this.data.discussions.push(discussion);
    this.save();
    return this.expandDiscussion(discussion);
  }

  expandDiscussion(discussion) {
    const author = this.findUserById(discussion.authorId);
    const replies = this.data.discussionReplies
      .filter((reply) => reply.discussionId === discussion.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((reply) => {
        const replyAuthor = this.findUserById(reply.authorId);
        return {
          ...reply,
          authorName: replyAuthor?.name || 'Unknown User',
          authorRole: replyAuthor?.role || ''
        };
      });
    return {
      ...discussion,
      authorName: author?.name || 'Unknown User',
      authorRole: author?.role || '',
      replyCount: replies.length,
      replies
    };
  }

  listDiscussions(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    return this.data.discussions
      .filter((discussion) => discussion.courseId === courseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((discussion) => this.expandDiscussion(discussion));
  }

  createDiscussionReply(user, discussionId, input) {
    const discussion = this.data.discussions.find((candidate) => candidate.id === discussionId);
    const course = discussion ? this.findCourse(discussion.courseId) : null;
    if (!discussion || !this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Discussion not found.'), { status: 404 });
    }
    if (!String(input.content || '').trim()) {
      throw Object.assign(new Error('Reply content is required.'), { status: 400 });
    }
    const reply = {
      id: id('discussion_reply'),
      discussionId,
      authorId: user.id,
      content: String(input.content).trim(),
      createdAt: now()
    };
    this.data.discussionReplies.push(reply);
    this.save();
    const author = this.findUserById(reply.authorId);
    return {
      ...reply,
      authorName: author?.name || 'Unknown User',
      authorRole: author?.role || ''
    };
  }

  createQuiz(user, courseId, input) {
    const course = this.findCourse(courseId);
    if (!this.canManageCourse(user, course)) {
      throw Object.assign(new Error('Course not found or not manageable.'), { status: 404 });
    }
    if (!String(input.title || '').trim() || !String(input.question || '').trim() || !String(input.answer || '').trim()) {
      throw Object.assign(new Error('Quiz title, question, and answer are required.'), { status: 400 });
    }
    const quiz = {
      id: id('quiz'),
      courseId,
      teacherId: user.role === 'teacher' ? user.id : course.teacherId,
      title: String(input.title).trim(),
      question: String(input.question).trim(),
      answer: String(input.answer).trim(),
      createdAt: now()
    };
    this.data.quizzes.push(quiz);
    this.save();
    return quiz;
  }

  sanitizeQuiz(user, quiz) {
    const submissions = this.data.quizSubmissions
      .filter((submission) => submission.quizId === quiz.id)
      .filter((submission) => user.role === 'student' ? submission.studentId === user.id : true)
      .map((submission) => ({
        ...submission,
        studentName: this.findUserById(submission.studentId)?.name || 'Unknown Student',
        studentEmail: this.findUserById(submission.studentId)?.email || ''
      }));
    const safeQuiz = { ...quiz, submissions };
    if (user.role === 'student') delete safeQuiz.answer;
    return safeQuiz;
  }

  listQuizzes(user, courseId) {
    const course = this.findCourse(courseId);
    if (!this.canAccessCourse(user, course)) return null;
    return this.data.quizzes
      .filter((quiz) => quiz.courseId === courseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((quiz) => this.sanitizeQuiz(user, quiz));
  }

  createQuizSubmission(user, quizId, input) {
    if (user.role !== 'student') {
      throw Object.assign(new Error('Only students can submit quizzes.'), { status: 403 });
    }
    const quiz = this.data.quizzes.find((candidate) => candidate.id === quizId);
    const course = quiz ? this.findCourse(quiz.courseId) : null;
    if (!quiz || !this.canAccessCourse(user, course)) {
      throw Object.assign(new Error('Quiz not found.'), { status: 404 });
    }
    const answer = String(input.answer || '').trim();
    const correct = answer === quiz.answer;
    let submission = this.data.quizSubmissions.find(
      (candidate) => candidate.quizId === quizId && candidate.studentId === user.id
    );
    if (!submission) {
      submission = {
        id: id('quiz_submission'),
        quizId,
        studentId: user.id,
        answer: '',
        correct: false,
        score: 0,
        submittedAt: now()
      };
      this.data.quizSubmissions.push(submission);
    }
    submission.answer = answer;
    submission.correct = correct;
    submission.score = correct ? 100 : 0;
    submission.submittedAt = now();
    this.save();
    return submission;
  }

  listQuizSubmissions(user, quizId) {
    const quiz = this.data.quizzes.find((candidate) => candidate.id === quizId);
    const course = quiz ? this.findCourse(quiz.courseId) : null;
    if (!quiz || !this.canManageCourse(user, course)) return null;
    return this.data.quizSubmissions
      .filter((submission) => submission.quizId === quizId)
      .map((submission) => ({
        ...submission,
        studentName: this.findUserById(submission.studentId)?.name || 'Unknown Student',
        studentEmail: this.findUserById(submission.studentId)?.email || ''
      }));
  }
}

module.exports = {
  JsonStore,
  publicUser
};
