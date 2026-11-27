# Security

## Reporting a vulnerability

Please report it privately: on this repository open **Security → Report a vulnerability** (GitHub private vulnerability reporting). Describe what you found and how to reproduce it. Please do not open a public issue with the details, and do not send links to third-party dashboards that need a login.

We aim to reply within a week.

## What matters most in a self-hosted setup

- The Supabase `service_role` key must stay on the researcher's computer. It is never committed and never deployed; the participant site gets only the project URL and the anon key.
- Model API keys are stored locally in `data/`, which Git ignores. The local agent API never returns credentials.
- The local editor and its API (ports 3000 and 3001) are meant for your own machine. Do not expose them to the internet.
