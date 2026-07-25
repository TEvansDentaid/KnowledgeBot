const { supabaseAdmin, getUserAndBusiness, callModel, getEmbedding } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { user, business, error } = await getUserAndBusiness(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  const { sessionId, userMessage } = JSON.parse(event.body);

  // Load or create the interview session
  let session;
  if (sessionId) {
    const { data } = await supabaseAdmin.from('interview_sessions').select('*').eq('id', sessionId).single();
    session = data;
  } else {
    const { data } = await supabaseAdmin
      .from('interview_sessions')
      .insert({ business_id: business.id, user_id: user.id, messages: [] })
      .select()
      .single();
    session = data;
  }

  const history = session.messages || [];
  if (userMessage) history.push({ role: 'user', content: userMessage });

  const system = `You are ${business.assistant_name}, interviewing a team member at ${business.name} to build up
your knowledge base about how the company works day-to-day. Ask one clear, specific question at a time about
their role, responsibilities, processes, and anything customers/colleagues commonly ask. Be conversational,
not a form. Follow up on vague answers; move on once something is clear.

Respond ONLY with valid JSON, no other text, in this exact shape:
{"reply": "your next message to the person", "learned_facts": ["fact 1", "fact 2"]}

learned_facts should be an array of standalone, clearly-written facts extracted from what they just said —
written so they make sense on their own, out of context (e.g. "New patient bookings are made by calling
reception directly, not online"). Leave it empty if nothing new and concrete was learned yet.`;

  let raw;
  try {
    raw = await callModel(history.length ? history : [{ role: 'user', content: "Let's begin." }], system);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Assistant is unavailable right now' }) };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    parsed = { reply: raw, learned_facts: [] };
  }

  history.push({ role: 'assistant', content: parsed.reply });

  await supabaseAdmin
    .from('interview_sessions')
    .update({ messages: history, updated_at: new Date() })
    .eq('id', session.id);

  if (parsed.learned_facts && parsed.learned_facts.length) {
    const rows = await Promise.all(
      parsed.learned_facts.map(async (fact) => ({
        business_id: business.id,
        content: fact,
        source: 'interview',
        source_detail: `From ${user.email}'s interview`,
        created_by: user.id,
        embedding: await getEmbedding(fact),
      }))
    );
    await supabaseAdmin.from('knowledge_chunks').insert(rows);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sessionId: session.id, reply: parsed.reply, factsLearned: parsed.learned_facts?.length || 0 }),
  };
};
