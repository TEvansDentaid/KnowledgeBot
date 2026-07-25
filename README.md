# Bert Platform — setup guide

This is the whole app: Supabase for auth/database/storage, Netlify for hosting
and serverless functions, Anthropic's API for the assistant itself.

## 1. Create a Supabase project

1. Go to supabase.com, create a new project (free tier is fine to start).
2. Open the SQL Editor and run everything in `supabase/schema.sql`.
3. Go to Storage, create a new bucket called `logos`, and set it to public.
4. Go to Authentication > Providers and make sure Email is enabled.
5. Go to Authentication > Settings and, for testing, you can turn off "Confirm
   email" so new signups work instantly. Turn it back on before real clients
   use this.
6. Go to Project Settings > API and copy three values, you'll need them next:
   - Project URL
   - `anon` public key
   - `service_role` key (keep this one secret — never put it in frontend code)

## 2. Get your OpenAI API key

The whole platform runs on OpenAI now — both the chat/interview logic and
the embeddings used for search — so this is the only model provider key
you need. Go to platform.openai.com, add a payment method under Billing,
then create a key under API keys. Cost here is small: the model in use
(`gpt-5.4-nano`) is OpenAI's cheapest current tier.

## 3. Fill in the frontend config

Open `public/js/supabaseClient.js` and replace:
- `YOUR_SUPABASE_URL` with your Project URL
- `YOUR_SUPABASE_ANON_KEY` with your anon public key

## 4. Deploy to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify, "Add new site" > "Import an existing project" > pick the repo.
3. Build settings: it'll pick up `netlify.toml` automatically.
4. Before deploying, go to Site settings > Environment variables and add:
   - `SUPABASE_URL` — same Project URL as above
   - `SUPABASE_SERVICE_ROLE_KEY` — the service_role key (this stays server-side only)
   - `OPENAI_API_KEY` — your OpenAI key from step 2
5. Deploy.

## 5. Try it end to end

1. Visit your live site, sign up as a new business (this makes you the owner).
2. Go through the setup wizard — logo, colour, assistant name, message limit.
3. Go to the dashboard, click "Continue the interview" and answer a few
   questions — check knowledge_chunks in Supabase to see facts appearing.
4. Run the coverage check from the dashboard — check knowledge_gaps for
   flagged categories.
5. Open the chat page and ask something the interview covered, and something
   it doesn't — confirm the second one shows up as a usage gap.

## What's deliberately simple in this v1 (fine for a free trial, worth
## revisiting before charging real customers)

- **File upload** only reliably handles .txt/.md. Adding PDF/Word support
  later just means extracting text before it reaches `process-file.js` —
  nothing else needs to change.
- **Knowledge retrieval** uses embeddings + similarity search (via `pgvector`)
  so only the most relevant handful of chunks go into each chat call, rather
  than the whole knowledge base. If it ever can't reach OpenAI's embeddings
  API, it quietly falls back to sending everything rather than failing the
  chat outright.
- **Invites** use Supabase's built-in invite email — functional, but the
  wording of that email isn't customised to Bert yet.
- **Gap deduplication** is a simple text-matching check, not semantic — two
  differently-worded questions about the same topic might create two gaps
  instead of one. Worth revisiting once you see real usage patterns.
- **No paywall yet** — message caps are enforced, but there's no billing.
  See the earlier conversation for how to add Stripe on top of this without
  restructuring anything.

## File map

```
supabase/schema.sql       — run once in Supabase's SQL editor
netlify/functions/        — all server-side logic (chat, interview, gaps, invites, files)
public/                   — the actual site (login, wizard, dashboard, chat, interview)
```
