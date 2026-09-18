-- Optional exactly-once retries for a participant + project + completion code.
-- Apply in the researcher's own Supabase if they want recoverable-submit dedupe.
-- This does not require platform `projects` rows or hosted research_releases.
BEGIN;
CREATE OR REPLACE FUNCTION public.submit_survey_response(p_response JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    WHERE project_id=v_project AND participant_id=v_participant
      AND survey_metadata->>'completion_code'=v_code LIMIT 1;
  IF FOUND THEN
    IF v_existing.responses IS DISTINCT FROM p_response->'responses' THEN
      RAISE EXCEPTION 'Submission key already belongs to different answers';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id::text, 'deduped', true);
  END IF;
  INSERT INTO public.survey_responses(project_id, participant_id, responses, displayed_images, survey_metadata)
    VALUES(v_project, v_participant, p_response->'responses', p_response->'displayed_images', p_response->'survey_metadata')
    RETURNING id::text INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'deduped', false);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_survey_response(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_survey_response(JSONB) TO anon, authenticated;
COMMIT;
