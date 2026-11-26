-- Idempotent SP-Survey Supabase setup. Safe to re-run.
-- Covers responses, recoverable submit (one response per recruitment-platform id),
-- quota, condition counts, balanced sampling, pair stats, image features,
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project TEXT := p_response->>'project_id';
  v_participant TEXT := p_response->>'participant_id';
  v_code TEXT := p_response->'survey_metadata'->>'completion_code';
  v_platform TEXT := p_response->'survey_metadata'->'recruitment'->>'platform';
  v_recruit_id TEXT := p_response->'survey_metadata'->'recruitment'->>'id';
  v_existing public.survey_responses%ROWTYPE;
  v_id TEXT;
BEGIN
  IF COALESCE(v_project, '') = '' OR COALESCE(v_participant, '') = '' OR COALESCE(v_code, '') = ''
    OR length(v_project) > 256 OR length(v_participant) > 256 OR length(v_code) > 256
    OR jsonb_typeof(p_response->'responses') IS DISTINCT FROM 'object'
    OR octet_length(p_response::text) > 10485760 THEN
    RAISE EXCEPTION 'Invalid submission';
  END IF;
  -- A database transaction serializes uncertain concurrent retries, even for anonymous callers.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_project || '/' || v_participant || '/' || v_code, 0));
  SELECT * INTO v_existing FROM public.survey_responses
    WHERE project_id=v_project AND participant_id=v_participant
      AND survey_metadata->>'completion_code'=v_code LIMIT 1;
  IF FOUND THEN
    IF v_existing.responses IS DISTINCT FROM p_response->'responses' THEN
      RAISE EXCEPTION 'Submission key already belongs to different answers';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id::text, 'deduped', true);
  END IF;
  -- One response per recruitment-platform participant (researcher practice runs are exempt).
  IF COALESCE(v_platform, '') <> '' AND COALESCE(v_recruit_id, '') <> ''
    AND COALESCE((p_response->'survey_metadata'->>'researcher_mode')::BOOLEAN, FALSE) = FALSE THEN
    IF length(v_platform) > 32 OR length(v_recruit_id) > 128 THEN RAISE EXCEPTION 'Invalid submission'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_project || '/recruit/' || v_platform || '/' || v_recruit_id, 0));
    SELECT * INTO v_existing FROM public.survey_responses
      WHERE project_id=v_project
        AND survey_metadata ? 'recruitment'
        AND survey_metadata->'recruitment'->>'platform'=v_platform
        AND survey_metadata->'recruitment'->>'id'=v_recruit_id
        AND COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
      LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_existing.id::text, 'deduped', true, 'duplicate_recruitment', true);
    END IF;
  END IF;
  INSERT INTO public.survey_responses(project_id, participant_id, responses, displayed_images, survey_metadata)
    VALUES(v_project, v_participant, p_response->'responses', p_response->'displayed_images', p_response->'survey_metadata')
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

-- ---------------------------------------------------------------------------
-- Recruitment platforms (Prolific, CloudResearch Connect, other panels):
-- one platform participant id counts once per survey. submit_survey_response
-- above keeps the first response for a platform id; this lets the participant
-- page say "already completed" on load.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS survey_responses_recruitment_id_idx
  ON public.survey_responses (project_id, (survey_metadata->'recruitment'->>'platform'), (survey_metadata->'recruitment'->>'id'))
  WHERE survey_metadata ? 'recruitment';

CREATE OR REPLACE FUNCTION public.recruitment_participant_done(p_project_id TEXT, p_platform TEXT, p_participant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.survey_responses
    WHERE project_id = p_project_id
      AND survey_metadata ? 'recruitment'
      AND survey_metadata->'recruitment'->>'platform' = p_platform
      AND survey_metadata->'recruitment'->>'id' = p_participant
      AND COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.recruitment_participant_done(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recruitment_participant_done(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- Response counts per condition (for "balanced" condition assignment).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_condition_responses(p_project_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(c.condition, c.n), '{}'::jsonb)
  FROM (
    SELECT survey_metadata->>'condition' AS condition, COUNT(*)::INTEGER AS n
    FROM public.survey_responses
    WHERE project_id = p_project_id
      AND survey_metadata->>'condition' IS NOT NULL
      AND COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
    GROUP BY 1
  ) c;
$$;

REVOKE ALL ON FUNCTION public.count_condition_responses(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_condition_responses(TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- Balanced sampling ("Balanced" in a question's Sampling Mode). Every new
-- participant gets the smallest number nobody finished and nobody started in
-- the last 30 minutes; the browser turns it into that participant's images, so
-- every image is shown equally often. Without these functions the survey still
-- works and falls back to plain random sampling.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.balance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS balance_claims_project_n
  ON public.balance_claims (project_id, n);

-- No policies: rows are read and written only through the functions below.
ALTER TABLE public.balance_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_balance_number(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
  v_id UUID;
BEGIN
  IF p_project_id IS NULL OR p_project_id = '' OR length(p_project_id) > 256 THEN
    RAISE EXCEPTION 'unknown project';
  END IF;

  -- One at a time per project, so two people who open the link together get different numbers.
  PERFORM pg_advisory_xact_lock(hashtextextended('balance/' || p_project_id, 0));

  -- Starts that were abandoned long ago are no longer needed.
  DELETE FROM public.balance_claims
  WHERE project_id = p_project_id
    AND completed_at IS NULL
    AND claimed_at < now() - INTERVAL '1 day';

  WITH used AS (
    SELECT DISTINCT c.n
    FROM public.balance_claims c
    WHERE c.project_id = p_project_id
      AND (c.completed_at IS NOT NULL OR c.claimed_at > now() - INTERVAL '30 minutes')
  )
  SELECT g INTO v_n
  FROM generate_series(0, (SELECT COUNT(*)::INTEGER FROM used)) AS g
  WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.n = g)
  ORDER BY g
  LIMIT 1;

  INSERT INTO public.balance_claims (project_id, n)
  VALUES (p_project_id, v_n)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('n', v_n, 'claim_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_balance_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_balance_number(TEXT) TO anon, authenticated;

-- The participant finished: the number is never handed out again.
CREATE OR REPLACE FUNCTION public.complete_balance_claim(p_claim_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.balance_claims
  SET completed_at = COALESCE(completed_at, now())
  WHERE id = p_claim_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_balance_claim(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_balance_claim(UUID) TO anon, authenticated;

-- When a response is stored on the platform, mark its number as finished here in the
-- database, so it does not depend on the browser making a second call. Whatever the
-- response contains, this must never stop it from being saved: every error is swallowed.
CREATE OR REPLACE FUNCTION public.balance_claim_on_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE public.balance_claims
    SET completed_at = COALESCE(completed_at, now())
    WHERE id = (NEW.survey_metadata::JSONB->'balanced_draw'->>'claim_id')::UUID
      AND project_id = NEW.project_id::TEXT;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS balance_claim_on_response ON public.survey_responses;
CREATE TRIGGER balance_claim_on_response
  AFTER INSERT ON public.survey_responses
  FOR EACH ROW
  WHEN (NEW.survey_metadata IS NOT NULL)
  EXECUTE FUNCTION public.balance_claim_on_response();
