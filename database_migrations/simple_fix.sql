-- ============================================
-- STEP 1: Create the profiles table
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student',
    full_name TEXT,
    class_level TEXT,
    school_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STEP 2: Add school_version column if missing
-- ============================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_version TEXT;

-- ============================================
-- STEP 3: Enable RLS
-- ============================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 4: Drop and recreate policies
-- ============================================
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;
DROP POLICY IF EXISTS "Service role can do everything" ON public.profiles;

-- Everyone can read profiles
CREATE POLICY "Public profiles are viewable by everyone"
ON public.profiles FOR SELECT
USING (true);

-- Authenticated users can insert their own profile
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- ============================================
-- STEP 5: Create the auto-profile trigger
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name, class_level, school_version)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'class_level',
        NEW.raw_user_meta_data->>'school_version'
    );
    RETURN NEW;
EXCEPTION WHEN unique_violation THEN
    -- Profile already exists, update it instead
    UPDATE public.profiles SET
        role = COALESCE(NEW.raw_user_meta_data->>'role', role),
        full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', full_name),
        class_level = COALESCE(NEW.raw_user_meta_data->>'class_level', class_level),
        school_version = COALESCE(NEW.raw_user_meta_data->>'school_version', school_version),
        updated_at = NOW()
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STEP 6: Fix existing users without profiles
-- ============================================
INSERT INTO public.profiles (id, role, full_name, class_level, school_version)
SELECT 
    id,
    COALESCE(raw_user_meta_data->>'role', 'student'),
    raw_user_meta_data->>'full_name',
    raw_user_meta_data->>'class_level',
    raw_user_meta_data->>'school_version'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DONE! Try registering a new user now.
-- ============================================
