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
