const state = {
  role: localStorage.getItem('role') || 'student',
  mode: 'login',
  token: localStorage.getItem('token') || '',
  user: null,
  view: 'courses',
  courses: [],
  selectedCourse: null,
  courseTool: 'overview',
  courseExtras: emptyExtras(),
  dashboard: null,
  admin: null,
  message: ''
};

const app = document.querySelector('#app');
const videoProgressState = new WeakMap();
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024;
const MAX_UPLOAD_SIZE_LABEL = '10GB';

function emptyExtras() {
  return {
    announcements: [],
    checkins: [],
    discussions: [],
    quizzes: [],
    assignments: []
  };
}

function setMessage(message, error = false) {
  state.message = message ? { text: message, error } : '';
  render();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, headers, body });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function safeGet(path, key) {
  try {
    const data = await api(path);
    return data[key] || [];
  } catch {
    return [];
  }
}

function html(strings, ...values) {
  return strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

const GRADE_OPTIONS = ['一年级', '二年级', '三年级'];
const GRADE_ALIASES = {
  1: '一年级',
  一: '一年级',
  一年: '一年级',
  一年级: '一年级',
  2: '二年级',
  二: '二年级',
  二年: '二年级',
  二年级: '二年级',
  3: '三年级',
  三: '三年级',
  三年: '三年级',
  三年级: '三年级'
};

function normalizeGradeLabel(value) {
  const raw = String(value || '').trim();
  return GRADE_ALIASES[raw] || raw;
}

function gradeOptions(selected = '', { includeAll = false } = {}) {
  const normalizedSelected = normalizeGradeLabel(selected);
  const firstOption = includeAll
    ? `<option value="" ${!normalizedSelected ? 'selected' : ''}>全部年级</option>`
    : `<option value="" disabled ${!normalizedSelected ? 'selected' : ''}>请选择年级</option>`;
  return firstOption + GRADE_OPTIONS
    .map((grade) => `<option value="${grade}" ${normalizedSelected === grade ? 'selected' : ''}>${grade}</option>`)
    .join('');
}

function notice() {
  if (!state.message) return '';
  return `<div class="notice ${state.message.error ? 'error' : ''}">${escapeHtml(state.message.text)}</div>`;
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || '';
}

function savedLoginKey(role = state.role) {
  return `studyfree-login-${role}`;
}

function savedLoginFor(role = state.role) {
  try {
    const saved = JSON.parse(localStorage.getItem(savedLoginKey(role)) || '{}');
    return {
      email: String(saved.email || ''),
      password: String(saved.password || ''),
      remember: Boolean(saved.remember)
    };
  } catch {
    return { email: '', password: '', remember: false };
  }
}

function updateSavedLogin(role, email, password, remember) {
  if (remember) {
    localStorage.setItem(savedLoginKey(role), JSON.stringify({ email, password, remember: true }));
    return;
  }
  localStorage.removeItem(savedLoginKey(role));
}


function roleLabel(role) {
  return ({ student: '学生端', teacher: '教师端', admin: '管理员端' })[role] || role;
}

function roleIcon(role) {
  return ({ student: '学', teacher: '师', admin: '管' })[role] || '用';
}

function roleSubtitle(role) {
  return ({ student: '我的学习', teacher: '教师端', admin: '管理端' })[role] || roleLabel(role);
}

function contentTypeLabel(type) {
  return ({ text: '文本', video: '视频', document: '文档', image: '图片' })[type] || type || '文本';
}

function inferContentTypeFromFile(file) {
  const mimeType = String(file?.type || '').toLowerCase();
  const fileName = String(file?.name || '').toLowerCase();
  if (mimeType.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|wmv|webm)$/i.test(fileName)) return 'video';
  if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fileName)) return 'image';
  return 'document';
}

function titleFromFile(file) {
  const name = String(file?.name || '').replace(/\.[^/.]+$/, '').trim();
  return name || '课程资料';
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function videoWatchSummary(item) {
  if (item.sectionContentType !== 'video') return '-';
  const watched = Number(item.watchedSeconds || item.lastPositionSeconds || 0);
  const duration = Number(item.durationSeconds || 0);
  return duration > 0 ? `${formatSeconds(watched)} / ${formatSeconds(duration)}` : formatSeconds(watched);
}

async function syncVideoProgress(video, force = false) {
  if (state.user?.role !== 'student') return;
  const sectionId = video.dataset.videoProgress;
  const courseId = video.dataset.course || state.selectedCourse?.id;
  if (!sectionId || !courseId) return;

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const position = video.ended && duration > 0 ? duration : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
  if (position <= 0 && !force) return;

  const previous = videoProgressState.get(video) || { sentAt: 0, position: 0 };
  const now = Date.now();
  if (!force && now - previous.sentAt < 10000 && Math.abs(position - previous.position) < 10) return;

  const percent = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  videoProgressState.set(video, { sentAt: now, position });
  await api('/api/progress', {
    method: 'POST',
    body: {
      courseId,
      sectionId,
      percent: video.ended ? 100 : percent,
      watchedSeconds: Math.round(position),
      durationSeconds: Math.round(duration),
      lastPositionSeconds: Math.round(position)
    }
  });
}

async function loadMe() {
  if (!state.token) return;
  try {
    const data = await api('/api/me');
    state.user = data.user;
    state.role = data.user.role;
    localStorage.setItem('role', state.role);
  } catch {
    logout(false);
  }
}

async function loadCourses(selectFirst = false) {
  const data = await api('/api/courses');
  state.courses = data.courses;
  if (selectFirst && data.courses[0]) {
    await selectCourse(data.courses[0].id);
  }
}

async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');
    state.dashboard = data.dashboard;
  } catch {
    state.dashboard = null;
  }
}

async function loadCourseExtras(courseId) {
  const [announcements, checkins, discussions, quizzes, assignments] = await Promise.all([
    safeGet(`/api/courses/${courseId}/announcements`, 'announcements'),
    safeGet(`/api/courses/${courseId}/checkins`, 'checkins'),
    safeGet(`/api/courses/${courseId}/discussions`, 'discussions'),
    safeGet(`/api/courses/${courseId}/quizzes`, 'quizzes'),
    safeGet(`/api/courses/${courseId}/assignments`, 'assignments')
  ]);
  return { announcements, checkins, discussions, quizzes, assignments };
}

async function selectCourse(courseId, tool = 'overview') {
  const data = await api(`/api/courses/${courseId}`);
  state.selectedCourse = data.course;
  state.courseExtras = await loadCourseExtras(courseId);
  state.courseTool = state.user?.role === 'teacher' && tool === 'overview' ? 'sections' : tool;
  state.view = 'course';
  render();
}

function logout(show = true) {
  state.token = '';
  state.user = null;
  state.courses = [];
  state.selectedCourse = null;
  state.courseTool = 'overview';
  state.courseExtras = emptyExtras();
  state.dashboard = null;
  localStorage.removeItem('token');
  if (show) setMessage('已退出登录');
  render();
}


