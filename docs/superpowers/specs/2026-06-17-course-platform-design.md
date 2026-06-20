# Course Platform MVP Design

## Goal

Build a small-scope online course learning platform for cloud server deployment. Teachers upload courses and materials, students register and learn online, and administrators control registration, teacher approval, invites, and user management.

## Users And Permissions

The system has three roles:

- Student: registers with class name and student invite code, logs in through the student entry, views assigned or published courses, studies sections, submits progress, and submits assignments.
- Teacher: registers with teacher invite code, waits for approval, logs in through the teacher entry after approval, creates courses, uploads sections/materials, publishes courses, assigns work, and reviews submissions.
- Admin: logs in through the admin entry, approves teachers, manages users, and creates invite codes.

Login must enforce the selected role. A student account cannot log in through the teacher entry, and a teacher cannot access student-only actions.

## MVP Scope

The first version includes:

- Role-specific registration and login.
- Student and teacher login modes on the landing screen.
- Teacher approval before teacher login.
- Invite codes for small-scope use.
- Course creation, publishing, and section management.
- Section materials as text, video, document, image, or uploaded file.
- Student course list and learning screen.
- Progress recording per student, course, and section.
- Assignment creation, student submission, and teacher review.
- Admin user list, teacher approval, and invite creation.
- Docker-friendly deployment on one cloud server.

The MVP stores data in JSON files and uploads on the server filesystem so it can run without external services. The storage layer is intentionally isolated so a later PostgreSQL/object-storage migration can keep the API and UI mostly stable.

## Architecture

The app is a single Node.js service with no external npm dependencies:

- `src/server.js`: HTTP server, static file serving, API routing, auth checks.
- `src/store.js`: JSON-backed persistence for users, invites, courses, sections, files, progress, assignments, and submissions.
- `src/auth.js`: password hashing, token creation, token verification, role checks.
- `src/multipart.js`: small multipart parser for course material uploads.
- `public/`: browser UI for login, registration, student dashboard, teacher dashboard, and admin dashboard.

The service exposes static frontend files from `public/`, stores persistent data in `data/`, and stores uploaded materials in `uploads/`.

## Data Model

Core records:

- User: `id`, `role`, `name`, `email`, `passwordHash`, `className`, `subject`, `approved`, `createdAt`.
- Invite: `id`, `code`, `role`, `active`, `createdAt`.
- Course: `id`, `teacherId`, `title`, `description`, `className`, `cover`, `published`, `createdAt`, `updatedAt`.
- Section: `id`, `courseId`, `title`, `contentType`, `textContent`, `fileId`, `order`, `createdAt`.
- File: `id`, `ownerId`, `originalName`, `storedName`, `mimeType`, `size`, `createdAt`.
- Progress: `id`, `studentId`, `courseId`, `sectionId`, `percent`, `completed`, `updatedAt`.
- Assignment: `id`, `courseId`, `teacherId`, `title`, `description`, `dueDate`, `createdAt`.
- Submission: `id`, `assignmentId`, `studentId`, `content`, `feedback`, `score`, `submittedAt`, `reviewedAt`.

## API Summary

- `POST /api/register`: create student or teacher account.
- `POST /api/login`: login by selected role.
- `GET /api/me`: return current user.
- `GET /api/courses`: list courses visible to current user.
- `POST /api/courses`: teacher/admin creates course.
- `PATCH /api/courses/:courseId`: teacher/admin updates course.
- `GET /api/courses/:courseId`: return course with sections.
- `POST /api/courses/:courseId/sections`: teacher/admin creates section, supports JSON or multipart file upload.
- `GET /api/files/:fileId`: authenticated file download/stream.
- `POST /api/progress`: student updates progress.
- `GET /api/progress/course/:courseId`: teacher/admin sees progress for a course; student sees own progress.
- `POST /api/courses/:courseId/assignments`: teacher/admin creates assignment.
- `GET /api/courses/:courseId/assignments`: list assignments.
- `POST /api/assignments/:assignmentId/submissions`: student submits assignment.
- `GET /api/assignments/:assignmentId/submissions`: teacher/admin views submissions.
- `PATCH /api/submissions/:submissionId`: teacher/admin reviews a submission.
- `GET /api/admin/users`: admin lists users.
- `PATCH /api/admin/users/:userId`: admin updates approval.
- `POST /api/admin/invites`: admin creates invite.

## UI Direction

The interface should feel like a practical school tool rather than a marketing site. It should use a restrained, readable layout with a role selector on the first screen, clear dashboards, compact tables, direct forms, and mobile-friendly stacking.

Primary screens:

- Login/register screen with Student, Teacher, and Admin tabs.
- Student dashboard with assigned courses, progress, course detail, learning panel, and assignment submissions.
- Teacher dashboard with course creation/editing, section upload, progress table, assignments, and submissions.
- Admin dashboard with users, teacher approval, and invite codes.

## Deployment

The app should run with:

```bash
npm start
```

For cloud deployment, Docker should expose port `3000` and mount persistent `data/` and `uploads/` directories.

