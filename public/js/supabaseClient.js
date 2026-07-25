// These two values are safe to expose in frontend code — they're the public
// anon key, not a secret. Find them in Supabase: Project Settings > API.
const SUPABASE_URL = 'https://znadibijknrrvwrqxxwn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuYWRpYmlqa25ycnZ3cnF4eHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5ODI4NzcsImV4cCI6MjEwMDU1ODg3N30.kPkmpt2f9mSZVCX9QVhC9eBTaPLQjNNuJL4cOzLm4Qo';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Redirects to login if there's no active session. Call at the top of any
// page that requires a logged-in user.
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = '/index.html';
    return null;
  }
  return session;
}

// Fetches the current user's business membership + business record.
async function getMyBusiness() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data, error } = await supabaseClient
    .from('business_users')
    .select('role, privacy_acknowledged, businesses(*)')
    .eq('user_id', user.id)
    .single();
  if (error) return null;
  return { user, role: data.role, privacyAcknowledged: data.privacy_acknowledged, business: data.businesses };
}

// Applies a business's brand colours + assistant name to the page via CSS variables.
function applyBranding(business) {
  document.documentElement.style.setProperty('--brand-primary', business.primary_color);
  document.documentElement.style.setProperty('--brand-secondary', business.secondary_color);
  document.querySelectorAll('[data-assistant-name]').forEach((el) => (el.textContent = business.assistant_name));
  document.querySelectorAll('[data-business-name]').forEach((el) => (el.textContent = business.name));
  if (business.logo_url) {
    document.querySelectorAll('[data-logo]').forEach((el) => (el.src = business.logo_url));
  }
}

// Calls one of our Netlify functions with the current session's auth token attached.
async function callFunction(name, body) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}
