const { supabaseAdmin, getUserAndBusiness } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { role: callerRole, business, error } = await getUserAndBusiness(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };
  if (callerRole !== 'owner' && callerRole !== 'developer') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only owners and developers can invite teammates' }) };
  }

  const { email, role } = JSON.parse(event.body);
  if (!email || !['user', 'developer'].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email and role are required' }) };
  }

  // This sends a real invite email via Supabase and creates the auth user immediately
  // (unconfirmed until they click the link and set a password).
  const { data, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (inviteError) return { statusCode: 400, body: JSON.stringify({ error: inviteError.message }) };

  await supabaseAdmin.from('business_users').insert({
    business_id: business.id,
    user_id: data.user.id,
    role,
  });

  return { statusCode: 200, body: JSON.stringify({ invited: email, role }) };
};
