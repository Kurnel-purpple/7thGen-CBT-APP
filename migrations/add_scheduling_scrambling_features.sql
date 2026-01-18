-- Migration: Add scheduling and scrambling features to exams table
-- Run this in your Supabase SQL Editor

-- Add scheduled_date column for exam scheduling
ALTER TABLE exams ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMPTZ DEFAULT NULL;

-- Add scramble_questions column for randomizing question order per student
ALTER TABLE exams ADD COLUMN IF NOT EXISTS scramble_questions BOOLEAN DEFAULT FALSE;

-- Add pass_score and passed columns to results table (if they don't exist)
-- These were added for the flag resolution feature
ALTER TABLE results ADD COLUMN IF NOT EXISTS pass_score INTEGER DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT NULL;

-- Create an index on scheduled_date for efficient querying
CREATE INDEX IF NOT EXISTS idx_exams_scheduled_date ON exams(scheduled_date);

-- Create an index on status for efficient filtering of archived exams
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);

-- Comment on new columns
COMMENT ON COLUMN exams.scheduled_date IS 'Optional date/time when the exam becomes available to students';
COMMENT ON COLUMN exams.scramble_questions IS 'If true, questions are presented in random order for each student';
