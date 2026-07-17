# WildPath — Supabase Setup (do these two things once)

## 1. Create the database tables

1. Open https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/sql/new
2. Open the file `supabase-schema.sql` in this repo and copy its ENTIRE contents
3. Paste into the SQL editor and click **Run** (bottom right)
4. You should see "Success. No rows returned"

## 2. Create the four storage buckets

Open https://supabase.com/dashboard/project/nkrphmjzyzeplzcgndxg/storage/buckets

For EACH of these four buckets — `avatars`, `post-media`, `spot-photos`, `community-covers` — do this:

1. Click the green **New bucket** button (top right)
2. In **Name of bucket** type the bucket name exactly (e.g. `avatars`)
3. Toggle **Public bucket** ON (this lets the app display images via public URLs)
4. Click **Additional configuration** to expand it
5. Toggle **Restrict file upload size for bucket** ON and enter `10` MB
   (if the field asks for a value + unit, choose 10 and MB)
6. Click **Save** / **Create bucket**
7. Repeat for the next bucket name

After creating all four you should see: avatars, post-media, spot-photos,
community-covers — each marked PUBLIC in the bucket list.

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
