const { createClient } = require('@supabase/supabase-js');

// Service role client — server-side only, bypasses RLS.
// This is how usage caps and gap-logging get enforced no matter what the frontend does.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verifies the request's access token and returns the user + their business membership.
// Every function should call this before doing anything else.
async function getUserAndBusiness(event) {
  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { error: 'No auth token provided' };

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) return { error: 'Invalid or expired session' };

  const { data: membership, error: memberError } = await supabaseAdmin
    .from('business_users')
    .select('business_id, role, businesses(*)')
    .eq('user_id', user.id)
    .single();

  if (memberError || !membership) return { error: 'User is not linked to a business' };

  return { user, role: membership.role, business: membership.businesses };
}

// Turns text into a vector for similarity search. Used both when saving new
// knowledge chunks and when a question comes in, so the two can be compared.
async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.data[0].embedding;
}

async function callModel(messages, system, maxTokens = 1000) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-nano',
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

module.exports = { supabaseAdmin, getUserAndBusiness, callModel, getEmbedding };
