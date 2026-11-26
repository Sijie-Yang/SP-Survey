/** Self-hosted: there is no platform database; callers that need one must pass their own. */
export async function supabaseRest() {
  throw Object.assign(new Error('Not available in the self-hosted version.'), { status: 501 });
}
