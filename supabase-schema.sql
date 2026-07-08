-- ═══════════════════════════════════════════════════════════════
-- WILDPATH — PHASE 2 SUPABASE SCHEMA
-- Paste this entire file into the SQL editor and click Run:
-- https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/sql/new
-- ═══════════════════════════════════════════════════════════════

-- ── TABLES ──────────────────────────────────────────────────────

create table profiles (
  id uuid references auth.users primary key,
  username text unique not null,
  full_name text,
  avatar_url text,
  bio text,
  role text default 'explorer',
  created_at timestamptz default now()
);

create table spots (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null,
  lat float not null,
  lng float not null,
  legal_status text not null,
  description text,
  approach text,
  permit_url text,
  permit_name text,
  permit_cost text,
  nearest_town text,
  nearest_hospital text,
  difficulty text,
  hike_time text,
  elevation_gain text,
  best_season text,
  road_condition text,
  submitted_by uuid references profiles(id),
  status text default 'pending',
  discovered_by text,
  created_at timestamptz default now()
);

create table posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  spot_id uuid references spots(id),
  caption text,
  photo_url text,
  video_url text,
  privacy text default 'public',
  likes_count int default 0,
  comments_count int default 0,
  lat float,
  lng float,
  created_at timestamptz default now()
);

create table comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references posts(id) not null,
  user_id uuid references profiles(id) not null,
  content text not null,
  created_at timestamptz default now()
);

create table likes (
  post_id uuid references posts(id),
  user_id uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

create table follows (
  follower_id uuid references profiles(id),
  following_id uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (follower_id, following_id)
);

create table messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references profiles(id) not null,
  receiver_id uuid references profiles(id) not null,
  content text,
  media_url text,
  post_id uuid references posts(id),
  spot_id uuid references spots(id),
  created_at timestamptz default now()
);

create table communities (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  cover_url text,
  privacy text default 'public',
  focus text,
  rules text,
  created_by uuid references profiles(id),
  members_count int default 0,
  created_at timestamptz default now()
);

create table community_members (
  community_id uuid references communities(id),
  user_id uuid references profiles(id),
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (community_id, user_id)
);

create table community_posts (
  id uuid default gen_random_uuid() primary key,
  community_id uuid references communities(id) not null,
  user_id uuid references profiles(id) not null,
  content text,
  photo_url text,
  post_type text default 'post',
  upvotes int default 0,
  downvotes int default 0,
  created_at timestamptz default now()
);

create table saved_spots (
  user_id uuid references profiles(id),
  spot_id uuid references spots(id),
  folder_name text default 'General',
  saved_at timestamptz default now(),
  primary key (user_id, spot_id)
);

create table verifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  spot_id uuid references spots(id),
  verified_at timestamptz default now(),
  lat float,
  lng float
);

create table notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  type text not null,
  from_user_id uuid references profiles(id),
  post_id uuid references posts(id),
  spot_id uuid references spots(id),
  message text,
  read boolean default false,
  created_at timestamptz default now()
);

create table pending_spots (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null,
  lat float not null,
  lng float not null,
  legal_status text,
  description text,
  approach text,
  photo_urls text[],
  submitted_by uuid references profiles(id),
  submitted_at timestamptz default now(),
  status text default 'pending'
);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────────

alter table profiles enable row level security;
alter table spots enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table likes enable row level security;
alter table follows enable row level security;
alter table messages enable row level security;
alter table communities enable row level security;
alter table community_members enable row level security;
alter table community_posts enable row level security;
alter table saved_spots enable row level security;
alter table verifications enable row level security;
alter table notifications enable row level security;
alter table pending_spots enable row level security;

-- ── POLICIES ────────────────────────────────────────────────────

-- profiles: everyone authenticated can read; users manage only their own row
create policy "profiles_select" on profiles for select to authenticated using (true);
create policy "profiles_insert_own" on profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on profiles for update to authenticated using (auth.uid() = id);