function renderAuth() {
  const roles = ['student', 'teacher', 'admin'];
  app.className = 'app-shell auth-shell';
  app.innerHTML = html`
    <section class="login-layout">
      <div class="login-panel">
        <div class="auth-card polished-login">
          <div class="auth-heading centered">
            <h1>医邦教育</h1>
            <p>在线课程学习平台</p>
          </div>
          <div class="role-tabs role-card-tabs" aria-label="选择登录端口">
            ${roles.map((role) => html`
              <button type="button" class="role-card ${state.role === role ? 'active' : ''}" data-role="${role}">
                <span class="role-icon">${roleIcon(role)}</span>
                <strong>${roleLabel(role)}</strong>
              </button>
            `).join('')}
          </div>
          ${state.mode === 'login' || state.role === 'admin' ? loginForm() : registerForm()}
          <button type="button" class="wechat-login" data-action="wechat-demo">微信一键登录</button>
          <div class="auth-switch">
            <span>${state.mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
            <button type="button" class="link-button" data-mode="${state.mode === 'login' ? 'register' : 'login'}" ${state.role === 'admin' ? 'disabled' : ''}>${state.mode === 'login' ? '注册新账号' : '返回登录'}</button>
          </div>
          <div class="demo-accounts">
            <strong>演示账号</strong>
            <dl>
              <dt>学生端</dt><dd>demo-student@example.com</dd>
              <dt>教师端</dt><dd>demo-teacher@example.com</dd>
              <dt>管理员端</dt><dd>admin@example.com</dd>
              <dt>对应密码</dt><dd>student123 / teacher123 / admin123456</dd>
            </dl>
          </div>
          <div class="version-label">医邦教育 v1.0</div>
          ${notice()}
        </div>
      </div>
    </section>
  `;
}


function loginForm() {
  const saved = savedLoginFor();
  const defaultEmail = state.role === 'admin' ? 'admin@example.com' : '';
  const defaultPassword = state.role === 'admin' ? 'admin123456' : '';
  return html`
    <form class="form-grid login-form" id="login-form">
      <label>邮箱地址<input name="email" type="email" required placeholder="请输入邮箱地址" value="${escapeHtml(saved.email || defaultEmail)}"></label>
      <label>登录密码<input name="password" type="password" required placeholder="请输入密码" value="${escapeHtml(saved.password || defaultPassword)}"></label>
      <label class="check-row"><input name="rememberCredentials" type="checkbox" ${saved.remember ? 'checked' : ''}> 保存账号和密码</label>
      <button type="submit" class="primary-login">登录</button>
    </form>
  `;
}

function registerForm() {
  return html`
    <form class="form-grid" id="register-form">
      <div class="form-row">
        <label>姓名<input name="name" required></label>
        <label>邮箱<input name="email" type="email" required></label>
      </div>
      <label>密码<input name="password" type="password" required minlength="6"></label>
      ${state.role === 'student'
        ? `<label>年级<select name="className" required>${gradeOptions()}</select></label>`
        : '<label>任教学科<input name="subject" required placeholder="例如：外科学"></label>'}
      <label>邀请码<input name="inviteCode" required placeholder="${state.role === 'student' ? 'STUDENT2026' : 'TEACHER2026'}"></label>
      <button type="submit">注册${roleLabel(state.role)}</button>
    </form>
  `;
}


function renderAppShell(content) {
  app.className = 'app-shell';
  app.innerHTML = html`
    <section class="layout">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <strong>医邦教育</strong>
          <span>${roleSubtitle(state.user.role)}</span>
        </div>
        <nav class="nav">
          ${shellNav()}
        </nav>
        <div class="sidebar-user">
          <span class="avatar">${escapeHtml((state.user.name || roleLabel(state.user.role)).slice(0, 1))}</span>
          <div>
            <strong>${escapeHtml(state.user.name)}</strong>
            <small>${roleLabel(state.user.role)}</small>
          </div>
          <button class="icon-button" type="button" data-action="refresh" title="刷新">刷</button>
          <button class="icon-button" type="button" data-action="logout" title="退出">出</button>
        </div>
      </aside>
      <main class="content">${content}</main>
    </section>
  `;
}

function shellNav() {
  if (state.user.role === 'teacher') {
    return html`
      ${navButton('courses', '工作台首页', '首')}
      <button class="${state.view === 'course' ? 'active' : ''}" data-action="focus-courses"><span class="nav-icon">课</span><span>我的课程</span></button>
      ${navButton('progress', '学习统计', '统')}
    `;
  }
  if (state.user.role === 'admin') {
    return html`
      ${navButton('admin', '后台首页', '管')}
      ${navButton('courses', '课程管理', '课')}
    `;
  }
  return html`
    ${navButton('courses', '我的课程', '课')}
  `;
}

function navButton(view, label, icon = '') {
  return '<button class="' + (state.view === view ? 'active' : '') + '" data-view="' + view + '"><span class="nav-icon">' + escapeHtml(icon || label.slice(0, 1)) + '</span><span>' + escapeHtml(label) + '</span></button>';
}



function topbar(title, subtitle = '') {
  return html`
    <div class="topbar">
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? '<div class="muted">' + escapeHtml(subtitle) + '</div>' : ''}
      </div>
      <div class="topbar-welcome">欢迎回来，${escapeHtml(state.user.name)}${state.user.role === 'teacher' ? ' 老师' : ''}</div>
    </div>
    ${notice()}
  `;
}


function summaryCards(items) {
  return '<section class="stat-grid">' + items.map((item) => html`
    <div class="stat-card">
      <span class="stat-icon">${escapeHtml(item.icon || '')}</span>
      <div>
        <strong>${escapeHtml(item.value)}</strong>
        <span>${escapeHtml(item.label)}</span>
        <small>${escapeHtml(item.hint || '')}</small>
      </div>
    </div>
  `).join('') + '</section>';
}

function workbenchList(items, renderItem, emptyText) {
  if (!items?.length) return `<div class="empty-inline">${escapeHtml(emptyText)}</div>`;
  return `<div class="workbench-list">${items.map(renderItem).join('')}</div>`;
}

