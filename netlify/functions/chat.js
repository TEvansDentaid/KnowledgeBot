const { supabaseAdmin, getUserAndBusiness, callModel, getEmbedding } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { user, business, error } = await getUserAndBusiness(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  // Enforce the message cap server-side — this is the line that actually protects your costs.
  if (business.messages_used >= business.message_limit) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Message limit reached for this period. Contact your admin.' }),
    };
  }

  const { question } = JSON.parse(event.body);
  if (!question || !question.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Question is required' }) };
  }

  // Embed the question, then pull only the chunks that are actually relevant —
  // instead of sending the whole knowledge base on every message.
  let chunks = [];
  try {
    const questionEmbedding = await getEmbedding(question);
    const { data } = await supabaseAdmin.rpc('match_knowledge_chunks', {
      target_business_id: business.id,
      query_embedding: questionEmbedding,
      match_count: 5,
    });
    chunks = data || [];
  } catch (e) {
    // If embeddings fail for any reason, fall back to the small-knowledge-base
    // behaviour rather than failing the whole chat — better a slower answer
    // than no answer.
    const { data } = await supabaseAdmin.from('knowledge_chunks').select('content').eq('business_id', business.id);
    chunks = data || [];
  }

  const knowledgeText = chunks.map((c) => c.content).join('\n\n');

  const system = `You are ${business.assistant_name}, an internal assistant for ${business.name}.
Answer questions using ONLY the knowledge below. Do not invent information.
If the knowledge doesn't cover the question, say you don't have that information yet — don't guess.

After your answer, on a new final line, add exactly one of:
CONFIDENCE: high
CONFIDENCE: low
Use "low" if you had to say you don't know, or if you're only partially sure.

Knowledge base:
${knowledgeText || '(no knowledge has been added yet)'}`;

  let raw;
  try {
    raw = await callModel([{ role: 'user', content: question }], system);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Assistant is unavailable right now' }) };
  }

  const confidenceMatch = raw.match(/CONFIDENCE:\s*(high|low)/i);
  const confidence = confidenceMatch ? confidenceMatch[1].toLowerCase() : 'high';
  const answer = raw.replace(/CONFIDENCE:\s*(high|low)/i, '').trim();

  // Log the exchange
  await supabaseAdmin.from('chat_messages').insert({
    business_id: business.id,
    user_id: user.id,
    question,
    answer,
    confidence,
  });

  // Bump usage
  await supabaseAdmin
    .from('businesses')
    .update({ messages_used: business.messages_used + 1 })
    .eq('id', business.id);

  // Low-confidence answers become knowledge gaps — dedupe loosely by matching topic text
  if (confidence === 'low') {
    const { data: existingGap } = await supabaseAdmin
      .from('knowledge_gaps')
      .select('*')
      .eq('business_id', business.id)
      .eq('source', 'usage')
      .ilike('topic', `%${question.slice(0, 30)}%`)
      .maybeSingle();

    if (existingGap) {
      await supabaseAdmin
        .from('knowledge_gaps')
        .update({ occurrence_count: existingGap.occurrence_count + 1, updated_at: new Date() })
        .eq('id', existingGap.id);
    } else {
      await supabaseAdmin.from('knowledge_gaps').insert({
        business_id: business.id,
        topic: question,
        source: 'usage',
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ answer, messagesUsed: business.messages_used + 1, messageLimit: business.message_limit }),
  };
};
