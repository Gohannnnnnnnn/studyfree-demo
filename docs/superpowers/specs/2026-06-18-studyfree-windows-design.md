# StudyFree Windows MVP Design

## Goal

Build an independent, free Windows learning app inspired by the broad workflow of Xuexitong-style course platforms, without copying proprietary code, branding, assets, paid features, private APIs, or membership bypass behavior.

The first version should turn the existing `course-learning-platform` web app into a practical Windows-ready MVP for small groups: teachers publish courses and activities, students learn and submit work, and administrators manage accounts.

## Legal And Product Boundary

This project is a clean-room functional alternative. It may reproduce common learning-platform concepts such as courses, tasks, assignments, quizzes, sign-in, discussions, notices, progress, and file materials. It must not:

- Use the original app name, logo, icons, images, slogans, or proprietary UI assets.
- Copy source code or bundled business logic from the analyzed installer.
- Bypass membership, payment, login, exams, anti-cheat, face verification, or other access controls.
- Depend on private Chaoxing/Xuexitong APIs for unpaid access.

## Recommended Approach

Use the existing Node.js course platform as the base and add Windows packaging around it.

Why this route:

- It already implements the first-version learning workflow.
- It is dependency-light and easy to run on Windows.
- It keeps data local in `data/` and uploaded files in `uploads/`.
- It can later be wrapped as an Electron or native Windows desktop app.

Alternatives considered:

- Rewrite with Electron + SQLite immediately: cleaner long-term desktop architecture, but slower and riskier for the first working version.
- Build a full Xuexitong-scale clone: includes live classroom, IM, cloud disk, whiteboard, proctoring, AI translation, and integrations; this is too large for a single MVP.

## MVP Scope

The Windows MVP includes:

- Student, teacher, and admin login.
- Student and teacher registration by invite code.
- Admin approval for teachers.
- Course creation, edit, publish, unpublish, and delete.
- Course task points with text, video, document, image, or uploaded file.
- Student course list filtered by class/year.
- Student progress marking per task point.
- Course announcements.
- Sign-in by teacher-generated code.
- Course discussions and replies.
- Simple quizzes with teacher answer key and automatic exact-match grading.
- Assignments with student submissions and teacher review.
- Teacher progress/statistics view.
- Admin user, invite, and course management.
- Windows run script and later packaged desktop build.

Deferred from the first version:

- Real-time live video classroom.
- Full instant messaging across the whole app.
- Cloud disk synchronization.
- Exam proctoring, face verification, and anti-cheat.
- AI assistant, speech recognition, same-language translation, or simultaneous translation.
- Paid membership, ads, and commercial marketplace features.

## Architecture

Keep the current single-service architecture for the first Windows MVP:

- `src/server.js`: HTTP server, static files, API routes, auth guards, file streaming.
- `src/store.js`: JSON-backed persistence and domain operations.
- `src/auth.js`: password hashing and signed bearer tokens.
- `src/multipart.js`: upload parsing.
- `public/index.html`, `public/styles.css`, `public/app.js`: browser UI.
- `data/db.json`: local app database.
- `uploads/`: local learning materials.

Add Windows-specific layers in later implementation:

- `run_windows.bat`: one-click local startup.
- `desktop/` or `electron/`: optional Electron shell that starts the local server and opens the app window.
- `build_windows.bat`: package the Windows app into a portable folder or installer.

The first desktop wrapper should remain thin. The web app remains the real product surface, so browser and desktop versions share behavior.

## Data Flow

1. User opens the Windows app or local browser URL.
2. Frontend calls local API routes under `/api`.
3. API verifies token and role.
4. Store reads/writes `data/db.json`.
5. Uploaded files are saved under `uploads/`.
6. Video/document/image materials are streamed by authenticated file routes.

For small classes, JSON persistence is acceptable. If usage grows, migrate storage to SQLite first, then PostgreSQL/object storage only if needed.

## UI Direction

The UI should feel like a classroom workspace, not a marketing page.

Primary screens:

- Login/register screen with role tabs.
- Student dashboard: available courses, progress summary, course space.
- Course space: announcements, task points, assignments, quizzes, sign-ins, discussion.
- Teacher dashboard: course management and quick creation.
- Teacher course space: publish controls, material upload, activity creation, student responses.
- Progress/statistics page.
- Admin dashboard: users, teacher approval, invite codes, all courses.

The UI can reference the general mental model of learning platforms, but visual identity should be original: neutral colors, compact panels, clear tables, and simple iconography.

## Error Handling

- Show friendly messages for wrong role, invalid password, unapproved teacher, missing course, and unauthorized file access.
- Keep uploaded-file errors explicit: unsupported or missing file, oversized body, and missing disk file.
- Preserve data by writing through the store layer and avoiding partial manual edits to `db.json`.
- On Windows startup, display a clear message if Node.js or required runtime files are missing.

## Testing And Verification

Required checks before claiming completion:

- `npm.cmd test` from the project root.
- Manual smoke test of admin, teacher, and student login.
- Teacher creates/publishes a course and uploads a material.
- Student sees the course, opens material, marks progress, submits quiz/assignment/sign-in.
- Teacher sees progress and submissions.
- Windows run script starts the app and prints the local URL.

## Success Criteria

The first version is successful when a Windows user can run one command or double-click one script, open the app locally, and complete the core student-teacher workflow without paying, without external services, and without using the original app's proprietary assets or access controls.
