const { supabaseAdmin, getUserAndBusiness, getEmbedding } = require('./_shared');

// v1 note: this expects plain text already extracted on the frontend (works well
// for .txt/.md). PDF and Word support can be added later with libraries like
// pdf-parse or mammoth — this function doesn't need to change, just what feeds it.

function chunkText(text, size = 800) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { user, role, business, error } = await getUserAndBusiness(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };
  if (role === 'user') return { statusCode: 403, body: JSON.stringify({ error: 'Only owners and developers can add files' }) };

  const { filename, text } = JSON.parse(event.body);
  if (!text || !text.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No text content received' }) };
  }

  const chunks = await Promise.all(
    chunkText(text).map(async (content) => ({
      business_id: business.id,
      content,
      source: 'file',
      source_detail: filename || 'uploaded file',
      created_by: user.id,
      embedding: await getEmbedding(content),
    }))
  );

  await supabaseAdmin.from('knowledge_chunks').insert(chunks);

  return { statusCode: 200, body: JSON.stringify({ chunksAdded: chunks.length }) };
};
