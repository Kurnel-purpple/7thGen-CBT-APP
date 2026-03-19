# SchoolHub SMS — Modular School Management System

> **Status**: FUTURE ARCHITECTURE — Do not implement until the current CLAUDE.md is replaced with this file.
> The current CBT app continues to use `CLAUDE.md` for all design and development guidelines.
> When ready to begin the SMS refactor, rename this file to `CLAUDE.md` (and archive the old one).

---

## Overview

SchoolHub is a **modular School Management System (SMS)** built as a platform with pluggable mini-apps. Each module is a self-contained feature that registers itself with a shared core shell. Clients (schools) can choose which modules to enable — they get a tailored SMS with only the features they need.

**Philosophy**: One codebase, many configurations. Not microservices — a monorepo with enforced module boundaries.

---

## Architecture: Core + Modules

```
src/
  core/                       <-- Shared platform shell
    auth/                     <-- Login, session, token management
    permissions/              <-- Role & permission engine
    layout/                   <-- Sidebar, topbar, navigation shell
    theme/                    <-- Light/dark mode, CSS variables
    router/                   <-- Client-side routing, module route registration
    notifications/            <-- Toast/bell notifications system
    shared-models/            <-- Students, Teachers, Classes, Subjects, Terms
    api-client/               <-- HTTP client, PocketBase/Supabase wrapper
    utils/                    <-- Shared utilities (date formatting, validators, etc.)
    module-loader.js          <-- Reads manifests, registers enabled modules
  modules/
    cbt/                      <-- Current exam platform (first module to extract)
      module.manifest.json
      views/
      css/
      js/
    homework/
      module.manifest.json
      views/
      css/
      js/
    results/
    fees/
    attendance/
    timetable/
    scheme-of-work/
    library/
    communication/
    admissions/
    staff-management/
    student-profiles/
  config/
    client.config.json        <-- Per-client module selection
```

---

## Module Manifest System

Every module declares itself via a `module.manifest.json` at its root. The core shell reads these manifests at startup and only loads enabled modules.

```json
{
  "id": "cbt",
  "name": "CBT / Exams",
  "description": "Computer-Based Testing — create, manage, and take exams",
  "icon": "FileText",
  "version": "1.0.0",
  "routes": [
    { "path": "/exams", "view": "views/teacher-dashboard.html", "roles": ["admin", "teacher"] },
    { "path": "/exams/create", "view": "views/create-exam.html", "roles": ["admin", "teacher"] },
    { "path": "/exams/take/:id", "view": "views/take-exam.html", "roles": ["student"] },
    { "path": "/exams/results/:id", "view": "views/exam-results.html", "roles": ["admin", "teacher", "student"] },
    { "path": "/my-exams", "view": "views/student-dashboard.html", "roles": ["student"] }
  ],
  "nav": [
    { "label": "Exams", "icon": "FileText", "path": "/exams", "roles": ["admin", "teacher"] },
    { "label": "My Exams", "icon": "BookOpen", "path": "/my-exams", "roles": ["student"] }
  ],
  "permissions": [
    "cbt.create_exam",
    "cbt.edit_exam",
    "cbt.delete_exam",
    "cbt.take_exam",
    "cbt.view_results",
    "cbt.view_all_results"
  ],
  "dependencies": [],
  "css": ["css/exam.css", "css/dashboard.css"],
  "js": ["js/examManager.js", "js/takeExam.js", "js/examResults.js", "js/studentDashboard.js"],
  "sharedModels": ["students", "teachers", "classes", "subjects", "terms"]
}
```

### How Modules Register

1. On app startup, `module-loader.js` reads `client.config.json` to get the list of enabled module IDs
2. For each enabled module, it loads `modules/{id}/module.manifest.json`
3. It registers the module's routes with the router
4. It injects the module's nav items into the sidebar (respecting role visibility)
5. It loads the module's CSS and JS files
6. Disabled modules are completely invisible — no routes, no nav items, no loaded code

---

## Client Configuration

Each deployment has a `client.config.json` that controls which modules are active:

```json
{
  "schoolName": "Greenfield Academy",
  "schoolLogo": "assets/greenfield-logo.png",
  "enabledModules": ["cbt", "homework", "results", "attendance", "fees", "timetable"],
  "theme": {
    "primaryColor": "#1A73E8",
    "schoolAccent": "#2E7D32"
  },
  "features": {
    "parentPortal": true,
    "smsNotifications": false,
    "onlinePayment": true
  }
}
```

A school that only wants exams and results:
```json
{
  "enabledModules": ["cbt", "results"]
}
```

The platform works identically — just with fewer sidebar items and routes.

---

## Module Catalog

