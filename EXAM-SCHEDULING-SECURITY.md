# Exam Scheduling Security

## The Security Problem

Without server-side enforcement, a tech-savvy student could:

1. **Open Browser DevTools** (F12)
2. **Go to Console tab**
3. **Modify the exam object in memory:**
   ```javascript
   // Student could type this in console:
   exam.scheduledDate = null; // Remove the schedule
   // or
   exam.scheduledDate = '2020-01-01'; // Set to past date
   ```
4. **Bypass the scheduling check completely**

The client-side JavaScript checks are only for **user experience**, not security!

---

## The Solution: Supabase Row-Level Security (RLS)

We've implemented database-level security that:

- **Runs on Supabase servers** (not in the browser)
- **Cannot be bypassed** by DevTools or JavaScript manipulation
- **Automatically filters** what data students can see

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     STUDENT'S BROWSER                        │
│                                                              │
│  DevTools? JavaScript hacks? Memory manipulation?           │
│  Doesn't matter - they NEVER get the data!                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Request: "Give me all exams"
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE DATABASE                         │
│                                                              │
│  RLS Policy Check:                                          │
│  ✓ Is user a student?                                       │
│  ✓ Is exam status = 'active'?                               │
│  ✓ Is scheduled_date NULL or in the PAST?                   │
│  ✓ Does target_class match student's class?                 │
│                                                              │
│  If ANY check fails → Exam is NOT returned                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Response: Only allowed exams
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     STUDENT'S BROWSER                        │
│                                                              │
│  Receives ONLY the exams they're allowed to see!            │
│  Future-scheduled exams simply DON'T EXIST from their view  │
└─────────────────────────────────────────────────────────────┘
```

---

## RLS Policies Explained

### For Teachers
```sql
-- Teachers see ALL their own exams, regardless of schedule
WHERE created_by = auth.uid() AND role = 'teacher'
```
Teachers need to see scheduled exams to edit them, so they have full access.

### For Students
```sql
-- Students ONLY see exams that meet ALL these conditions:
WHERE 
    role = 'student'
    AND status = 'active'                    -- Not draft or archived
    AND (scheduled_date IS NULL OR scheduled_date <= NOW())  -- Not scheduled for future
    AND (target_class = 'All' OR target_class = student_class)  -- Correct class
```

---

## Installation

### Step 1: Run the Migration
Go to your **Supabase Dashboard** → **SQL Editor** and run:

```sql
-- File: migrations/secure_exam_scheduling_rls.sql
```

Copy the entire contents of that file and execute it.

### Step 2: Verify RLS is Enabled
In Supabase Dashboard → **Table Editor** → **exams** → Check that "RLS Enabled" is ON.

### Step 3: Test the Security

**As a Teacher:**
1. Create an exam with a future scheduled date
2. Verify you can see it in your dashboard

**As a Student:**
1. Log in as a student
2. Try to see the scheduled exam - it should NOT appear
3. Open DevTools and try to manipulate - still won't work!

---

## What Students Experience

| Scenario | What Student Sees |
|----------|-------------------|
| Exam with no schedule | ✅ Visible immediately |
| Exam scheduled for past | ✅ Visible (it's unlocked) |
| Exam scheduled for future | ❌ **Invisible** - doesn't exist in their view |
| Archived exam | ❌ Hidden |
| Draft exam | ❌ Hidden |
| Wrong class exam | ❌ Hidden |

---

## Security Comparison

| Attack Method | Without RLS | With RLS |
|---------------|-------------|----------|
| Modify `exam.scheduledDate` in DevTools | ⚠️ Bypassed | ✅ Protected |
| Delete schedule check from JavaScript | ⚠️ Bypassed | ✅ Protected |
| Direct API call to Supabase | ⚠️ Gets all exams | ✅ Only allowed exams |
| Packet interception | ⚠️ Could modify | ✅ Data never sent |
| Memory manipulation | ⚠️ Bypassed | ✅ Protected |

---

## Important Notes

1. **Backward Compatibility**: The existing client-side checks remain in place for better UX (showing "Scheduled" badges, disabled buttons). They just aren't relied upon for security.

2. **Clock Sync**: The `NOW()` function uses Supabase server time, not the student's computer time. Students can't change their system clock to bypass this.

3. **Teachers Unaffected**: Teachers can still see all their exams, edit scheduled exams, and manage everything normally.

4. **No App Code Changes**: The JavaScript code doesn't need to change - it still tries to fetch exams the same way. The database just returns fewer results for students.

---

## Troubleshooting

### Students can't see ANY exams
Check that:
- The student's `class_level` in their profile matches the exam's `target_class`
- The exam `status` is `'active'` (not `'draft'` or `'archived'`)
- RLS policies were applied correctly

### Teachers can't see their exams
Verify that:
- The teacher's profile has `role = 'teacher'`
- The exam's `created_by` matches the teacher's `auth.uid()`

### Need to debug RLS?
Run this in Supabase SQL Editor:
```sql
-- Check all active policies on exams table
SELECT * FROM pg_policies WHERE tablename = 'exams';
```
