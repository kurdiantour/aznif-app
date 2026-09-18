CREATE TABLE IF NOT EXISTS public.app_versions (
    platform TEXT PRIMARY KEY,
    latest_version TEXT NOT NULL,
    min_required_version TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- Allow read access to anyone
CREATE POLICY "Allow public read access on app_versions" 
ON public.app_versions FOR SELECT 
USING (true);

-- Insert initial values for Android and iOS
INSERT INTO public.app_versions (platform, latest_version, min_required_version)
VALUES 
    ('android', '1.1.8', '1.1.8'),
    ('ios', '1.1.8', '1.1.8')
ON CONFLICT (platform) DO NOTHING;
