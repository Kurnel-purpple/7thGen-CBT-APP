-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES (Users)
create table profiles (
  id uuid references auth.users not null primary key,
  role text check (role in ('teacher', 'student')),
  full_name text,
  class_level text, -- For students (e.g., 'Grade 10')
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS for Profiles
alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone."
  on profiles for select
  using ( true );

create policy "Users can insert their own profile."
  on profiles for insert
  with check ( auth.uid() = id );

create policy "Users can update own profile."
  on profiles for update
  using ( auth.uid() = id );

-- EXAMS
create table exams (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  subject text,
  target_class text, -- e.g., 'Grade 10' or 'All'
  duration integer, -- in minutes
  pass_score integer,
  instructions text,
  questions jsonb default '[]'::jsonb, -- Storing questions as JSON for flexibility
  status text default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references profiles(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- RLS for Exams
alter table exams enable row level security;

create policy "Active exams are viewable by students."
  on exams for select
  using ( status = 'active' );

create policy "Teachers can see all their own exams."
  on exams for select
  using ( auth.uid() = created_by );

create policy "Teachers can insert exams."
  on exams for insert
  with check ( auth.uid() = created_by );

create policy "Teachers can update their own exams."
  on exams for update
  using ( auth.uid() = created_by );

create policy "Teachers can delete their own exams."
  on exams for delete
  using ( auth.uid() = created_by );

-- RESULTS
create table results (
  id uuid default uuid_generate_v4() primary key,
  exam_id uuid references exams(id) not null,
  student_id uuid references profiles(id) not null,
  score integer,
  total_points integer,
  answers jsonb, -- Store student answers for review
  submitted_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS for Results
alter table results enable row level security;

create policy "Students can view their own results."
  on results for select
  using ( auth.uid() = student_id );

create policy "Teachers can view results for their exams."
  on results for select
  using ( 
    exists (
      select 1 from exams 
      where exams.id = results.exam_id 
      and exams.created_by = auth.uid()
    )
  );

create policy "Students can insert their own results."
  on results for insert
  with check ( auth.uid() = student_id );
