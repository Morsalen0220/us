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
        citations: [{ heading: "Updates & Fact-Check Log", snippet: post.last_fact_checked || post.updated_at }],
        mode: 'grounded-article'
      };
    }
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
    return {
      answer: `This article ("${post.title}") does not appear to contain specific details answering "${question}". Please check the Key Takeaways or Official Sources sections for verified coverage.`,
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

async function callGeminiGrounded(post, question, apiKey) {
  const prompt = [
    'You are the TechHaven US Article Assistant. Answer the reader question STRICTLY using only facts inside the article context below.',
    'If the answer is not in the article, clearly state that the article does not mention it. Keep the answer concise (max 120 words).',
    `Title: ${post.title}`,
    `Subtitle: ${post.subtitle}`,
    `What's New: ${post.whats_new}`,
    `Key Takeaways: ${post.key_takeaways_json}`,
    `Article Body:\n${stripMarkdown(post.content_md).slice(0, 6000)}`,
    `Reader Question: ${question}`
  ].join('\n\n');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 320 }
      }),
      signal: AbortSignal.timeout(12000)
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return { answer: text, citations: [{ heading: post.title, snippet: 'Verified Gemini grounded answer' }], mode: 'gemini-grounded' };
}

async function callOpenAIGrounded(post, question, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 260,
      messages: [
        {
          role: 'system',
          content: 'You are the TechHaven US Article Assistant. Answer strictly using the provided article text. Never invent facts outside the article.'
        },
        {
          role: 'user',
          content: `Title: ${post.title}\nTakeaways: ${post.key_takeaways_json}\nWhat's New: ${post.whats_new}\nArticle:\n${stripMarkdown(post.content_md).slice(0, 6000)}\n\nQuestion: ${question}`
        }
      ]
    }),
    signal: AbortSignal.timeout(9000)
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty OpenAI response');
  return { answer: text, citations: [{ heading: post.title, snippet: 'Verified OpenAI grounded answer' }], mode: 'openai-grounded' };
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