-- posts: public posts readable by anyone; users insert/delete their own
create policy "posts_select_public" on posts for select using (privacy = 'public');
create policy "posts_select_own" on posts for select to authenticated using (auth.uid() = user_id);
create policy "posts_insert_own" on posts for insert to authenticated with check (auth.uid() = user_id);
create policy "posts_delete_own" on posts for delete to authenticated using (auth.uid() = user_id);

-- messages: only sender or receiver can read; only sender can insert
create policy "messages_select_own" on messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "messages_insert_own" on messages for insert to authenticated
  with check (auth.uid() = sender_id);

-- spots: anyone can read approved; authenticated can insert (admin approval flow)
create policy "spots_select_approved" on spots for select using (status = 'approved');
create policy "spots_insert_auth" on spots for insert to authenticated with check (true);

-- comments
create policy "comments_select" on comments for select to authenticated using (true);
create policy "comments_insert_own" on comments for insert to authenticated with check (auth.uid() = user_id);
create policy "comments_delete_own" on comments for delete to authenticated using (auth.uid() = user_id);

-- likes (delete needed for unlike)
create policy "likes_select" on likes for select to authenticated using (true);
create policy "likes_insert_own" on likes for insert to authenticated with check (auth.uid() = user_id);
create policy "likes_delete_own" on likes for delete to authenticated using (auth.uid() = user_id);

-- follows (delete needed for unfollow)
create policy "follows_select" on follows for select to authenticated using (true);
create policy "follows_insert_own" on follows for insert to authenticated with check (auth.uid() = follower_id);
create policy "follows_delete_own" on follows for delete to authenticated using (auth.uid() = follower_id);

-- communities
create policy "communities_select" on communities for select to authenticated using (true);
create policy "communities_insert_own" on communities for insert to authenticated with check (auth.uid() = created_by);
create policy "communities_update_creator" on communities for update to authenticated using (auth.uid() = created_by);

-- community_members (delete needed for leave)
create policy "community_members_select" on community_members for select to authenticated using (true);
create policy "community_members_insert_own" on community_members for insert to authenticated with check (auth.uid() = user_id);
create policy "community_members_delete_own" on community_members for delete to authenticated using (auth.uid() = user_id);

-- community_posts
create policy "community_posts_select" on community_posts for select to authenticated using (true);
create policy "community_posts_insert_own" on community_posts for insert to authenticated with check (auth.uid() = user_id);
create policy "community_posts_delete_own" on community_posts for delete to authenticated using (auth.uid() = user_id);

-- saved_spots (delete needed for unsave)
create policy "saved_spots_select_own" on saved_spots for select to authenticated using (auth.uid() = user_id);
create policy "saved_spots_insert_own" on saved_spots for insert to authenticated with check (auth.uid() = user_id);
create policy "saved_spots_delete_own" on saved_spots for delete to authenticated using (auth.uid() = user_id);

-- verifications
create policy "verifications_select" on verifications for select to authenticated using (true);
create policy "verifications_insert_own" on verifications for insert to authenticated with check (auth.uid() = user_id);

-- notifications (update needed for mark-as-read)
create policy "notifications_select_own" on notifications for select to authenticated using (auth.uid() = user_id);
create policy "notifications_insert_auth" on notifications for insert to authenticated with check (auth.uid() = from_user_id);
create policy "notifications_update_own" on notifications for update to authenticated using (auth.uid() = user_id);

-- pending_spots (select for admin review; delete needed for approve/reject)
create policy "pending_spots_select" on pending_spots for select to authenticated using (true);
create policy "pending_spots_insert_own" on pending_spots for insert to authenticated with check (auth.uid() = submitted_by);
create policy "pending_spots_delete" on pending_spots for delete to authenticated
  using (
    auth.uid() = submitted_by
    or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
  );

-- ── REALTIME ────────────────────────────────────────────────────

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table posts;
