-- ============================================================
-- SECURITY MIGRATION: Exam Scheduling RLS Enforcement
-- ============================================================
-- This migration adds Row-Level Security policies that prevent
-- students from accessing exam data before the scheduled time.
-- 
-- The enforcement happens at the DATABASE level, so students
-- CANNOT bypass it using browser DevTools or JavaScript manipulation.
-- ============================================================

-- Step 1: Make sure RLS is enabled on the exams table
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop existing policies on exams table (if any) to recreate them
-- Comment these out if you want to keep existing policies and just add new ones
DROP POLICY IF EXISTS "Teachers can view their own exams" ON exams;
DROP POLICY IF EXISTS "Teachers can create exams" ON exams;
DROP POLICY IF EXISTS "Teachers can update their own exams" ON exams;
DROP POLICY IF EXISTS "Teachers can delete their own exams" ON exams;
DROP POLICY IF EXISTS "Students can view available exams" ON exams;
DROP POLICY IF EXISTS "Anyone can view active exams" ON exams;
DROP POLICY IF EXISTS "Authenticated users can view exams" ON exams;

-- ============================================================
-- TEACHER POLICIES - Full access to their own exams
-- ============================================================

-- Teachers can view ALL their own exams (regardless of schedule/status)
CREATE POLICY "Teachers can view their own exams"
ON exams FOR SELECT
TO authenticated
USING (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'teacher'
    )
);

-- Teachers can create exams
CREATE POLICY "Teachers can create exams"
ON exams FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'teacher'
    )
);

-- Teachers can update their own exams
CREATE POLICY "Teachers can update their own exams"
ON exams FOR UPDATE
TO authenticated
USING (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'teacher'
    )
);

-- Teachers can delete their own exams
CREATE POLICY "Teachers can delete their own exams"
ON exams FOR DELETE
TO authenticated
USING (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'teacher'
    )
);

-- ============================================================
-- STUDENT POLICIES - Restricted access with scheduling enforcement
-- ============================================================

-- Students can ONLY view exams that:
-- 1. Are 'active' (not draft, not archived)
-- 2. Have NO scheduled_date OR scheduled_date is in the PAST
-- 3. Match their class level OR exam is for 'All' classes
CREATE POLICY "Students can view available exams"
ON exams FOR SELECT
TO authenticated
USING (
    -- Must be a student
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'student'
    )
    -- Exam must be active (not draft, not archived)
    AND status = 'active'
    -- SCHEDULING ENFORCEMENT: No schedule OR schedule time has passed
    AND (
        scheduled_date IS NULL 
        OR scheduled_date <= NOW()
    )
    -- Class targeting check (exam is for All OR matches student's class)
    AND (
        target_class = 'All'
        OR target_class IS NULL
        OR target_class = (
            SELECT class_level FROM profiles 
            WHERE profiles.id = auth.uid()
        )
    )
);

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON POLICY "Students can view available exams" ON exams IS 
'Enforces exam scheduling at database level. Students cannot see exams before their scheduled time, even if they manipulate client-side JavaScript. This policy also enforces class-level targeting and excludes draft/archived exams.';

-- ============================================================
-- VERIFICATION QUERIES (Run these to test the policies)
-- ============================================================
-- 
-- As a teacher, you should see ALL your exams:
-- SELECT * FROM exams WHERE created_by = 'your-teacher-uuid';
--
-- As a student, you should ONLY see:
-- - Active exams
-- - With no schedule OR past schedule
-- - Matching your class
--
-- Test with a future-dated exam:
-- UPDATE exams SET scheduled_date = NOW() + INTERVAL '1 day' WHERE id = 'some-exam-id';
-- Then try to fetch as student - should NOT appear!
--
-- Test with a past-dated exam:
-- UPDATE exams SET scheduled_date = NOW() - INTERVAL '1 day' WHERE id = 'some-exam-id';
-- Then try to fetch as student - SHOULD appear!