### CBT / Exams (current app)
Create, manage, and administer computer-based tests. Teachers create exams with multiple question types; students take timed exams; results are auto-graded and viewable.

**Extracted from**: Current entire app (this is the first module to extract during refactor)

### Homework
Teachers assign homework with due dates, attach files/instructions. Students submit work (text, file uploads). Teachers grade and provide feedback. Supports late submission tracking.

### Results / Report Cards
Aggregates scores from CBT, Homework, and teacher-entered grades. Generates per-student, per-term, and cumulative report cards. Printable PDF export. GPA/percentage calculations. Class rankings.

**Dependencies**: Reads data from `cbt` and `homework` modules via shared services (not direct imports).

### School Fees
Track fee schedules per class/term. Record payments (cash, bank transfer, online). Generate receipts. Show outstanding balances. Parent-facing payment status view. Optional payment gateway integration (Paystack, Flutterwave).

### Attendance
Daily class attendance marking by teachers. Per-subject attendance optional. Absence reports and trends. Parent notification for absences. Dashboard showing attendance percentages.

### Timetable
Class schedules by day/period. Teacher assignment to periods. Room allocation. Visual timetable grid view for students, teachers, and admins. Conflict detection (teacher double-booked, room double-booked).

### Scheme of Work
Curriculum planning per subject, per term. Teachers fill in weekly topics, objectives, materials, and activities. Admin review/approval workflow. Linked to timetable subjects.

### Library
Book catalog with search. Borrow/return tracking. Overdue notifications. Student borrowing history. Barcode/ISBN lookup optional.

### Communication
School-wide announcements. Class-specific announcements. Parent-teacher messaging. SMS/email notification integration. Event calendar with reminders.

### Admissions
Online application forms. Document upload (birth certificate, previous records). Application status tracking. Admission letter generation. Student onboarding into the system.

### Staff Management
Teacher and staff profiles. Qualification records. Leave request and approval. Payroll information (view-only or integrated). Performance notes.

### Student Profiles
Comprehensive student records: bio-data, parent/guardian info, medical info, previous schools. Profile photo. Linked across all modules (exams, attendance, fees, etc.).

---

## Shared Data Models (Core)

These entities are used across multiple modules and live in `core/shared-models/`, NOT inside any single module:

| Model | Used By |
|-------|---------|
| **Student** | All modules |
| **Teacher/Staff** | CBT, Homework, Attendance, Timetable, Staff Management |
| **Class** | All modules |
| **Subject** | CBT, Homework, Results, Timetable, Scheme of Work |
| **Term** | CBT, Homework, Results, Fees, Attendance, Scheme of Work |
| **School** | All modules (multi-tenancy) |
| **Parent/Guardian** | Fees, Communication, Student Profiles |
| **AcademicSession** | Results, Fees, all term-based modules |

Modules reference these models but never define their own version of them.

---

## Database Strategy

### Table Naming Convention
- **Core tables** (no prefix): `students`, `teachers`, `classes`, `subjects`, `terms`, `users`, `roles`, `permissions`
- **Module tables** (prefixed with module ID): `cbt_exams`, `cbt_questions`, `cbt_attempts`, `hw_assignments`, `hw_submissions`, `fees_payments`, `fees_schedules`, `att_records`, etc.

### Foreign Keys
Module tables reference core tables freely (e.g., `cbt_exams.class_id → classes.id`). Modules should NOT reference other module tables directly — use the shared service layer instead.

### Migration Strategy
- Core migrations run first and are always applied
- Each module has its own migrations folder: `modules/cbt/migrations/`, `modules/homework/migrations/`, etc.
- Only migrations for enabled modules are applied
- Module migrations can depend on core tables but not on other module tables

---

## Inter-Module Communication

Modules must NEVER import directly from each other. All cross-module data flows through two mechanisms:

### 1. Shared Service Layer (for data queries)
```javascript
// In the Results module — getting exam scores
import { getModuleService } from '../../core/module-loader.js';

const cbtService = getModuleService('cbt');
if (cbtService) {
  const scores = await cbtService.getStudentScores(studentId, termId);
}
// If CBT module isn't enabled, cbtService is null — Results handles gracefully
```

Each module exposes a public service API in its manifest. Other modules consume it through the loader — never by direct file import.

### 2. Event Bus (for real-time reactions)
```javascript
// CBT module emits when an exam is submitted
eventBus.emit('cbt:exam-submitted', { studentId, examId, score });

// Results module listens (if enabled)
eventBus.on('cbt:exam-submitted', ({ studentId, examId, score }) => {
  // Update cumulative results
});
```

Events are namespaced by module ID. If the listening module isn't enabled, the event simply has no listeners — no errors.

---

## Roles & Permissions

