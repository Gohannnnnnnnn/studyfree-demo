# Course Platform MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable cloud-deployable MVP for student/teacher online course learning with registration, login, upload, learning progress, assignments, and admin approval.

**Architecture:** A single dependency-free Node.js HTTP service serves the frontend and JSON APIs. Persistence is isolated in a JSON store and uploaded files live in a separate directory for later migration to PostgreSQL/object storage.

**Tech Stack:** Node.js built-in HTTP, crypto, fs, path, node:test, browser-native HTML/CSS/JavaScript, Docker.

---

## File Structure

- Create `src/auth.js`: password hashing, token signing, token verification, and auth helpers.
- Create `src/store.js`: JSON-backed database with seed data and CRUD helpers.
- Create `src/multipart.js`: parser for small multipart form uploads.
- Create `src/server.js`: HTTP server, static assets, API routes, role guards, file streaming.
- Create `public/index.html`: single-page app shell.
- Create `public/styles.css`: responsive dashboard styling.
- Create `public/app.js`: browser app state, API calls, role-specific screens.
- Create `tests/api.test.js`: API regression tests for registration, login, courses, uploads, progress, assignments, and admin approval.
- Create `README.md`: run, test, deploy, and default account instructions.
- Create `Dockerfile` and `docker-compose.yml`: cloud server deployment package.

## Tasks

### Task 1: API Tests

- [ ] Add `tests/api.test.js` with tests that start the server on a random port and use temporary data/upload directories.
- [ ] Verify the tests fail before implementation with `npm test`.

Expected initial failure: module `../src/server` cannot be found.

### Task 2: Auth And Store

- [ ] Add `src/auth.js` with salted PBKDF2 password hashing and HMAC-signed bearer tokens.
- [ ] Add `src/store.js` with atomic JSON save, default admin user, default student invite `STUDENT2026`, and default teacher invite `TEACHER2026`.
- [ ] Run `npm test` and confirm auth/store import errors are resolved while route behavior still fails until server routes exist.

### Task 3: API Server

- [ ] Add `src/server.js` with JSON parsing, static asset serving, route matching, auth guards, and API handlers.
- [ ] Add `src/multipart.js` and wire multipart section upload to `POST /api/courses/:courseId/sections`.
- [ ] Run `npm test` and fix routes until all API tests pass.

### Task 4: Frontend

- [ ] Add `public/index.html`, `public/styles.css`, and `public/app.js`.
- [ ] Implement role tabs, registration, login, dashboards, course creation, section upload, progress update, assignment creation/submission, and admin approval.
- [ ] Start the server with `npm start` and manually load `http://localhost:3000`.

### Task 5: Deployment Docs

- [ ] Add `README.md` with default accounts, invite codes, local run commands, and cloud deployment notes.
- [ ] Add `Dockerfile` and `docker-compose.yml` with persistent volumes for `data` and `uploads`.
- [ ] Run `npm test` again before final handoff.

## Self-Review

The plan covers all MVP requirements from the design spec: role-based registration/login, teacher approval, invite codes, course creation, section uploads, student learning, progress, assignments, admin management, and cloud deployment files. No intentionally deferred MVP feature remains in the plan.

