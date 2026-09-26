-- Idempotent SP-Survey Supabase setup. Safe to re-run.
-- Covers responses, recoverable submit, quota, pair stats, image features,
-- and a public survey-images bucket. Drafts and releases stay in local JSON.

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id BIGSERIAL PRIMARY KEY,
  participant_id TEXT NOT NULL,
  project_id TEXT,
  responses JSONB NOT NULL,
  displayed_images JSONB,
  survey_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_created_at
  ON public.survey_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_responses_participant_id
  ON public.survey_responses(participant_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_project_id
  ON public.survey_responses(project_id);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous inserts to survey_responses" ON public.survey_responses;
CREATE POLICY "Allow anonymous inserts to survey_responses"
  ON public.survey_responses
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

GRANT INSERT ON TABLE public.survey_responses TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.survey_responses_id_seq TO anon, authenticated;

DROP POLICY IF EXISTS "Allow public read survey_responses" ON public.survey_responses;
REVOKE SELECT ON TABLE public.survey_responses FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_responses(p_project_id TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) FROM public.survey_responses
  WHERE project_id = p_project_id;
$$;
REVOKE ALL ON FUNCTION public.count_responses(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_responses(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_pair_stats(p_project_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      displayed_images,
      COUNT(*) AS n
    FROM public.survey_responses
    WHERE project_id = p_project_id
    GROUP BY displayed_images
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_pair_stats(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pair_stats(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_survey_response(p_response JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project TEXT := p_response->>'project_id';
  v_participant TEXT := p_response->>'participant_id';
  v_code TEXT := p_response->'survey_metadata'->>'completion_code';
  v_existing public.survey_responses%ROWTYPE;
  v_id TEXT;
BEGIN
  IF COALESCE(v_project, '') = '' OR COALESCE(v_participant, '') = '' OR COALESCE(v_code, '') = ''
    OR length(v_project) > 256 OR length(v_participant) > 256 OR length(v_code) > 256
    OR jsonb_typeof(p_response->'responses') IS DISTINCT FROM 'object'
    OR octet_length(p_response::text) > 10485760 THEN
    RAISE EXCEPTION 'Invalid submission';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_project || '/' || v_participant || '/' || v_code, 0));
  SELECT * INTO v_existing FROM public.survey_responses
    WHERE project_id = v_project AND participant_id = v_participant
      AND survey_metadata->>'completion_code' = v_code
    LIMIT 1;
  IF FOUND THEN
    IF v_existing.responses IS DISTINCT FROM p_response->'responses' THEN
      RAISE EXCEPTION 'Submission key already belongs to different answers';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id::text, 'deduped', true);
  END IF;
  INSERT INTO public.survey_responses(project_id, participant_id, responses, displayed_images, survey_metadata)
    VALUES (
      v_project,
      v_participant,
      p_response->'responses',
      p_response->'displayed_images',
      p_response->'survey_metadata'
    )
    RETURNING id::text INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'deduped', false);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_survey_response(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_survey_response(JSONB) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.image_features (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT,
  image_id TEXT,
  image_url TEXT,
  features JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_features_project_image
  ON public.image_features(project_id, image_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('survey-images', 'survey-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read survey-images" ON storage.objects;
CREATE POLICY "Public read survey-images"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'survey-images');

DROP POLICY IF EXISTS "Service role write survey-images" ON storage.objects;
CREATE POLICY "Service role write survey-images"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'survey-images')
  WITH CHECK (bucket_id = 'survey-images');
