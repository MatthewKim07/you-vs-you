-- Run this in your Supabase SQL editor (Dashboard → SQL editor → New query)

-- profiles: one row per auth user, stores display username
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by everyone"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- infinite_scores: one row per user, best score only
CREATE TABLE IF NOT EXISTS infinite_scores (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  best_score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE infinite_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scores viewable by everyone"
  ON infinite_scores FOR SELECT USING (true);

CREATE POLICY "Users can insert their own score"
  ON infinite_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own score"
  ON infinite_scores FOR UPDATE USING (auth.uid() = user_id);
