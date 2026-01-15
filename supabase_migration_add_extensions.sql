-- Migration: Add time extension columns to exams table
-- Run this in your Supabase SQL Editor

-- Add extensions column (JSONB to store individual student extensions)
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS extensions JSONB DEFAULT '{}'::jsonb;

-- Add global_extension column (JSONB to store global extension for all students)
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS global_extension JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN exams.extensions IS 'Individual student time extensions. Format: {"student_id": {"addedMinutes": 15, "grantedAt": "2026-01-15T18:00:00Z"}}';
COMMENT ON COLUMN exams.global_extension IS 'Global time extension for all students. Format: {"addedMinutes": 10, "grantedAt": "2026-01-15T18:00:00Z"}';
