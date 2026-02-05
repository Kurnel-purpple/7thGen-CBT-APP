-- Admin System Database Schema Updates
-- This file contains the SQL commands needed to support the admin functionality
-- Run this file in your Supabase SQL Editor

-- ============================================
-- STEP 1: Create the profiles table (if not exists)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    full_name TEXT,
    class_level TEXT,
    school_version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- STEP 2: Add school_version column if it doesn't exist
-- (This is for existing databases that already have the profiles table)
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'school_version'
    ) THEN
        ALTER TABLE profiles ADD COLUMN school_version TEXT;
    END IF;
END $$;

-- ============================================
-- STEP 3: Enable RLS on profiles table with proper policies
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;

-- Allow everyone to read profiles (needed for teacher lists, etc.)
CREATE POLICY "Public profiles are viewable by everyone"
    ON profiles FOR SELECT
    USING (true);

-- Allow authenticated users to insert their own profile
-- This is more permissive to handle the registration flow
CREATE POLICY "Enable insert for authenticated users only"
    ON profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- ============================================
-- STEP 4: Create a trigger to auto-create profile on user signup
-- This ensures profile is always created even if client-side fails
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name, class_level, school_version)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'class_level',
        NEW.raw_user_meta_data->>'school_version'
    )
    ON CONFLICT (id) DO UPDATE SET
        role = COALESCE(EXCLUDED.role, profiles.role),
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        class_level = COALESCE(EXCLUDED.class_level, profiles.class_level),
        school_version = COALESCE(EXCLUDED.school_version, profiles.school_version),
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it exists and recreate it
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STEP 5: Create messages table for admin-teacher communication
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    from_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    school_version TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- STEP 6: Create indexes for better query performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_messages_to_id ON messages(to_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_id ON messages(from_id);
CREATE INDEX IF NOT EXISTS idx_messages_school_version ON messages(school_version);
CREATE INDEX IF NOT EXISTS idx_profiles_school_version ON profiles(school_version);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ============================================
-- STEP 7: Enable RLS and create policies for messages table
-- ============================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can read their own messages" ON messages;
DROP POLICY IF EXISTS "Admins can send messages" ON messages;
DROP POLICY IF EXISTS "Users can update their message read status" ON messages;

-- Allow users to read messages sent to them or from them
CREATE POLICY "Users can read their own messages"
    ON messages FOR SELECT
    USING (auth.uid() = to_id OR auth.uid() = from_id);

-- Allow admins to send messages
CREATE POLICY "Admins can send messages"
    ON messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Allow users to update read status of their messages
CREATE POLICY "Users can update their message read status"
    ON messages FOR UPDATE
    USING (auth.uid() = to_id)
    WITH CHECK (auth.uid() = to_id);

-- ============================================
-- STEP 8: Add comments to document the schema
-- ============================================
COMMENT ON TABLE profiles IS 'User profiles for students, teachers, and admins';
COMMENT ON TABLE messages IS 'Stores messages between admins and teachers for communication';
COMMENT ON COLUMN profiles.school_version IS 'Identifies which school the user belongs to (e.g., seatos, myschool)';
COMMENT ON COLUMN profiles.role IS 'User role: student, teacher, or admin';

-- ============================================
-- STEP 9: Create function and trigger for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for both tables
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STEP 10: Fix any existing users without profiles
-- This will create profiles for any auth users that don't have one
-- ============================================
INSERT INTO public.profiles (id, role, full_name, class_level, school_version)
SELECT 
    u.id,
    COALESCE(u.raw_user_meta_data->>'role', 'student'),
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'class_level',
    u.raw_user_meta_data->>'school_version'
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SUCCESS! Your database is now ready for the admin system.
-- The trigger will automatically create profiles for new users.
-- ============================================
