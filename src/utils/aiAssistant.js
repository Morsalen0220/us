import { safeJsonParse } from '../db/database.js';

function stripMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSections(md) {
  const lines = String(md || '').split(/\r?\n/);
  const sections = [];
  let currentHeading = 'Introduction';
  let buffer = [];

  for (const line of lines) {
    const hMatch = line.match(/^#{2,3}\s+(.+)/);
    if (hMatch) {
      if (buffer.length > 0) {
        sections.push({ heading: currentHeading, text: stripMarkdown(buffer.join(' ')) });
      }
      currentHeading = hMatch[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0) {
    sections.push({ heading: currentHeading, text: stripMarkdown(buffer.join(' ')) });
  }
  return sections.filter((s) => s.text.length > 20);
}

function groundedLocalAnswer(post, question) {
  const q = String(question || '').trim().toLowerCase();
  const takeaways = safeJsonParse(post.key_takeaways_json, []);
  const sources = safeJsonParse(post.official_sources_json, []);
  const corrections = safeJsonParse(post.corrections_json, []);

  if (!q) {
    return {
      answer: 'Please ask a specific question about this article.',
      citations: [],
      mode: 'grounded-article'
    };
  }

  if (/\b(summary|summarize|tldr|tl;dr|key point|takeaway|main point|overview)\b/i.test(q)) {
    const bulletLines = takeaways.length
      ? takeaways.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : stripMarkdown(post.excerpt || post.subtitle || post.content_md).slice(0, 420);
    return {
      answer: `Based strictly on "${post.title}":\n${bulletLines}`,
      citations: [{ heading: 'Key Takeaways', snippet: takeaways[0] || post.excerpt }],
      mode: 'grounded-article'
    };
  }

  if (/\b(source|reference|official|proof|citation|link)\b/i.test(q)) {
    if (sources.length > 0) {
      const list = sources.map((s) => `• ${s.label || s.url}: ${s.url}`).join('\n');
      return {
        answer: `Official sources cited in this article:\n${list}`,
        citations: sources.map((s) => ({ heading: s.label || 'Official Source', snippet: s.url })),
        mode: 'grounded-article'
      };
    }
  }

  if (/\b(new|update|changed|latest|correction|edit)\b/i.test(q)) {
    const parts = [];
    if (post.whats_new) parts.push(`What's New: ${post.whats_new}`);
    if (corrections.length > 0) {
      parts.push(`Correction History:\n${corrections.map((c) => `• [${c.date}] ${c.note}`).join('\n')}`);
    }
    if (parts.length > 0) {
      return {
        answer: parts.join('\n\n'),
        citations: [{ heading: "Latest Updates", snippet: post.last_fact_checked || post.updated_at }],
        mode: 'grounded-article'
      };
    }
    const intro = stripMarkdown(post.excerpt || post.subtitle || post.content_md).slice(0, 360);
    return {
      answer: `Here is the latest overview covered in "${post.title}":\n${intro}`,
      citations: [{ heading: post.title, snippet: intro.slice(0, 120) }],
      mode: 'grounded-article'
    };
  }

  const stopWords = new Set(['what', 'when', 'where', 'which', 'about', 'there', 'their', 'these', 'those', 'does', 'with', 'from', 'have', 'this', 'that', 'will', 'your', 'into', 'they', 'how', 'why', 'the', 'and', 'for', 'are']);
  const tokens = q
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  const sections = splitSections(post.content_md);
  const scored = [];

  for (const sec of sections) {
    const sentences = sec.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 25);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (lower.includes(tok)) score += 2;
        if (sec.heading.toLowerCase().includes(tok)) score += 1;
      }
      if (score > 0) {
        scored.push({ score, heading: sec.heading, sentence });
      }
    }
  }

  for (const t of takeaways) {
    const lower = String(t).toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (lower.includes(tok)) score += 2;
    }
    if (score > 0) {
      scored.push({ score: score + 1, heading: 'Key Takeaways', sentence: String(t) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  if (top.length === 0) {
    const fallbackOverview = takeaways.length
      ? takeaways.slice(0, 3).map((t) => `• ${t}`).join('\n')
      : stripMarkdown(post.excerpt || post.subtitle || post.content_md).slice(0, 320);
    return {
      answer: `Here is the closest relevant context from "${post.title}":\n\n${fallbackOverview}`,
      citations: [],
      mode: 'grounded-article'
    };
  }

  const uniqueSentences = [];
  const seen = new Set();
  for (const item of top) {
    if (!seen.has(item.sentence)) {
      seen.add(item.sentence);
      uniqueSentences.push(item);
    }
  }

  return {
    answer: uniqueSentences.map((u) => u.sentence).join(' '),
    citations: uniqueSentences.map((u) => ({ heading: u.heading, snippet: u.sentence.slice(0, 140) })),
    mode: 'grounded-article'
  };
}

const AI_SYSTEM_PROMPT = [
  'You are the TechHaven US AI Article Assistant — a friendly, smart, and helpful technology assistant embedded on an article page.',
  'Grounding Balance (80% Article / 20% Outside Context):',
  '1. Base roughly 80% of your answers on the article context provided below. Always prioritize the article’s facts, steps, numbers, and takeaways first.',
  '2. Use up to ~20% general tech knowledge to fill in helpful background, explain technical terms, or answer related follow-up questions that go slightly beyond the article — naturally connecting back to the article without robotic refusals like "this article does not mention it".',
  '3. If the reader asks something completely outside the article, give a brief, helpful answer from your general knowledge (that 20% flexibility) and tie it back to what the article covers.',
  '4. Never contradict the article’s stated facts. Write in a warm, natural, conversational tone with short paragraphs or crisp bullet points.',
  '5. Reply in the same language the reader used in their question (e.g., English, Bengali, etc.).',
  '6. Keep answers well-structured and concise (typically 60–180 words unless the reader asks for deeper detail).'
].join('\n');

function buildArticleContextPrompt(post, question) {
  const takeaways = safeJsonParse(post.key_takeaways_json, []);
  const sources = safeJsonParse(post.official_sources_json, []);
  const parts = [
    `Article Title: ${post.title || ''}`,
    post.subtitle ? `Subtitle: ${post.subtitle}` : '',
    post.excerpt ? `Summary: ${post.excerpt}` : '',
    post.whats_new ? `Latest Update Note: ${post.whats_new}` : '',
    takeaways.length ? `Key Takeaways:\n- ${takeaways.join('\n- ')}` : '',
    sources.length ? `Official Sources:\n- ${sources.map((s) => `${s.label || s.url} (${s.url})`).join('\n- ')}` : '',
    `Article Content:\n${stripMarkdown(post.content_md).slice(0, 7500)}`,
    `Reader Question: ${question}`
  ].filter(Boolean);
  return parts.join('\n\n');
}

async function callGeminiGrounded(post, question, apiKey) {
  const userPrompt = buildArticleContextPrompt(post, question);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 700,
          thinkingConfig: { thinkingBudget: 0 }
        }
      }),
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return { answer: text, citations: [], mode: 'gemini-assistant' };
}

async function callOpenAIGrounded(post, question, apiKey) {
  const userPrompt = buildArticleContextPrompt(post, question);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 550,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty OpenAI response');
  return { answer: text, citations: [], mode: 'openai-assistant' };
}

export async function answerArticleQuestion(post, question, settings = {}) {
  const geminiKey = String(settings.gemini_api_key || '').trim();
  const openaiKey = String(settings.openai_api_key || '').trim();

  if (geminiKey) {
    try {
      return await callGeminiGrounded(post, question, geminiKey);
    } catch {
      // Fall back cleanly to deterministic grounded engine
    }
  }
  if (openaiKey) {
    try {
      return await callOpenAIGrounded(post, question, openaiKey);
    } catch {
      // Fall back cleanly to deterministic grounded engine
    }
  }

  return groundedLocalAnswer(post, question);
}
