-- Performance Optimization SQL for Student Dashboard
-- Run these in your Supabase SQL Editor

-- 1. Add indexes for student dashboard queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_status_subject ON exams(status, subject);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_target_class ON exams(target_class);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_created_at ON exams(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_status ON exams(status) WHERE status = 'active';

-- 2. Optimize results table for student queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_student_id ON results(student_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_submitted_at ON results(submitted_at DESC);

-- 3. Composite index for common student dashboard query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_student_exam_submitted ON results(student_id, exam_id, submitted_at DESC);

-- 4. Add partial indexes for better performance on active data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exams_active_published ON exams(status, created_at DESC) WHERE status = 'active';

-- 5. Function to get optimized student dashboard data
CREATE OR REPLACE FUNCTION get_student_dashboard_data(student_uuid uuid)
RETURNS TABLE(
    exams json,
    results json
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        json_agg(
            json_build_object(
                'id', e.id,
                'title', e.title,
                'subject', e.subject,
                'targetClass', e.target_class,
                'duration', e.duration,
                'passScore', e.pass_score,
                'instructions', e.instructions,
                'status', e.status,
                'createdBy', e.created_by,
                'createdAt', e.created_at,
                'updatedAt', e.updated_at
            )
        ) as exams,
        json_agg(
            json_build_object(
                'id', r.id,
                'examId', r.exam_id,
                'studentId', r.student_id,
                'score', r.score,
                'totalPoints', r.total_points,
                'answers', r.answers,
                'submittedAt', r.submitted_at,
                'flags', r.flags
            )
        ) as results
    FROM exams e
    LEFT JOIN results r ON r.student_id = student_uuid
    WHERE e.status = 'active' OR r.student_id = student_uuid
    GROUP BY e.status;
END;
$$ LANGUAGE plpgsql;

-- 6. Create optimized view for student dashboard
CREATE OR REPLACE VIEW student_dashboard_view AS
SELECT 
    e.id,
    e.title,
    e.subject,
    e.target_class,
    e.duration,
    e.pass_score,
    e.instructions,
    e.status,
    e.created_at,
    e.updated_at,
    r.id as result_id,
    r.score,
    r.total_points,
    r.submitted_at,
    r.flags
FROM exams e
LEFT JOIN results r ON r.exam_id = e.id
WHERE e.status = 'active'
ORDER BY e.created_at DESC;

-- 7. Add index for the view's underlying queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_dashboard_composite ON exams(status, created_at DESC) WHERE status = 'active';