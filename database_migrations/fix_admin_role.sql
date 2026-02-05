-- ============================================
-- COMPLETE FIX - Run this entire script
-- ============================================

-- Step 1: Add school_version column if it doesn't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_version TEXT;

-- Step 2: Drop the old role constraint and add new one with 'admin'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_role_check 
CHECK (role IN ('student', 'teacher', 'admin'));

-- Step 3: Insert missing profiles for existing auth users
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

-- Step 4: Create/update the trigger function
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
    RETURN NEW;
END;
$$;

-- Step 5: Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- DONE! Now try logging in.
-- ============================================