function progressBar(percent = 0) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="progress-bar"><span style="width:${safePercent}%"></span></div>`;
}

function renderStudent() {
  if (state.view === 'course' && state.selectedCourse) {
    renderAppShell(studentCourseDetail());
    return;
  }
  const dashboard = state.dashboard || {
    metrics: { availableCourses: state.courses.length, unfinishedTasks: 0, recentAnnouncements: 0, averageProgress: 0 },
    continueLearning: null,
    todayTodos: [],
    recentAnnouncements: [],
    progressByCourse: [],
    courses: state.courses
  };
  renderAppShell(html`
    ${topbar('我的学习空间', '继续学习、今日待办和课程动态集中管理')}
    ${summaryCards([
      { label: '继续学习', value: dashboard.continueLearning?.courseTitle || '待开始', hint: dashboard.continueLearning?.nextSectionTitle || '选择课程进入学习' },
      { label: '今日待办', value: dashboard.metrics.unfinishedTasks, hint: '任务点/作业/签到/测验' },
      { label: '我的课程', value: dashboard.metrics.availableCourses, hint: '已按年级筛选' },
      { label: '平均进度', value: `${dashboard.metrics.averageProgress}%`, hint: '按任务点完成度估算' }
    ])}
    <section class="dashboard-grid">
      <section class="panel dashboard-panel highlight-panel">
        <h3>继续学习</h3>
        ${dashboard.continueLearning ? html`
          <p class="muted">${escapeHtml(dashboard.continueLearning.courseTitle)}</p>
          <strong>${escapeHtml(dashboard.continueLearning.nextSectionTitle || '进入课程空间')}</strong>
          ${progressBar(dashboard.continueLearning.percent)}
          <button type="button" data-course="${dashboard.continueLearning.courseId}">继续学习</button>
        ` : '<p class="muted">暂无进行中的课程。</p>'}
      </section>
      <section class="panel dashboard-panel">
        <h3>今日待办</h3>
        ${workbenchList(dashboard.todayTodos, (item) => html`
          <button type="button" class="workbench-item" data-course="${item.courseId}">
            <span>${escapeHtml(item.hint)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.courseTitle)}</small>
          </button>
        `, '今天没有待办任务。')}
      </section>
      <section class="panel dashboard-panel">
        <h3>最近公告</h3>
        ${workbenchList(dashboard.recentAnnouncements, (item) => html`
          <button type="button" class="workbench-item" data-course="${item.courseId}">
            <span>${escapeHtml(item.courseTitle)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(new Date(item.createdAt).toLocaleString())}</small>
          </button>
        `, '暂无课程公告。')}
      </section>
      <section class="panel dashboard-panel">
        <h3>未完成任务</h3>
        ${workbenchList(dashboard.progressByCourse, (item) => html`
          <button type="button" class="workbench-item" data-course="${item.courseId}">
            <span>${escapeHtml(item.percent)}%</span>
            <strong>${escapeHtml(item.courseTitle)}</strong>
            <small>${escapeHtml(item.nextSectionTitle || '暂无任务点')}</small>
            ${progressBar(item.percent)}
          </button>
        `, '暂无课程进度。')}
      </section>
    </section>
    <section>
      <div class="section-heading">
        <h3>我的课程</h3>
        <span>${escapeHtml(dashboard.metrics.availableCourses)} 门</span>
      </div>
      <div class="grid">
        ${state.courses.map(courseCard).join('') || studentEmptyState()}
      </div>
    </section>
  `);
}

function studentEmptyState() {
  return html`
    <div class="panel empty-state">
      <h3>暂无可学习课程</h3>
      <p class="muted">通常是课程还没有发布，或者课程适用年级与当前账号年级不一致。</p>
      <div class="notice">当前账号年级：${escapeHtml(state.user.className || '未填写')}。请让教师或管理员把课程发布，并将课程适用年级改为这个年级；也可以把课程适用年级留空，表示全部学生可见。</div>
    </div>
  `;
}

function courseCard(course) {
  const teacherActions = state.user?.role === 'teacher'
    ? `<button type="button" class="danger" data-delete-course="${course.id}" data-course-title="${escapeHtml(course.title)}">删除课程</button>`
    : '';
  return html`
    <article class="course-card elevated">
      <div class="course-cover">
        <span>${escapeHtml((course.title || '课').slice(0, 1))}</span>
      </div>
      <h3>${escapeHtml(course.title)}</h3>
      <p class="muted">${escapeHtml(course.description || '暂无简介')}</p>
      <div class="course-meta">
        <span class="pill">${escapeHtml(course.className || '全部年级')}</span>
        <span class="pill">${course.sectionCount || 0} 个任务点</span>
        <span class="pill ${course.published ? 'ok' : 'warn'}">${course.published ? '已发布' : '未发布'}</span>
      </div>
      <div class="toolbar">
        <button type="button" data-course="${course.id}">进入课程空间</button>
        ${teacherActions}
      </div>
    </article>
  `;
}

function studentCourseDetail() {
  return courseDetail(false);
}


function renderTeacher() {
  if (state.view === 'course' && state.selectedCourse) {
    renderAppShell(teacherCourseDetail());
    return;
  }
  if (state.view === 'progress') {
    renderAppShell(teacherProgress());
    return;
  }
  const dashboard = state.dashboard || {
    metrics: { courses: state.courses.length, sections: 0, pendingReviews: 0, recentInteractions: 0 },
    pendingReviews: [],
    progressSnapshot: [],
    recentInteractions: []
  };
  renderAppShell(html`
    ${topbar('教师工作台', '课程、作业和互动集中处理')}
    ${summaryCards([
      { icon: '课', label: '我的课程', value: dashboard.metrics.courses, hint: '教师创建' },
      { icon: '改', label: '待批改作业', value: dashboard.metrics.pendingReviews, hint: '学生已提交未反馈' },
      { icon: '互', label: '最近互动', value: dashboard.metrics.recentInteractions, hint: '讨论和签到动态' }
    ])}
    <div class="teacher-action-bar">
      <button type="button" data-action="focus-create">+ 快速建课</button>
      <button type="button" class="secondary" data-action="focus-courses">管理课程</button>
    </div>
    <section class="teacher-dashboard-grid">
      <section class="panel dashboard-panel pending-panel">
        <h3>待批改作业</h3>
        ${workbenchList(dashboard.pendingReviews, (item) => html`
          <button type="button" class="workbench-item" data-course="${item.courseId}">
            <span>${escapeHtml(item.studentName)}</span>
            <strong>${escapeHtml(item.assignmentTitle)}</strong>
            <small>${escapeHtml(item.courseTitle)}</small>
          </button>
        `, '暂无待批改作业')}
      </section>
      <section class="panel dashboard-panel interaction-panel">
        <h3>最近互动</h3>
        ${workbenchList(dashboard.recentInteractions, (item) => html`
          <button type="button" class="workbench-item compact" data-course="${item.courseId}">
            <span>${escapeHtml(item.authorName)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.courseTitle)}</small>
          </button>
        `, '暂无讨论互动')}
      </section>
    </section>
    <section class="teacher-courses-section" id="teacher-courses-section">
      <div class="section-heading">
        <h3>我的课程</h3>
        <span>${escapeHtml(state.courses.length)} 门</span>
      </div>
      <div class="teacher-course-manager">
        <section class="panel compact-create" id="quick-create-panel">
          <h3>快速建课</h3>
          <form class="form-grid" id="course-form">
            <label>课程名称<input name="title" required></label>
            <label>适用年级<select name="className">${gradeOptions('', { includeAll: true })}</select></label>
            <label>课程简介<textarea name="description"></textarea></label>
            <label class="check-row"><input name="published" type="checkbox"> 创建后立即发布</label>
            <button type="submit">创建课程</button>
          </form>
        </section>
        <section class="course-list-surface">
          <div class="grid compact-course-grid">
            ${state.courses.map(courseCard).join('') || '<div class="panel empty-state">还没有课程。</div>'}
          </div>
        </section>
      </div>
    </section>
  `);
}

function teacherCourseDetail() {
  return courseDetail(true);
}


function courseDetail(isTeacher) {
  if (!isTeacher) {
    const course = state.selectedCourse;
    return html`
      ${topbar(course.title, course.description)}
      ${courseHero(course)}
      ${courseToolGrid(isTeacher)}
      ${renderCourseToolPanel(isTeacher)}
    `;
  }
  const course = state.selectedCourse;
  return html`
    <section class="course-detail-header">
      <div>
        <button type="button" class="back-link" data-view="courses">← 返回课程列表</button>
        <h2>${escapeHtml(course.title)}</h2>
        <p>${escapeHtml(course.description || '暂无课程简介')}</p>
      </div>
      <div class="course-header-actions">
        <button type="button" class="secondary" data-course-tool="settings">编辑课程</button>
        <button type="button" class="warn-button" data-publish="${course.published ? 'false' : 'true'}">${course.published ? '下架课程' : '发布课程'}</button>
        <button type="button" class="danger" data-delete-course="${course.id}" data-course-title="${escapeHtml(course.title)}">删除课程</button>
      </div>
    </section>
    ${notice()}
    ${courseToolGrid(isTeacher)}
    ${renderCourseToolPanel(isTeacher)}
  `;
}

function quickUploadPanel() {
  return html`
    <section class="panel quick-upload-panel">
      <div>
        <h3>批量上传资料</h3>
        <p class="muted">一次选择多个视频、文档或图片，系统会按文件名自动生成任务点；单个文件最大 ${MAX_UPLOAD_SIZE_LABEL}。</p>
      </div>
      <form class="quick-upload-form" id="quick-upload-form">
        <label class="quick-file-picker">
          <span>选择资料</span>
          <input name="files" type="file" multiple accept="video/*,image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt">
        </label>
        <button type="submit">上传并生成任务点</button>
      </form>
    </section>
  `;
}

function courseHero(course) {
  const extras = state.courseExtras;
  return html`
    <section class="course-hero">
      <div>
        <span class="pill ${course.published ? 'ok' : 'warn'}">${course.published ? '已发布' : '未发布'}</span>
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.description || '暂无课程简介')}</p>
      </div>
      <div class="hero-metrics">
        <span><strong>${course.sections.length}</strong>任务点</span>
        <span><strong>${extras.assignments.length}</strong>作业</span>
        <span><strong>${extras.checkins.length}</strong>签到</span>
        <span><strong>${extras.quizzes.length}</strong>测验</span>
      </div>
    </section>
  `;
}


function courseToolDefinitions(isTeacher) {
  const extras = state.courseExtras;
  if (isTeacher) {
    return [
      { id: 'sections', title: '任务点', count: courseCountText(state.selectedCourse.sections.length, '个') },
      { id: 'upload', title: '上传资料', count: MAX_UPLOAD_SIZE_LABEL },
      { id: 'progress', title: '学习进度', count: '查看' },
      { id: 'assignments', title: '作业管理', count: courseCountText(extras.assignments.length, '项') },
      { id: 'announcements', title: '公告', count: courseCountText(extras.announcements.length, '条') },
      { id: 'quizzes', title: '测验', count: courseCountText(extras.quizzes.length, '题') },
      { id: 'materials', title: '资料库', count: courseCountText(state.selectedCourse.sections.filter((section) => section.fileId).length, '份') }
    ];
  }
  return [
    { id: 'overview', title: '公告', desc: '课程通知和学习提醒', count: courseCountText(extras.announcements.length, '条') },
    { id: 'sections', title: '任务点', desc: '视频、文档、图片和文字资料', count: courseCountText(state.selectedCourse.sections.length, '个') },
    { id: 'assignments', title: '作业', desc: '发布、提交和查看作业', count: courseCountText(extras.assignments.length, '项') },
    { id: 'quizzes', title: '测验', desc: '课堂小测和自动评分', count: courseCountText(extras.quizzes.length, '题') },
    { id: 'discussions', title: '讨论', desc: '提问、回复和课堂讨论', count: courseCountText(extras.discussions.length, '条') },
    { id: 'checkins', title: '签到', desc: '输入签到码', count: courseCountText(extras.checkins.length, '次') },
    { id: 'materials', title: '资料', desc: '汇总视频、文档和图片资源', count: courseCountText(state.selectedCourse.sections.filter((section) => section.fileId).length, '份') }
  ];
}

function courseCountText(value, unit) {
  return `${value}${unit}`;
}


function courseToolGrid(isTeacher) {
  const className = isTeacher ? 'course-tabs' : 'course-tool-grid';
  return html`
    <section class="${className}">
      ${courseToolDefinitions(isTeacher).map((tool) => html`
        <button type="button" class="tool-card ${state.courseTool === tool.id ? 'active' : ''}" data-course-tool="${tool.id}">
          <span>${escapeHtml(tool.count)}</span>
          <strong>${escapeHtml(tool.title)}</strong>
          ${tool.desc ? '<small>' + escapeHtml(tool.desc) + '</small>' : ''}
        </button>
      `).join('')}
    </section>
  `;
}


function renderCourseToolPanel(isTeacher) {
  let tool = state.courseTool || (isTeacher ? 'sections' : 'overview');
  if (isTeacher && tool === 'overview') tool = 'sections';
  if (tool === 'settings' && isTeacher) return courseControlModule();
  if (tool === 'upload' && isTeacher) return quickUploadPanel();
  if (tool === 'progress' && isTeacher) return courseProgressModule();
  if (tool === 'sections') return taskPointModule(isTeacher);
  if (tool === 'materials') return materialsModule(isTeacher);
  if (tool === 'announcements') return announcementModule(isTeacher);
  if (tool === 'assignments') return assignmentModule(isTeacher);
  if (tool === 'checkins') return checkinModule(isTeacher);
  if (tool === 'quizzes') return quizModule(isTeacher);
  if (tool === 'discussions') return discussionModule(isTeacher);
  return courseOverviewModule(isTeacher);
}

function courseProgressModule() {
  const course = state.selectedCourse;
  return html`
    <section class="panel module">
      <div class="module-header">
        <div>
          <h3>学习进度</h3>
          <p class="muted">查看本课程学生的任务点完成和视频观看情况。</p>
        </div>
        <button type="button" data-report="${course.id}">刷新进度</button>
      </div>
      <div id="report-panel" class="progress-report-placeholder">点击“刷新进度”查看学生学习记录。</div>
    </section>
  `;
}

function materialsModule(isTeacher) {
  const token = encodeURIComponent(state.token);
  const materials = state.selectedCourse.sections.filter((section) => section.fileId);
  return html`
    <section class="panel module">
      <h3>资料</h3>
      <p class="muted">${isTeacher ? '已上传到任务点的视频、文档和图片会自动汇总到这里。' : '课程资料集中在这里，视频也可在任务点中在线播放并记录进度。'}</p>
      <div class="section-list">
        ${materials.map((section) => html`
          <div class="section-item">
            <div class="item-title">
              <h4>${escapeHtml(section.title)}</h4>
              <span class="pill">${escapeHtml(contentTypeLabel(section.contentType))}</span>
            </div>
            ${renderMaterial(section, token)}
          </div>
        `).join('') || '<p class="muted">暂无已上传资料。</p>'}
      </div>
    </section>
  `;
}

function courseOverviewModule(isTeacher) {
  const course = state.selectedCourse;
  const extras = state.courseExtras;
  const nextItems = [
    course.sections[0] ? `任务点：${course.sections[0].title}` : '添加或等待第一个任务点',
    extras.announcements[0] ? `公告：${extras.announcements[0].title}` : '暂无课程公告',
    extras.assignments[0] ? `作业：${extras.assignments[0].title}` : '暂无作业'
  ];
  return html`
    <section class="panel module course-overview-panel">
      <div>
        <h3>${isTeacher ? '教学入口' : '学习入口'}</h3>
        <p class="muted">${isTeacher ? '选择上方独立功能模块，分别管理课程资料、公告、作业和课堂互动。' : '选择上方功能入口，按任务点、作业、签到或讨论逐项完成学习。'}</p>
      </div>
      <div class="overview-list">
        ${nextItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    </section>
  `;
}


function courseControlModule() {
  const course = state.selectedCourse;
  return html`
    <section class="panel module">
      <div class="module-header">
        <div>
          <h3>编辑课程</h3>
          <p class="muted">修改课程基本信息、适用年级和发布状态。</p>
        </div>
      </div>
      <form class="form-grid compact-form admin-course-form" data-course="${course.id}">
        <div class="form-row">
          <label>课程名称<input name="title" required value="${escapeHtml(course.title)}"></label>
          <label>适用年级<select name="className">${gradeOptions(course.className, { includeAll: true })}</select></label>
        </div>
        <label>课程简介<textarea name="description">${escapeHtml(course.description || '')}</textarea></label>
        <label>发布状态
          <select name="published">
            <option value="true" ${course.published ? 'selected' : ''}>发布</option>
            <option value="false" ${!course.published ? 'selected' : ''}>下架</option>
          </select>
        </label>
        <button type="submit">保存课程</button>
      </form>
    </section>
  `;
}


function taskPointModule(isTeacher) {
  const token = encodeURIComponent(state.token);
  const course = state.selectedCourse;
  return html`
    <section class="panel module task-module">
      <div class="module-header">
        <div>
          <h3>课程任务点</h3>
          <p class="muted">视频、文档、图片会作为任务点呈现给学生。</p>
        </div>
        ${isTeacher ? '<button type="button" data-action="focus-section-form">+ 添加任务点</button>' : ''}
      </div>
      ${isTeacher ? html`
        <form class="form-grid compact-form section-form-inline" id="section-form">
          <div class="form-row">
            <label>任务标题<input name="title" required></label>
            <label>资料类型
              <select name="contentType">
                <option value="text">文本</option>
                <option value="video">视频</option>
                <option value="document">文档</option>
                <option value="image">图片</option>
              </select>
            </label>
          </div>
          <label>文字说明<textarea name="textContent"></textarea></label>
          <label>上传文件<input name="file" type="file" accept="video/*,image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"></label>
          <div class="form-footer"><span class="muted">单个上传文件不超过 ${MAX_UPLOAD_SIZE_LABEL}</span><button type="submit">添加任务点</button></div>
        </form>
      ` : ''}
      <div class="task-list">
        ${course.sections.map((section) => html`
          <div class="task-row">
            <div class="task-icon">${section.contentType === 'video' ? '播' : section.contentType === 'image' ? '图' : section.contentType === 'document' ? '文' : '字'}</div>
            <div class="task-main">
              <strong>${escapeHtml(section.order)}. ${escapeHtml(section.title)}</strong>
              <small>${escapeHtml(contentTypeLabel(section.contentType))}${section.textContent ? ' ? ' + escapeHtml(section.textContent) : ''}</small>
              ${!isTeacher ? renderMaterial(section, token) : ''}
            </div>
            <div class="task-actions">
              <span class="pill ok">已发布</span>
              ${isTeacher ? html`
                <button class="small warn-button" type="button" data-section-action="offline" data-section-title="${escapeHtml(section.title)}">下架</button>
                <button class="small secondary" type="button" data-section-action="edit" data-section-title="${escapeHtml(section.title)}">编辑</button>
                <button class="small secondary" type="button" data-section-action="view" data-section-title="${escapeHtml(section.title)}">查看</button>
                <button class="small secondary" type="button" data-section-action="assign" data-section-title="${escapeHtml(section.title)}">布置作业</button>
                <button class="small danger" type="button" data-delete-section="${section.id}" data-section-title="${escapeHtml(section.title)}">删除</button>
              ` : html`
                <button class="small" data-progress="${section.id}" data-percent="50">学习中</button>
                <button class="small" data-progress="${section.id}" data-percent="100">标记完成</button>
              `}
            </div>
          </div>
        `).join('') || '<p class="muted">还没有任务点。</p>'}
      </div>
    </section>
  `;
}

function renderMaterial(section, token) {
  if (!section.fileId) return '';
  const fileUrl = `/api/files/${section.fileId}?token=${token}`;
  if (section.contentType === 'video') {
    return html`
      <div class="video-box">
        <div class="video-title">在线播放</div>
        <video class="video-player" controls preload="metadata" src="${fileUrl}" data-video-progress="${escapeHtml(section.id)}" data-course="${escapeHtml(section.courseId)}">
          当前浏览器无法播放该视频，请使用下方链接打开或下载。
        </video>
        <a class="file-link" target="_blank" href="${fileUrl}">新窗口打开视频</a>
      </div>
    `;
  }
  return `<a class="file-link" target="_blank" href="${fileUrl}">打开资料</a>`;
}

function announcementModule(isTeacher) {
  const announcements = state.courseExtras.announcements;
  return html`
    <section class="panel module">
      <h3>课程公告</h3>
      ${isTeacher ? html`
        <form class="form-grid compact-form" id="announcement-form">
          <label>标题<input name="title" required></label>
          <label>内容<textarea name="content" required></textarea></label>
          <button type="submit">发布公告</button>
        </form>
      ` : ''}
      <div class="feed-list">
        ${announcements.map((item) => html`
          <article class="feed-item">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.content)}</p>
            <small>${escapeHtml(new Date(item.createdAt).toLocaleString())}</small>
          </article>
        `).join('') || '<p class="muted">暂无公告。</p>'}
      </div>
    </section>
  `;
}

function assignmentModule(isTeacher) {
  const assignments = state.courseExtras.assignments;
  return html`
    <section class="panel module">
      <h3>作业</h3>
      ${isTeacher ? html`
        <form class="form-grid compact-form" id="assignment-form">
          <label>作业标题<input name="title" required></label>
          <label>截止日期<input name="dueDate" type="date"></label>
          <label>作业说明<textarea name="description"></textarea></label>
          <button type="submit">发布作业</button>
        </form>
      ` : ''}
      <div class="section-list">
        ${assignments.map((assignment) => html`
          <div class="section-item">
            <div class="item-title">
              <h4>${escapeHtml(assignment.title)}</h4>
              <span class="pill">${escapeHtml(assignment.dueDate || '不限期')}</span>
            </div>
            <p class="muted">${escapeHtml(assignment.description || '无说明')}</p>
            ${!isTeacher ? html`
              <form class="form-grid compact-form submit-form" data-assignment="${assignment.id}">
                <textarea name="content" placeholder="在这里填写作业内容"></textarea>
                <button type="submit">提交作业</button>
              </form>
            ` : ''}
          </div>
        `).join('') || '<p class="muted">暂无作业。</p>'}
      </div>
    </section>
  `;
}

function checkinModule(isTeacher) {
  const checkins = state.courseExtras.checkins;
  return html`
    <section class="panel module">
      <h3>课堂签到</h3>
      ${isTeacher ? html`
        <form class="form-grid compact-form" id="checkin-form">
          <label>签到名称<input name="title" required placeholder="例如：第一节课签到"></label>
          <label>签到码<input name="code" placeholder="留空自动生成"></label>
          <button type="submit">发起签到</button>
        </form>
      ` : ''}
      <div class="section-list">
        ${checkins.map((checkin) => html`
          <div class="section-item">
            <div class="item-title">
              <h4>${escapeHtml(checkin.title)}</h4>
              ${isTeacher ? `<span class="pill ok">签到码 ${escapeHtml(checkin.code)}</span>` : `<span class="pill">${checkin.records?.length ? '已签到' : '待签到'}</span>`}
            </div>
            ${isTeacher ? checkinRecords(checkin) : signInForm(checkin)}
          </div>
        `).join('') || '<p class="muted">暂无签到。</p>'}
      </div>
    </section>
  `;
}

function signInForm(checkin) {
  if (checkin.records?.length) {
    return '<p class="muted">你已完成本次签到。</p>';
  }
  return html`
    <form class="form-grid compact-form checkin-sign-form" data-checkin="${checkin.id}">
      <label>输入签到码<input name="code" required></label>
      <button type="submit">立即签到</button>
    </form>
  `;
}

function checkinRecords(checkin) {
  if (!checkin.records?.length) return '<p class="muted">暂无学生签到。</p>';
  return `<div class="mini-list">${checkin.records.map((record) => `<span>${escapeHtml(record.studentName)} · ${escapeHtml(new Date(record.signedAt).toLocaleString())}</span>`).join('')}</div>`;
}

function quizModule(isTeacher) {
  const quizzes = state.courseExtras.quizzes;
  return html`
    <section class="panel module">
      <h3>随堂测验</h3>
      ${isTeacher ? html`
        <form class="form-grid compact-form" id="quiz-form">
          <label>测验标题<input name="title" required></label>
          <label>题目<textarea name="question" required></textarea></label>
          <label>标准答案<input name="answer" required></label>
          <button type="submit">发布测验</button>
        </form>
      ` : ''}
      <div class="section-list">
        ${quizzes.map((quiz) => html`
          <div class="section-item">
            <div class="item-title">
              <h4>${escapeHtml(quiz.title)}</h4>
              ${isTeacher ? `<span class="pill ok">答案：${escapeHtml(quiz.answer || '')}</span>` : ''}
            </div>
            <p class="muted">${escapeHtml(quiz.question)}</p>
            ${isTeacher ? quizSubmissions(quiz) : quizAnswerForm(quiz)}
          </div>
        `).join('') || '<p class="muted">暂无测验。</p>'}
      </div>
    </section>
  `;
}

function quizAnswerForm(quiz) {
  const existing = quiz.submissions?.[0];
  if (existing) {
    return `<p class="muted">已提交：${escapeHtml(existing.answer)}，得分 ${existing.score}</p>`;
  }
  return html`
    <form class="form-grid compact-form quiz-submit-form" data-quiz="${quiz.id}">
      <label>答案<input name="answer" required></label>
      <button type="submit">提交测验</button>
    </form>
  `;
}

function quizSubmissions(quiz) {
  if (!quiz.submissions?.length) return '<p class="muted">暂无提交。</p>';
  return `<div class="mini-list">${quiz.submissions.map((submission) => `<span>${escapeHtml(submission.studentName)} · ${submission.score}分 · ${submission.correct ? '正确' : '需复习'}</span>`).join('')}</div>`;
}

function discussionModule(isTeacher) {
  const discussions = state.courseExtras.discussions;
  return html`
    <section class="panel module">
      <h3>讨论区</h3>
      <form class="form-grid compact-form" id="discussion-form">
        <label>主题<input name="title" required placeholder="${isTeacher ? '发起课堂讨论' : '提出学习问题'}"></label>
        <label>内容<textarea name="content" required></textarea></label>
        <button type="submit">${isTeacher ? '发起讨论' : '发布问题'}</button>
      </form>
      <div class="feed-list">
        ${discussions.map((discussion) => html`
          <article class="feed-item discussion">
            <h4>${escapeHtml(discussion.title)}</h4>
            <p>${escapeHtml(discussion.content)}</p>
            <small>${escapeHtml(discussion.authorName)} · ${roleLabel(discussion.authorRole)} · ${discussion.replyCount} 条回复</small>
            <div class="reply-list">
              ${(discussion.replies || []).map((reply) => `<div class="reply"><strong>${escapeHtml(reply.authorName)}</strong><span>${escapeHtml(reply.content)}</span></div>`).join('')}
            </div>
            <form class="form-grid compact-form reply-form" data-discussion="${discussion.id}">
              <input name="content" placeholder="回复这个讨论" required>
              <button type="submit">回复</button>
            </form>
          </article>
        `).join('') || '<p class="muted">暂无讨论。</p>'}
      </div>
    </section>
  `;
}

function teacherProgress() {
  return html`
    ${topbar('学习统计', '选择课程查看学生学习记录')}
    <section class="grid">
      ${state.courses.map((course) => html`
        <article class="course-card">
          <h3>${escapeHtml(course.title)}</h3>
          <p class="muted">${escapeHtml(course.className || '全部年级')}</p>
          <div class="toolbar">
            <button data-report="${course.id}">查看进度</button>
            <button class="secondary" data-course="${course.id}">课程空间</button>
          </div>
        </article>
      `).join('') || '<div class="panel">暂无课程。</div>'}
    </section>
    <section class="panel" id="report-panel"><p class="muted">进度数据会显示在这里。</p></section>
  `;
}

function progressReportTable(progress) {
  return html`
    <h3>进度记录</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>学生</th>
            <th>邮箱</th>
            <th>章节</th>
            <th>类型</th>
            <th>进度</th>
            <th>视频观看</th>
            <th>状态</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>${progress.map((item) => html`
          <tr>
            <td>${escapeHtml(item.studentName)}</td>
            <td>${escapeHtml(item.studentEmail)}</td>
            <td>${escapeHtml(item.sectionTitle)}</td>
            <td>${escapeHtml(contentTypeLabel(item.sectionContentType))}</td>
            <td>${escapeHtml(item.percent)}%</td>
            <td>${escapeHtml(videoWatchSummary(item))}</td>
            <td>${item.completed ? '已完成' : '学习中'}</td>
            <td>${item.updatedAt ? escapeHtml(new Date(item.updatedAt).toLocaleString()) : '-'}</td>
          </tr>
        `).join('') || '<tr><td colspan="8">暂无进度</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function renderAdmin() {
  const users = state.admin?.users || [];
  const invites = state.admin?.invites || [];
  const dashboard = state.dashboard || {
    metrics: {
      totalCourses: state.courses.length,
      publishedCourses: state.courses.filter((course) => course.published).length,
      students: users.filter((user) => user.role === 'student').length,
      teachers: users.filter((user) => user.role === 'teacher').length,
      pendingTeachers: users.filter((user) => user.role === 'teacher' && !user.approved).length,
      totalUsers: users.length
    },
    teacherReviews: {
      pending: users.filter((user) => user.role === 'teacher' && !user.approved).length,
      approved: users.filter((user) => user.role === 'teacher' && user.approved).length
    },
    studentAccounts: users.filter((user) => user.role === 'student'),
    courseOverview: state.courses,
    invites
  };
  const teacherUsers = users.filter((user) => user.role === 'teacher');
  const studentUsers = users.filter((user) => user.role === 'student');
  renderAppShell(html`
    ${topbar('管理员工作台', '课程总览、教师账号审核、学生账号管理和数据概览')}
    ${summaryCards([
      { label: '课程总览', value: dashboard.metrics.totalCourses, hint: `${dashboard.metrics.publishedCourses} 门已发布` },
      { label: '教师账号审核', value: dashboard.metrics.pendingTeachers, hint: `${dashboard.metrics.teachers} 名教师` },
      { label: '学生账号管理', value: dashboard.metrics.students, hint: `${dashboard.metrics.totalUsers} 个总账号` },
      { label: '数据概览', value: dashboard.metrics.publishedCourses, hint: '已发布课程数' }
    ])}
    <section class="dashboard-grid">
      <section class="panel dashboard-panel highlight-panel">
        <h3>数据概览</h3>
        <div class="overview-list">
          <span>全部课程：${escapeHtml(dashboard.metrics.totalCourses)} 门</span>
          <span>已发布课程：${escapeHtml(dashboard.metrics.publishedCourses)} 门</span>
          <span>教师账号：${escapeHtml(dashboard.metrics.teachers)} 个</span>
          <span>学生账号：${escapeHtml(dashboard.metrics.students)} 个</span>
        </div>
      </section>
      <section class="panel dashboard-panel">
        <h3>教师账号审核</h3>
        ${workbenchList(teacherUsers, (user) => html`
          <div class="workbench-item static-item">
            <span>${user.approved ? '已启用' : '待审核'}</span>
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.email)} · ${escapeHtml(user.subject || '未填写学科')}</small>
            ${!user.approved ? `<button class="small" data-approve="${user.id}">审核通过</button>` : ''}
          </div>
        `, '暂无教师账号。')}
      </section>
      <section class="panel dashboard-panel">
        <h3>学生账号管理</h3>
        ${workbenchList(studentUsers, (user) => html`
          <div class="workbench-item static-item">
            <span>${escapeHtml(user.className || '未设置年级')}</span>
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.email)}</small>
          </div>
        `, '暂无学生账号。')}
      </section>
      <section class="panel dashboard-panel">
        <h3>课程总览</h3>
        ${workbenchList(dashboard.courseOverview, (course) => html`
          <button type="button" class="workbench-item" data-report="${course.id}">
            <span>${course.published ? '已发布' : '未发布'}</span>
            <strong>${escapeHtml(course.title)}</strong>
            <small>${escapeHtml(course.teacherName || '未绑定教师')} · ${escapeHtml(course.className || '全部年级')} · ${escapeHtml(course.sectionCount || 0)} 个任务点</small>
          </button>
        `, '暂无课程。')}
      </section>
    </section>
    <div class="split admin-main-grid">
      <section class="panel">
        <h3>教师账号审核与学生账号管理</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>姓名</th><th>角色</th><th>邮箱</th><th>年级/学科</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              ${users.map((user) => html`
                <tr>
                  <td>${escapeHtml(user.name)}</td>
                  <td>${roleLabel(user.role)}</td>
                  <td>${escapeHtml(user.email)}</td>
                  <td>${escapeHtml(user.className || user.subject || '-')}</td>
                  <td>${user.approved ? '<span class="pill ok">已启用</span>' : '<span class="pill warn">待审核</span>'}</td>
                  <td>${user.role === 'teacher' && !user.approved ? `<button class="small" data-approve="${user.id}">审核通过</button>` : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h3>所有课程管理</h3>
        <p class="muted">这里可以查看所有课程，并修改名称、简介、适用年级和发布状态；学生看不到课程时，优先检查发布状态和年级匹配。</p>
        <div class="section-list">
          ${state.courses.map((course) => html`
            <form class="section-item admin-course-form" data-course="${course.id}">
              <div class="item-title">
                <h4>${escapeHtml(course.title)}</h4>
                <span class="pill ${course.published ? 'ok' : 'warn'}">${course.published ? '已发布' : '未发布'}</span>
              </div>
              <label>课程名称<input name="title" value="${escapeHtml(course.title)}" required></label>
              <label>课程简介<textarea name="description">${escapeHtml(course.description || '')}</textarea></label>
              <div class="form-row">
                <label>适用年级<select name="className">${gradeOptions(course.className, { includeAll: true })}</select></label>
                <label>发布状态
                  <select name="published">
                    <option value="true" ${course.published ? 'selected' : ''}>发布</option>
                    <option value="false" ${!course.published ? 'selected' : ''}>下架</option>
                  </select>
                </label>
              </div>
              <div class="toolbar">
                <button class="small" type="submit">保存课程设置</button>
                <button class="small secondary" type="button" data-report="${course.id}">学习统计</button>
                <button class="small danger" type="button" data-delete-course="${course.id}" data-course-title="${escapeHtml(course.title)}">删除课程</button>
              </div>
            </form>
          `).join('') || '<p class="muted">暂无课程。</p>'}
        </div>
      </section>
      <section class="panel" id="report-panel">
        <h3>学习统计</h3>
        <p class="muted">选择课程查看学生学习进度和视频观看统计。</p>
      </section>
      <section class="panel">
        <h3>邀请码</h3>
        <form class="form-grid" id="invite-form">
          <label>角色
            <select name="role">
              <option value="student">学生</option>
              <option value="teacher">教师</option>
            </select>
          </label>
          <label>邀请码<input name="code" placeholder="留空自动生成"></label>
          <button type="submit">创建邀请码</button>
        </form>
        <div class="table-wrap" style="margin-top: 16px">
          <table>
            <thead><tr><th>邀请码</th><th>角色</th><th>状态</th></tr></thead>
            <tbody>${invites.map((invite) => `<tr><td>${escapeHtml(invite.code)}</td><td>${roleLabel(invite.role)}</td><td>${invite.active ? '启用' : '停用'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
    </div>
  `);
}

function render() {
  if (!state.user) {
    renderAuth();
    return;
  }
  if (state.user.role === 'student') renderStudent();
  if (state.user.role === 'teacher') renderTeacher();
  if (state.user.role === 'admin') renderAdmin();
}

async function refresh() {
  if (!state.user) return;
  if (state.user.role === 'admin') {
    const [adminData, courseData, dashboardData] = await Promise.all([
      api('/api/admin/users'),
      api('/api/courses'),
      api('/api/dashboard')
    ]);
    state.admin = adminData;
    state.courses = courseData.courses;
    state.dashboard = dashboardData.dashboard;
    render();
    return;
  }
  await Promise.all([loadCourses(), loadDashboard()]);
  if (state.selectedCourse && state.view === 'course') {
    await selectCourse(state.selectedCourse.id, state.courseTool);
    return;
  }
  render();
}

async function batchUploadMaterials(form) {
  const courseId = state.selectedCourse.id;
  const files = Array.from(form.querySelector('[name="files"]')?.files || []);
  if (!files.length) {
    setMessage('请选择要上传的资料。', true);
    return;
  }

  const oversized = files.find((file) => file.size > MAX_UPLOAD_SIZE);
  if (oversized) {
    setMessage(`“${oversized.name}”超过 ${MAX_UPLOAD_SIZE_LABEL}，请压缩或拆分后再上传。`, true);
    return;
  }

  setMessage(`正在上传 ${files.length} 个资料，请稍候...`);
  for (const file of files) {
    const contentType = inferContentTypeFromFile(file);
    const body = new FormData();
    body.append('title', titleFromFile(file));
    body.append('contentType', contentType);
    body.append('textContent', `${contentTypeLabel(contentType)}资料：${file.name}`);
    body.append('file', file);
    await api(`/api/courses/${courseId}/sections`, {
      method: 'POST',
      body
    });
  }

  await selectCourse(courseId, 'materials');
  setMessage(`已上传 ${files.length} 个资料，并自动生成任务点。`);
}

function videoProgressTarget(event) {
  const target = event.target;
  return target?.matches?.('video[data-video-progress]') ? target : null;
}

document.addEventListener('timeupdate', (event) => {
  const video = videoProgressTarget(event);
  if (video) syncVideoProgress(video).catch(() => {});
}, true);

document.addEventListener('pause', (event) => {
  const video = videoProgressTarget(event);
  if (video) syncVideoProgress(video, true).catch(() => {});
}, true);

document.addEventListener('ended', (event) => {
  const video = videoProgressTarget(event);
  if (video) syncVideoProgress(video, true).catch(() => {});
}, true);

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.role) {
      state.role = button.dataset.role;
      state.mode = button.dataset.role === 'admin' ? 'login' : state.mode;
      localStorage.setItem('role', state.role);
      render();
    }
    if (button.dataset.mode) {
      state.mode = button.dataset.mode;
      render();
    }
    if (button.dataset.action === 'logout') logout();
    if (button.dataset.action === 'refresh') await refresh();
    if (button.dataset.action === 'wechat-demo') {
      setMessage('微信一键登录暂作演示入口，请使用演示账号登录。');
      return;
    }
    if (button.dataset.action === 'focus-courses') {
      state.view = 'courses';
      state.selectedCourse = null;
      state.courseTool = 'overview';
      await refresh();
      requestAnimationFrame(() => document.querySelector('#teacher-courses-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (button.dataset.action === 'focus-create') {
      state.view = 'courses';
      state.selectedCourse = null;
      await refresh();
      requestAnimationFrame(() => document.querySelector('#quick-create-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (button.dataset.action === 'focus-section-form') {
      document.querySelector('#section-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelector('#section-form input[name="title"]')?.focus();
      return;
    }
    if (button.dataset.view) {
      state.view = button.dataset.view;
      state.selectedCourse = null;
      state.courseTool = 'overview';
      state.courseExtras = emptyExtras();
      await refresh();
    }
    if (button.dataset.course) await selectCourse(button.dataset.course);
    if (button.dataset.courseTool) {
      state.courseTool = button.dataset.courseTool;
      render();
    }
    if (button.dataset.deleteCourse) {
      const courseTitle = button.dataset.courseTitle || '这门课程';
      if (!confirm(`确定删除“${courseTitle}”吗？删除后课程内容、任务点、作业、签到、讨论和测验记录都会一起移除。`)) return;
      await api(`/api/courses/${button.dataset.deleteCourse}`, { method: 'DELETE' });
      if (state.selectedCourse?.id === button.dataset.deleteCourse) {
        state.selectedCourse = null;
        state.courseExtras = emptyExtras();
        state.view = state.user.role === 'admin' ? 'admin' : 'courses';
      }
      await refresh();
      setMessage('课程已删除');
      return;
    }

    if (button.dataset.sectionAction) {
      const sectionTitle = button.dataset.sectionTitle || '这个任务点';
      if (button.dataset.sectionAction === 'assign') {
        state.courseTool = 'assignments';
        render();
        setMessage('已切换到作业管理，可为“' + sectionTitle + '”布置作业。');
        return;
      }
      if (button.dataset.sectionAction === 'view') {
        state.courseTool = 'materials';
        render();
        setMessage('已切换到资料库查看“' + sectionTitle + '”。');
        return;
      }
      if (button.dataset.sectionAction === 'edit') {
        document.querySelector('#section-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setMessage('可在任务点表单中调整“' + sectionTitle + '”的资料信息。');
        return;
      }
      if (button.dataset.sectionAction === 'offline') {
        setMessage('演示版暂使用课程级发布控制，如需隐藏“' + sectionTitle + '”可先删除或下架整门课程。');
        return;
      }
    }

    if (button.dataset.deleteSection) {
      const sectionTitle = button.dataset.sectionTitle || '删除任务点';
      if (!confirm(`确定删除“${sectionTitle}”吗？该任务点的学习进度和关联资料也会一起移除。`)) return;
      await api(`/api/courses/${state.selectedCourse.id}/sections/${button.dataset.deleteSection}`, { method: 'DELETE' });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('删除任务点已删除');
      return;
    }

    if (button.dataset.progress) {
      await api('/api/progress', {
        method: 'POST',
        body: {
          courseId: state.selectedCourse.id,
          sectionId: button.dataset.progress,
          percent: Number(button.dataset.percent)
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('学习进度已记录');
    }
    if (button.dataset.publish) {
      await api(`/api/courses/${state.selectedCourse.id}`, {
        method: 'PATCH',
        body: { published: button.dataset.publish === 'true' }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('课程状态已更新');
    }
    if (button.dataset.report) {
      const data = await api(`/api/progress/course/${button.dataset.report}`);
      const panel = document.querySelector('#report-panel');
      if (panel) panel.innerHTML = progressReportTable(data.progress);
    }
    if (button.dataset.approve) {
      await api(`/api/admin/users/${button.dataset.approve}`, {
        method: 'PATCH',
        body: { approved: true }
      });
      await refresh();
      setMessage('教师账号已审核通过');
    }
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'login-form') {
      const email = formValue(form, 'email');
      const password = formValue(form, 'password');
      const remember = form.querySelector('[name="rememberCredentials"]')?.checked || false;
      const data = await api('/api/login', {
        method: 'POST',
        body: {
          role: state.role,
          email,
          password
        }
      });
      updateSavedLogin(state.role, email, password, remember);
      state.token = data.token;
      state.user = data.user;
      state.message = '';
      localStorage.setItem('token', state.token);
      localStorage.setItem('role', state.user.role);
      state.view = state.user.role === 'admin' ? 'admin' : 'courses';
      await refresh();
      return;
    }

    if (form.id === 'register-form') {
      await api('/api/register', {
        method: 'POST',
        body: {
          role: state.role,
          name: formValue(form, 'name'),
          email: formValue(form, 'email'),
          password: formValue(form, 'password'),
          className: formValue(form, 'className'),
          subject: formValue(form, 'subject'),
          inviteCode: formValue(form, 'inviteCode')
        }
      });
      state.mode = 'login';
      setMessage(state.role === 'teacher' ? '注册成功，请等待管理员审核。' : '注册成功，可以登录。');
      return;
    }

    if (form.id === 'course-form') {
      await api('/api/courses', {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          className: formValue(form, 'className'),
          description: formValue(form, 'description'),
          published: form.querySelector('[name="published"]').checked
        }
      });
      await refresh();
      setMessage('课程已创建');
      return;
    }

    if (form.id === 'quick-upload-form') {
      await batchUploadMaterials(form);
      return;
    }

    if (form.id === 'section-form') {
      const upload = form.querySelector('[name="file"]')?.files?.[0];
      if (upload && upload.size > MAX_UPLOAD_SIZE) {
        setMessage(`单个上传文件不能超过 ${MAX_UPLOAD_SIZE_LABEL}。`, true);
        return;
      }
      const body = new FormData(form);
      await api(`/api/courses/${state.selectedCourse.id}/sections`, {
        method: 'POST',
        body
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('任务点已添加');
      return;
    }

    if (form.id === 'announcement-form') {
      await api(`/api/courses/${state.selectedCourse.id}/announcements`, {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          content: formValue(form, 'content')
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('公告已发布');
      return;
    }

    if (form.id === 'assignment-form') {
      await api(`/api/courses/${state.selectedCourse.id}/assignments`, {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          description: formValue(form, 'description'),
          dueDate: formValue(form, 'dueDate')
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('作业已发布');
      return;
    }

    if (form.id === 'checkin-form') {
      await api(`/api/courses/${state.selectedCourse.id}/checkins`, {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          code: formValue(form, 'code')
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('签到已发起');
      return;
    }

    if (form.id === 'quiz-form') {
      await api(`/api/courses/${state.selectedCourse.id}/quizzes`, {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          question: formValue(form, 'question'),
          answer: formValue(form, 'answer')
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('测验已发布');
      return;
    }

    if (form.id === 'discussion-form') {
      await api(`/api/courses/${state.selectedCourse.id}/discussions`, {
        method: 'POST',
        body: {
          title: formValue(form, 'title'),
          content: formValue(form, 'content')
        }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('讨论已发布');
      return;
    }

    if (form.id === 'invite-form') {
      await api('/api/admin/invites', {
        method: 'POST',
        body: {
          role: formValue(form, 'role'),
          code: formValue(form, 'code')
        }
      });
      await refresh();
      setMessage('邀请码已创建');
      return;
    }

    if (form.classList.contains('admin-course-form')) {
      await api(`/api/courses/${form.dataset.course}`, {
        method: 'PATCH',
        body: {
          title: formValue(form, 'title'),
          description: formValue(form, 'description'),
          className: formValue(form, 'className'),
          published: formValue(form, 'published') === 'true'
        }
      });
      await refresh();
      setMessage('课程设置已保存。学生端是否可见取决于发布状态和年级匹配。');
      return;
    }

    if (form.classList.contains('submit-form')) {
      await api(`/api/assignments/${form.dataset.assignment}/submissions`, {
        method: 'POST',
        body: { content: formValue(form, 'content') }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('作业已提交');
      return;
    }

    if (form.classList.contains('checkin-sign-form')) {
      await api(`/api/checkins/${form.dataset.checkin}/records`, {
        method: 'POST',
        body: { code: formValue(form, 'code') }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('签到成功');
      return;
    }

    if (form.classList.contains('quiz-submit-form')) {
      const result = await api(`/api/quizzes/${form.dataset.quiz}/submissions`, {
        method: 'POST',
        body: { answer: formValue(form, 'answer') }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage(result.submission.correct ? '测验提交成功，答案正确。' : '测验已提交，请复习后再试。');
      return;
    }

    if (form.classList.contains('reply-form')) {
      await api(`/api/discussions/${form.dataset.discussion}/replies`, {
        method: 'POST',
        body: { content: formValue(form, 'content') }
      });
      await selectCourse(state.selectedCourse.id, state.courseTool);
      setMessage('回复已发布');
    }
  } catch (error) {
    setMessage(error.message, true);
  }
});

(async function init() {
  await loadMe();
  if (state.user) await refresh();
  render();
})();
