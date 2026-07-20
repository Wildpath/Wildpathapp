# WildPath — Supabase Setup (do these two things once)

## 1. Create the database tables

1. Open https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/sql/new
2. Open the file `supabase-schema.sql` in this repo and copy its ENTIRE contents
3. Paste into the SQL editor and click **Run** (bottom right)
4. You should see "Success. No rows returned"

## 2. Create the four storage buckets

Open https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/storage/buckets

For EACH of these four buckets — `Avatars`, `Post Media`, `Spot Photos`, `Community Covers` —
(names must match this capitalization exactly; the app code and the Section 11 RLS policies
below both reference these exact strings) do this:

1. Click the green **New bucket** button (top right)
2. In **Name of bucket** type the bucket name exactly (e.g. `Avatars`)
3. Toggle **Public bucket** ON (this lets the app display images via public URLs)
4. Click **Additional configuration** to expand it
5. Toggle **Restrict file upload size for bucket** ON and enter `10` MB
   (if the field asks for a value + unit, choose 10 and MB)
6. Click **Save** / **Create bucket**
7. Repeat for the next bucket name

After creating all four you should see: Avatars, Post Media, Spot Photos,
Community Covers — each marked PUBLIC in the bucket list.

## 3. Make yourself admin (after you sign up in the app)

1. Sign up in the app with your email
2. Open https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/editor
3. Open the `profiles` table, find your row, change `role` from `explorer` to `admin`
4. Save — the Admin Review section now appears in your Profile tab

## Section 12 — show_on_spot column (run this in Supabase SQL editor)

```sql
alter table posts add column if not exists show_on_spot boolean default true;
```

Controls whether a post tagged to a spot also appears in that spot's Photos tab.
Defaults to true for all existing and new rows.

## Section 11 — REQUIRED: Storage bucket RLS policies (run this now — fixes broken photo uploads)

This is the actual root cause of "profile photo never displays" (and would also silently break
post photos, spot photos, and community covers). The four buckets exist and are marked Public,
but Storage keeps row-level security enabled on `storage.objects` by default with zero policies —
so every upload is rejected with "new row violates row-level security policy" even though reads
work fine. Run this in the SQL editor:

```sql
-- Avatars
create policy "Avatars public read" on storage.objects for select using (bucket_id = 'Avatars');
create policy "Avatars authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'Avatars');
create policy "Avatars authenticated update" on storage.objects for update to authenticated using (bucket_id = 'Avatars');

-- Post Media
create policy "Post Media public read" on storage.objects for select using (bucket_id = 'Post Media');
create policy "Post Media authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'Post Media');
create policy "Post Media authenticated update" on storage.objects for update to authenticated using (bucket_id = 'Post Media');

-- Spot Photos
create policy "Spot Photos public read" on storage.objects for select using (bucket_id = 'Spot Photos');
create policy "Spot Photos authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'Spot Photos');
create policy "Spot Photos authenticated update" on storage.objects for update to authenticated using (bucket_id = 'Spot Photos');

-- Community Covers
create policy "Community Covers public read" on storage.objects for select using (bucket_id = 'Community Covers');
create policy "Community Covers authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'Community Covers');
create policy "Community Covers authenticated update" on storage.objects for update to authenticated using (bucket_id = 'Community Covers');
```

Verified live: an upload attempt to the Avatars bucket returns
`{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}`
before this SQL is run — confirming this is the real blocker.

## Section 1 — REQUIRED: personal_spots and community_pending_spots tables

Run this in the SQL editor to enable the three-tier spot system (Personal/Community/Global).

```sql
-- Personal spots: instant, zero review, visible only to their owner
create table if not exists personal_spots (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  name text not null,
  type text not null,
  lat float not null,
  lng float not null,
  notes text,
  photo_urls text[],
  created_at timestamptz default now()
);
alter table personal_spots enable row level security;
create policy "personal_spots_select_own" on personal_spots for select to authenticated using (auth.uid() = user_id);
create policy "personal_spots_insert_own" on personal_spots for insert to authenticated with check (auth.uid() = user_id);
create policy "personal_spots_delete_own" on personal_spots for delete to authenticated using (auth.uid() = user_id);

-- Community pending spots: instant submission, requires that community's admin/moderator approval
create table if not exists community_pending_spots (
  id uuid default gen_random_uuid() primary key,
  community_id uuid references communities(id) not null,
  user_id uuid references profiles(id) not null,
  name text not null,
  type text not null,
  lat float not null,
  lng float not null,
  description text,
  photo_urls text[],
  status text default 'pending',
  submitted_at timestamptz default now(),
  reviewed_by uuid references profiles(id)
);
alter table community_pending_spots enable row level security;
create policy "cps_select_member_or_submitter" on community_pending_spots for select to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from community_members cm where cm.community_id = community_pending_spots.community_id and cm.user_id = auth.uid())
  );
create policy "cps_insert_own" on community_pending_spots for insert to authenticated with check (auth.uid() = user_id);
create policy "cps_update_admin_mod" on community_pending_spots for update to authenticated
  using (
    exists (select 1 from community_members cm where cm.community_id = community_pending_spots.community_id and cm.user_id = auth.uid() and cm.role in ('admin','moderator'))
  );
create policy "cps_delete_admin_mod_or_submitter" on community_pending_spots for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from community_members cm where cm.community_id = community_pending_spots.community_id and cm.user_id = auth.uid() and cm.role in ('admin','moderator'))
  );

-- Community-approved spots need somewhere to live once approved — reuse the "spots" table
-- with a community_id column so approved community spots can be filtered per-community.
alter table spots add column if not exists community_id uuid references communities(id);
```

