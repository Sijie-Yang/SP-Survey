# Shared with SP-Survey-Platform

`translate.mjs`, `resultsAiAnalysis.mjs`, `spSchemeFetchPage.mjs` (and their
`.test.mjs`) are byte-for-byte copies of `worker-lib/agent/*` in
SP-Survey-Platform. Copy them again when the platform changes them; do not edit
them here.

The other files are the self-hosted side those copies import: the model key
and route come from the local credential store (`data/agent-credentials.json`,
set in AI & Integrations) instead of the platform's Supabase tables, and calls
go through `aiClient.js`. Nothing here is metered or sent anywhere except the
model provider the researcher configured.

Run the tests with `npm run test:server`.
