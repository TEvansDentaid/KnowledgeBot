const { supabaseAdmin, getUserAndBusiness, callModel } = require('./_shared');

const STANDARD_CATEGORIES = [
  'pricing',
  'hours or availability',
  'services or products offered',
  'policies (cancellations, returns, etc.)',
  'contact or support information',
  'frequently asked questions',
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { business, error } = await getUserAndBusiness(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  const { data: chunks } = await supabaseAdmin
    .from('knowledge_chunks')
    .select('content')
    .eq('business_id', business.id);

  const knowledgeText = (chunks || []).map((c) => c.content).join('\n\n');

  const system = `Review the knowledge base below for a business called ${business.name}.
For each category in this list, decide if it's adequately covered: ${STANDARD_CATEGORIES.join(', ')}.

Respond ONLY with valid JSON, no other text:
{"categories": [{"name": "pricing", "covered": true}, ...]}

Knowledge base:
${knowledgeText || '(empty)'}`;

  let raw;
  try {
    raw = await callModel([{ role: 'user', content: 'Run the coverage check.' }], system);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Coverage check failed' }) };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not parse coverage check result' }) };
  }

  const missing = (parsed.categories || []).filter((c) => !c.covered);

  for (const category of missing) {
    const { data: existing } = await supabaseAdmin
      .from('knowledge_gaps')
      .select('id')
      .eq('business_id', business.id)
      .eq('source', 'upfront')
      .ilike('topic', `%${category.name}%`)
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin.from('knowledge_gaps').insert({
        business_id: business.id,
        topic: `No information found on ${category.name}`,
        source: 'upfront',
      });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ categories: parsed.categories }) };
};
