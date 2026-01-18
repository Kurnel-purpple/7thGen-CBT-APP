# New Features Implementation

## Overview
Three new features have been added to the CBT Exam App:
1. **Exam Scheduling** - Teachers can set when an exam becomes available
2. **Question Scrambling** - Randomize question order per student
3. **Exam Archiving** - Archive old exams to keep dashboard clean

---

## 1. Exam Scheduling

### Description
Teachers can now specify a date and time when an exam becomes accessible to students. Before the scheduled time:
- Students see the exam with a "Scheduled" badge and the unlock date
- The "Start Exam" button is disabled and shows when the exam will be available
- If a student tries to access the exam URL directly, they'll be redirected with a message

### How to Use
1. When creating or editing an exam, find the **"Scheduled Date & Time"** field
2. Leave empty for immediate availability
3. Or select a future date/time when the exam should unlock

### Teacher Dashboard Display
- Scheduled exams show a 📅 icon with the scheduled date
- Past scheduled dates show a ✓ checkmark
- Future scheduled dates are shown in accent color (red)

---

## 2. Question Scrambling

### Description
When enabled, each student receives questions in a different random order. This helps prevent cheating during exams.

### How It Works
- Uses a seeded random algorithm based on student ID
- Same student always gets the same order (consistent on refresh)
- Different students get different orders
- Original question IDs are preserved for correct grading

### How to Use
1. When creating or editing an exam, check the **"Scramble question order"** checkbox
2. The teacher dashboard shows a 🔀 icon for exams with scrambling enabled

### Technical Details
- Uses a Mulberry32 seeded RNG for consistent randomization
- Fisher-Yates shuffle algorithm
- Seed is derived from student's unique ID

---

## 3. Exam Archiving

### Description
Teachers can archive exams that are no longer active. Archived exams:
- Are hidden from students
- Don't count in the "Total Exams" stat
- Can be viewed and restored by teachers
- Appear in a collapsible "Archived Exams" section

### How to Use

#### Archiving an Exam
1. On the teacher dashboard, find the exam card
2. Click the **"📥 Archive"** button
3. Confirm the action

#### Viewing Archived Exams
1. Scroll down to the **"Archived Exams"** section (only visible if you have archived exams)
2. Click the section header to expand/collapse

#### Restoring an Archived Exam
1. Expand the "Archived Exams" section
2. Find the exam and click **"📤 Restore"**
3. Confirm the action
4. The exam will return to the active exams section

### Visual Differences
- Archived exam cards have reduced opacity (0.7)
- No "Extensions" button on archived exams
- "Archive" button replaced with "Restore" button

---

## Database Migration

Before using these features, you must run the database migration:

```sql
-- Run this in your Supabase SQL Editor
-- File: migrations/add_scheduling_scrambling_features.sql

ALTER TABLE exams ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS scramble_questions BOOLEAN DEFAULT FALSE;
ALTER TABLE results ADD COLUMN IF NOT EXISTS pass_score INTEGER DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT NULL;
```

---

## Files Modified

### Core Files
- `src/js/dataService.js` - Added scheduledDate, scrambleQuestions mapping
- `src/js/examManager.js` - Added form handling for new fields
- `src/js/takeExam.js` - Added scrambling logic and schedule validation
- `src/js/studentDashboard.js` - Updated exam filtering and display

### UI Files
- `src/pages/create-exam.html` - Added scheduling and scramble form fields
- `src/pages/teacher-dashboard.html` - Added archive section and functions

### New Files
- `migrations/add_scheduling_scrambling_features.sql` - Database migration

---

## Backward Compatibility

All changes are backward compatible:
- Exams without `scheduledDate` are immediately available (current behavior)
- Exams without `scrambleQuestions` use original order (current behavior)
- Exams without `archived` status appear as active (current behavior)

---

## Testing Checklist

### Scheduling
- [ ] Create exam with scheduled date in future
- [ ] Verify student sees disabled button with date
- [ ] Wait for scheduled time, verify exam becomes available
- [ ] Try to access scheduled exam URL directly (should redirect)
- [ ] Edit existing exam to add/remove/change scheduled date

### Scrambling
- [ ] Create exam with scrambling enabled
- [ ] Have two students take the exam
- [ ] Verify questions appear in different order
- [ ] Verify same student gets same order on refresh
- [ ] Verify grading works correctly

### Archiving
- [ ] Archive an active exam
- [ ] Verify it moves to archived section
- [ ] Verify students cannot see archived exam
- [ ] Verify archived count updates
- [ ] Restore an archived exam
- [ ] Verify it returns to active section
