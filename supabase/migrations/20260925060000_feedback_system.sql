-- 1. Create table
CREATE TABLE public.feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message text NOT NULL CHECK (char_length(trim(message)) > 0),
    image_paths text[] DEFAULT '{}'::text[] CHECK (
        array_length(image_paths, 1) IS NULL
        OR array_length(image_paths, 1) <= 3
    ),
    status text NOT NULL DEFAULT 'new',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS for table
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON TABLE public.feedback TO authenticated;

CREATE POLICY "Users can insert their own feedback"
    ON public.feedback FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- 3. Storage Bucket
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'feedback_images',
    'feedback_images',
    false, -- Private bucket
    5242880, -- 5MB limit
    '{image/jpeg, image/png, image/webp}'::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = '{image/jpeg, image/png, image/webp}'::text[];

-- 4. Storage Policies
-- Enforce ownership via folder name matching auth.uid()
CREATE POLICY "Users can upload their own feedback images"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'feedback_images'
        AND (string_to_array(name, '/'))[1] = auth.uid()::text
    );

-- Allow users to delete their own images
-- (needed for client-side cleanup on DB failure)
CREATE POLICY "Users can delete their own feedback images"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'feedback_images'
        AND (string_to_array(name, '/'))[1] = auth.uid()::text
    );