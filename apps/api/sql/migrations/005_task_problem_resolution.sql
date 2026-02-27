-- Migration 005: Add problem, resolution, and completed_by_id columns to tasks table
-- These fields capture structured closure data when marking a task as done

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS problem TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