### Default Roles
| Role | Description |
|------|-------------|
| `super_admin` | Platform-level admin (manages schools in multi-tenant setup) |
| `school_admin` | School principal/administrator — full access to enabled modules |
| `teacher` | Creates content, grades, marks attendance for assigned classes |
| `student` | Takes exams, submits homework, views own results/fees |
| `parent` | Views child's results, fees, attendance (read-only) |

### Permission Format
`{module_id}.{action}` — e.g., `cbt.create_exam`, `fees.record_payment`, `att.mark_attendance`

### How It Works
1. Each module declares its permissions in `module.manifest.json`
2. The core permission engine registers these when the module loads
3. Roles are assigned a set of permissions (configurable per school)
4. Route guards and UI elements check permissions before allowing access
5. If a module is disabled, its permissions don't exist — no need to clean up role assignments

---

## Refactoring Plan: From Current CBT App to SMS Platform

**Do this ONLY after the current exam period is over. Work on a separate branch.**

### Phase 1: Extract Core Shell (1-2 weeks)
1. Create `src/core/` directory structure
2. Move `auth.js` → `core/auth/`
3. Move sidebar, topbar, and navigation logic → `core/layout/`
4. Move theme/dark-mode logic → `core/theme/`
5. Move `dataService.js` → `core/api-client/` (generalize it)
6. Move shared utilities from `utils.js` → `core/utils/`
7. Create `core/router/` — extract routing logic from `app.js`
8. Create `core/module-loader.js` — start with hardcoded CBT module
9. **Test**: App works identically to before — this is pure restructuring

### Phase 2: Extract CBT as First Module (1 week)
1. Create `src/modules/cbt/` directory
2. Move exam-related files:
   - `examManager.js`, `takeExam.js`, `examResults.js`, `studentDashboard.js` → `modules/cbt/js/`
   - `create-exam.html`, `take-exam.html`, `exam-results.html`, `teacher-dashboard.html`, `student-dashboard.html` → `modules/cbt/views/`
   - `exam.css`, `dashboard.css` → `modules/cbt/css/`
3. Create `modules/cbt/module.manifest.json`
4. Update `module-loader.js` to read the CBT manifest and register its routes/nav
5. Create `client.config.json` with `enabledModules: ["cbt"]`
6. **Test**: Full exam flow works — create exam, take exam, view results. Nothing broken.

### Phase 3: Build Module Loader Infrastructure (1 week)
1. Implement dynamic route registration from manifests
2. Implement dynamic sidebar nav injection from manifests
3. Implement permission checking from manifest declarations
4. Implement CSS/JS lazy loading per module
5. Create a second dummy module (e.g., "Attendance" with just a placeholder page) to prove the system works with 2+ modules
6. **Test**: Disabling CBT in config hides it completely. Enabling attendance shows it.

### Phase 4: Build Real Modules (Ongoing)
- Pick modules based on client demand — don't build all 12 at once
- Recommended order (most value, least complexity first):
  1. **Attendance** — simple CRUD, high daily usage
  2. **Results / Report Cards** — schools need this constantly
  3. **Homework** — natural extension of CBT
  4. **Fees** — high client demand, relatively isolated
  5. **Timetable** — visual, useful, standalone
  6. Everything else as needed

### At Every Phase
- The app must work identically after each phase — no broken functionality
- Commit frequently, test after every file move
- Keep `main` branch stable — refactor on a `refactor/modular-architecture` branch
- Merge to `main` only when a phase is fully tested

---

## Design System

All UI design guidelines remain in the original `CLAUDE.md` and apply globally:
- Color palette, typography, sidebar layout, card design, dark mode — all still apply
- The module system affects **structure**, not **visual design**
- Each module's views follow the same design system (sidebar, topbar, cards, tables, etc.)
- Module-specific UI components live in the module's own CSS — shared design tokens come from `core/theme/`

**Do not duplicate the design guidelines here.** Refer to `CLAUDE.md` for all visual/UI rules.

---

## Rules

### Never Do
- Import directly between modules (`modules/cbt/` must never `import` from `modules/homework/`)
- Put module-specific database tables in core migrations
- Remove or break any existing CBT functionality during refactoring
- Build all modules at once — ship incrementally
- Hardcode module references in the core shell (use manifests and dynamic loading)
- Create separate repos/builds for modules (keep it a monorepo)

### Always Do
- Test the full exam flow after any structural change
- Keep `module.manifest.json` as the single source of truth for each module's routes, nav, and permissions
- Handle missing/disabled modules gracefully (null checks, not crashes)
- Use the event bus for cross-module communication, not direct imports
- Namespace database tables by module ID
- Work on a separate git branch during the refactor
