# PocketBase Manual Setup Guide

## Step 1: Start PocketBase (Already Done ✅)
PocketBase is running at: http://127.0.0.1:8090

## Step 2: Create Admin Account
1. Open http://127.0.0.1:8090/_/ in your browser
2. Click "Create Admin Account"
3. Enter email and password
4. Click "Create"

## Step 3: Create Collections

### Collection 1: profiles
Click "New Collection" and enter:
- **Name**: `profiles`
- **Type**: Base

**Fields:**
1. `user` (Relation) → Collection: users, Required: Yes, Cascade Delete: Yes
2. `role` (Select) → Values: student, teacher, admin, Required: Yes
3. `full_name` (Text) → Required: Yes
4. `class_level` (Text) → Required: No
5. `school_version` (Text) → Required: No

**Record Rules (click "Record rules" tab):**
- List: `@request.auth.id != ""`
- View: `@request.auth.id != ""`
- Create: `@request.auth.id != ""`
- Update: `@request.auth.id = user`
- Delete: `@request.auth.id = user`

Click "Save"

### Collection 2: exams
Click "New Collection" and enter:
- **Name**: `exams`
- **Type**: Base

**Fields:**
1. `title` (Text) → Required: Yes
2. `subject` (Text) → Required: Yes
3. `target_class` (Text) → Required: Yes
4. `duration` (Number) → Required: Yes
5. `pass_score` (Number) → Required: Yes
6. `instructions` (Editor) → Required: No
7. `theory_instructions` (Editor) → Required: No
8. `questions` (JSON) → Required: No
9. `status` (Select) → Values: draft, active, archived, Required: Yes
10. `created_by` (Relation) → Collection: users, Required: Yes
11. `scheduled_date` (Date) → Required: No
12. `scramble_questions` (Bool) → Required: No
13. `client_id` (Text) → Required: No
14. `school_level` (Text) → Required: No
15. `extensions` (JSON) → Required: No
16. `global_extension` (Number) → Required: No

**Record Rules:**
- List: `@request.auth.id != "" && (status = "active" || created_by = @request.auth.id)`
- View: `@request.auth.id != "" && (status = "active" || created_by = @request.auth.id)`
- Create: `@request.auth.id != "" && @request.auth.role = "teacher"`
- Update: `@request.auth.id = created_by || @request.auth.role = "admin"`
- Delete: `@request.auth.id = created_by || @request.auth.role = "admin"`

Click "Save"

### Collection 3: results
Click "New Collection" and enter:
- **Name**: `results`
- **Type**: Base

**Fields:**
1. `exam_id` (Relation) → Collection: exams, Required: Yes
2. `student_id` (Relation) → Collection: users, Required: Yes
3. `score` (Number) → Required: No
4. `total_points` (Number) → Required: No
5. `answers` (JSON) → Required: No
6. `flags` (JSON) → Required: No
7. `submitted_at` (Date) → Required: No
8. `pass_score` (Number) → Required: No
9. `passed` (Bool) → Required: No

**Record Rules:**
- List: `@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"`
- View: `@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"`
- Create: `@request.auth.id = student_id`
- Update: `@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"`
- Delete: `@request.auth.role = "admin"`

Click "Save"

### Collection 4: messages (Optional)
Click "New Collection" and enter:
- **Name**: `messages`
- **Type**: Base

**Fields:**
1. `from_id` (Relation) → Collection: users, Required: Yes
2. `to_id` (Relation) → Collection: users, Required: Yes
3. `message` (Text) → Required: Yes
4. `school_version` (Text) → Required: No
5. `read` (Bool) → Required: No

**Record Rules:**
- List: `@request.auth.id = from_id || @request.auth.id = to_id`
- View: `@request.auth.id = from_id || @request.auth.id = to_id`
- Create: `@request.auth.id = from_id`
- Update: `@request.auth.id = from_id || @request.auth.id = to_id`
- Delete: `@request.auth.id = from_id || @request.auth.id = to_id`

Click "Save"

## Step 4: Update Users Collection

1. Click on "users" collection in the sidebar
2. Click "Edit Collection"
3. Add these fields:

**Fields to add:**
1. `role` (Select) → Values: student, teacher, admin, Required: Yes
2. `full_name` (Text) → Required: Yes
3. `class_level` (Text) → Required: No
4. `school_version` (Text) → Required: No

Click "Save"

## Step 5: Test Your Setup

1. Go to http://127.0.0.1:8090/_/ (Admin UI)
2. Click on "users" collection
3. Click "New Record"
4. Create a test user:
   - Email: test@school.cbt
   - Password: test123
   - role: student
   - full_name: Test Student
   - class_level: JSS1

5. Open your CBT app in browser
6. Try logging in with: test / test123

## Done! 🎉

Your PocketBase backend is now ready to use with the CBT app!
