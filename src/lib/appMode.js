/**
 * Local self-hosted SP-Survey: file-based projects/templates, no user auth.
 * Supabase is used only for survey responses and media storage when configured.
 */
export const isLocalSelfHosted = () =>
  process.env.REACT_APP_LOCAL_MODE !== 'false';

export const LOCAL_USER_ID = 'local';