## Section 3 — REQUIRED: saved_places table (generalized save-anything)

The existing `saved_spots` table only works for real rows in `spots` (its `spot_id` is a foreign
key). Section 3 requires saving personal spots, community spots, and raw post locations too —
none of which are guaranteed to have a `spots.id`. This new table has no such constraint and
covers all four cases with one shape.

```sql
create table if not exists saved_places (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  ref_type text not null, -- 'spot' | 'personal_spot' | 'community_spot' | 'raw_location'
  ref_id text,            -- the underlying id when one exists (spots.id, personal_spots.id, etc.) — null for raw_location
  name text not null,
  lat float not null,
  lng float not null,
  folder_name text default 'General',
  saved_at timestamptz default now()
);
alter table saved_places enable row level security;
create policy "saved_places_select_own" on saved_places for select to authenticated using (auth.uid() = user_id);
create policy "saved_places_insert_own" on saved_places for insert to authenticated with check (auth.uid() = user_id);
create policy "saved_places_delete_own" on saved_places for delete to authenticated using (auth.uid() = user_id);
```

## Sections 8 & 9 — REQUIRED: hikes table

```sql
create table if not exists hikes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  name text not null,
  description text,
  route_geojson jsonb not null,
  difficulty text default 'Moderate', -- 'Easy' | 'Moderate' | 'Hard'
  distance float,          -- miles
  duration int,            -- seconds
  elevation_gain float,    -- feet
  photo_urls text[],
  visibility text default 'personal', -- 'personal' | 'community' | 'global'
  community_id uuid references communities(id),
  status text default 'approved', -- 'approved' for personal/community-approved, 'pending' for global review
  created_at timestamptz default now()
);
alter table hikes enable row level security;
-- Members see only APPROVED community hikes; community admins/moderators can also
-- see pending ones (needed for the approval queue); app admins see pending global
-- hikes (needed for the Admin Panel review).
create policy "hikes_select_own_or_visible" on hikes for select to authenticated
  using (
    auth.uid() = user_id
    or (visibility='community' and status='approved' and exists (select 1 from community_members cm where cm.community_id = hikes.community_id and cm.user_id = auth.uid()))
    or (visibility='community' and exists (select 1 from community_members cm where cm.community_id = hikes.community_id and cm.user_id = auth.uid() and cm.role in ('admin','moderator')))
    or (visibility='global' and status='approved')
    or (visibility='global' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  );
create policy "hikes_insert_own" on hikes for insert to authenticated with check (auth.uid() = user_id);
-- Approvals are updates (status pending -> approved), so update policies are
-- REQUIRED — without them RLS silently blocks every approve with 0 rows updated.
create policy "hikes_update_comm_admin_mod" on hikes for update to authenticated
  using (
    visibility='community' and exists (select 1 from community_members cm where cm.community_id = hikes.community_id and cm.user_id = auth.uid() and cm.role in ('admin','moderator'))
  );
create policy "hikes_update_app_admin" on hikes for update to authenticated
  using (
    visibility='global' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "hikes_update_own" on hikes for update to authenticated using (auth.uid() = user_id);
-- Rejection deletes the row, so approvers need delete too, not just the owner.
create policy "hikes_delete_own" on hikes for delete to authenticated using (auth.uid() = user_id);
create policy "hikes_delete_comm_admin_mod" on hikes for delete to authenticated
  using (
    visibility='community' and exists (select 1 from community_members cm where cm.community_id = hikes.community_id and cm.user_id = auth.uid() and cm.role in ('admin','moderator'))
  );
create policy "hikes_delete_app_admin" on hikes for delete to authenticated
  using (
    visibility='global' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
```
