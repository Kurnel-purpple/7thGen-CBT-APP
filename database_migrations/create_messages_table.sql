-- ============================================
-- Create Messages Table for Admin-Teacher Communication
-- ============================================

-- Step 1: Drop existing table if it has wrong foreign keys
DROP TABLE IF EXISTS public.messages;

-- Step 2: Create the messages table referencing profiles (not auth.users)
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    school_version TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_messages_to_id ON public.messages(to_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_id ON public.messages(from_id);
CREATE INDEX IF NOT EXISTS idx_messages_school_version ON public.messages(school_version);

-- Step 4: Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Step 5: Drop existing policies if any
DROP POLICY IF EXISTS "Users can read their own messages" ON public.messages;
DROP POLICY IF EXISTS "Admins can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Recipients can update messages" ON public.messages;

-- Step 6: Create RLS policies

-- Anyone can read messages sent TO them or FROM them
CREATE POLICY "Users can read their own messages"
ON public.messages FOR SELECT
USING (auth.uid() = to_id OR auth.uid() = from_id);

-- Authenticated users can insert messages (for sending)
CREATE POLICY "Authenticated users can send messages"
ON public.messages FOR INSERT
WITH CHECK (auth.uid() = from_id);

-- Recipients can update messages (mainly for marking as read)
CREATE POLICY "Recipients can update messages"
ON public.messages FOR UPDATE
USING (auth.uid() = to_id);

-- Recipients can delete their own messages
CREATE POLICY "Recipients can delete messages"
ON public.messages FOR DELETE
USING (auth.uid() = to_id);

-- ============================================
-- DONE! Messages table is ready.
-- Run this in Supabase SQL Editor.
-- ============================================
