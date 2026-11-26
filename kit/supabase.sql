-- SP-Survey Kit: everything a self-hosted study needs in YOUR Supabase project.
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
--
-- 1. survey_responses: one row per participant. Anyone with the page's anon key may
--    INSERT (through submit_survey_response); nobody but you (service role) can read.
-- 2. Balanced draws: each new participant claims a number (the smallest one nobody
--    finished and nobody started in the last 30 minutes). sp-site.js turns the number
--    into that person's images, so every image is shown equally often.
-- Same tables and functions as the full SP-Survey app (supabase/setup.sql) and the
-- hosted platform, so data stays compatible.

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

-- ---------- balanced draws ----------
CREATE TABLE IF NOT EXISTS public.balance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS balance_claims_project_n ON public.balance_claims (project_id, n);
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
  IF COALESCE(p_project_id, '') = '' OR length(p_project_id) > 256 THEN
    RAISE EXCEPTION 'unknown project';
  END IF;
  -- One at a time per project, so two people who open the link together get different numbers.
  PERFORM pg_advisory_xact_lock(hashtextextended('balance/' || p_project_id, 0));
  DELETE FROM public.balance_claims
  WHERE project_id = p_project_id AND completed_at IS NULL AND claimed_at < now() - INTERVAL '1 day';
  WITH used AS (
    SELECT DISTINCT c.n FROM public.balance_claims c
    WHERE c.project_id = p_project_id
      AND (c.completed_at IS NOT NULL OR c.claimed_at > now() - INTERVAL '30 minutes')
  )
  SELECT g INTO v_n
  FROM generate_series(0, (SELECT COUNT(*)::INTEGER FROM used)) AS g
  WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.n = g)
  ORDER BY g
  LIMIT 1;
  INSERT INTO public.balance_claims (project_id, n) VALUES (p_project_id, v_n) RETURNING id INTO v_id;
  RETURN jsonb_build_object('n', v_n, 'claim_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_balance_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_balance_number(TEXT) TO anon, authenticated;

-- A stored response marks its number as finished, so it is never handed out again.
-- Whatever the response contains, this never stops it from being saved.
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
