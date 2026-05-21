/**
 * ai/knowledge-base.js
 * Crawls a company URL, extracts text content, and stores it as a
 * knowledge base that the AI uses to answer only company-specific questions.
 */

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

const KB_FILE = path.join(__dirname, '../data/knowledge-base.json');

/**
 * Fetches plain text content from a URL using Node's http/https.
 * Handles SSL cert issues and redirects.
 */
function fetchPage(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      rejectUnauthorized: false, // Handle self-signed / expired certs
    };
    const req = lib.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchPage(redirectUrl).then(resolve);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(15000, () => { req.destroy(); resolve(''); });
  });
}

/**
 * Strips HTML tags and extracts clean text.
 * Also extracts meta description and title for JS-rendered sites.
 */
function extractText(html) {
  // Extract meta description (useful for SPAs)
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
  const ogDesc   = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
  const title    = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // Combine meta info + body text
  const combined = [title, metaDesc, ogDesc, bodyText].filter(Boolean).join(' ');
  return combined;
}

/**
 * Extracts internal links from HTML for crawling.
 */
function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const matches = html.matchAll(/href=["']([^"']+)["']/gi);
  for (const match of matches) {
    try {
      const url = new URL(match[1], baseUrl);
      // Only follow same-domain links
      if (url.hostname === base.hostname && url.pathname !== base.pathname) {
        // Skip non-content pages
        const skip = ['.pdf','.jpg','.png','.gif','.svg','.css','.js','.zip','.xml'];
        if (!skip.some(ext => url.pathname.endsWith(ext))) {
          links.add(url.href.split('#')[0]); // Remove anchors
        }
      }
    } catch {}
  }
  return [...links].slice(0, 20); // Max 20 internal pages
}

/**
 * Splits text into chunks for the knowledge base.
 */
function chunkText(text, chunkSize = 500) {
  const words = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) chunks.push(chunk.trim());
  }
  return chunks;
}

/**
 * Crawls a company URL and builds a knowledge base.
 * Saves to data/knowledge-base.json.
 *
 * @param {string} companyUrl - The company website URL
 * @param {string} companyName - Company name for context
 * @returns {{ chunks: string[], pageCount: number }}
 */
async function buildKnowledgeBase(companyUrl, companyName) {
  console.log(`[KB] Crawling ${companyUrl}...`);

  const visited = new Set();
  const allChunks = [];
  const queue = [companyUrl];

  while (queue.length > 0 && visited.size < 10) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[KB] Fetching: ${url}`);
    const html = await fetchPage(url);
    if (!html) continue;

    const text = extractText(html);
    if (text.length > 100) {
      const chunks = chunkText(text);
      allChunks.push(...chunks.map(c => ({ url, text: c })));
    }

    // Add internal links to queue (only from homepage)
    if (visited.size === 1) {
      const links = extractLinks(html, url);
      queue.push(...links.filter(l => !visited.has(l)));
    }
  }

  // Save knowledge base
  const kb = {
    company_name: companyName,
    company_url:  companyUrl,
    built_at:     new Date().toISOString(),
    page_count:   visited.size,
    chunk_count:  allChunks.length,
    chunks:       allChunks,
  };

  fs.mkdirSync(path.dirname(KB_FILE), { recursive: true });
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2));

  console.log(`[KB] Built: ${allChunks.length} chunks from ${visited.size} pages`);
  return { chunks: allChunks, pageCount: visited.size };
}

/**
 * Loads the knowledge base from disk.
 */
function loadKnowledgeBase() {
  if (!fs.existsSync(KB_FILE)) return null;
  return JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
}

/**
 * Searches the knowledge base for relevant chunks using simple keyword matching.
 * Returns top N most relevant chunks.
 */
function searchKB(query, topN = 5) {
  const kb = loadKnowledgeBase();
  if (!kb) return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = kb.chunks.map(chunk => {
    const text = chunk.text.toLowerCase();
    const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    return { ...chunk, score };
  });

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(c => c.text);
}

module.exports = { buildKnowledgeBase, loadKnowledgeBase, searchKB, addManualText, buildKnowledgeBaseToFile, loadKnowledgeBaseForEmail, addManualTextToFile, sanitizeEmailForKB };

/**
 * Adds manually entered text to the knowledge base.
 * Useful when the website is a JS SPA that can't be crawled.
 */
function addManualText(text, companyName) {
  const kb = loadKnowledgeBase() || {
    company_name: companyName,
    company_url:  '',
    built_at:     new Date().toISOString(),
    page_count:   0,
    chunk_count:  0,
    chunks:       [],
  };

  const newChunks = chunkText(text).map(c => ({ url: 'manual', text: c }));
  kb.chunks = [...kb.chunks, ...newChunks];
  kb.chunk_count = kb.chunks.length;
  kb.built_at = new Date().toISOString();

  fs.mkdirSync(path.dirname(KB_FILE), { recursive: true });
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2));

  return { chunks: kb.chunks, pageCount: kb.page_count };
}

/**
 * Sanitizes an email address for use as a filename.
 */
function sanitizeEmailForKB(email) {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

/**
 * Returns the per-customer KB file path.
 */
function customerKBFilePath(email) {
  return path.join(__dirname, '../data/customers', sanitizeEmailForKB(email) + '-kb.json');
}

/**
 * Loads the per-customer knowledge base from disk.
 * Falls back to global KB if not found.
 */
function loadKnowledgeBaseForEmail(email) {
  const kbPath = customerKBFilePath(email);
  if (fs.existsSync(kbPath)) {
    return JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  }
  return loadKnowledgeBase();
}

/**
 * Crawls a company URL and builds a per-customer knowledge base.
 * Saves to data/customers/[email]-kb.json.
 */
async function buildKnowledgeBaseToFile(companyUrl, companyName, email) {
  console.log(`[KB] Crawling ${companyUrl} for ${email}...`);

  const visited = new Set();
  const allChunks = [];
  const queue = [companyUrl];

  while (queue.length > 0 && visited.size < 10) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[KB] Fetching: ${url}`);
    const html = await fetchPage(url);
    if (!html) continue;

    const text = extractText(html);
    if (text.length > 100) {
      const chunks = chunkText(text);
      allChunks.push(...chunks.map(c => ({ url, text: c })));
    }

    if (visited.size === 1) {
      const links = extractLinks(html, url);
      queue.push(...links.filter(l => !visited.has(l)));
    }
  }

  // Preserve existing manual chunks (url === 'manual') so they survive re-crawls
  const kbPath = customerKBFilePath(email);
  let manualChunks = [];
  if (fs.existsSync(kbPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
      manualChunks = (existing.chunks || []).filter(c => c.url === 'manual');
    } catch {}
  }

  const combinedChunks = [...allChunks, ...manualChunks];

  const kb = {
    company_name: companyName,
    company_url:  companyUrl,
    built_at:     new Date().toISOString(),
    page_count:   visited.size,
    chunk_count:  combinedChunks.length,
    chunks:       combinedChunks,
  };

  fs.mkdirSync(path.dirname(kbPath), { recursive: true });
  fs.writeFileSync(kbPath, JSON.stringify(kb, null, 2));

  console.log(`[KB] Built for ${email}: ${allChunks.length} web chunks + ${manualChunks.length} manual chunks = ${combinedChunks.length} total`);
  return { chunks: combinedChunks, pageCount: visited.size };
}

/**
 * Adds manually entered text to a per-customer knowledge base.
 */
function addManualTextToFile(text, companyName, email) {
  const kbPath = customerKBFilePath(email);
  const kb = fs.existsSync(kbPath)
    ? JSON.parse(fs.readFileSync(kbPath, 'utf8'))
    : {
        company_name: companyName,
        company_url:  '',
        built_at:     new Date().toISOString(),
        page_count:   0,
        chunk_count:  0,
        chunks:       [],
      };

  const newChunks = chunkText(text).map(c => ({ url: 'manual', text: c }));
  kb.chunks = [...kb.chunks, ...newChunks];
  kb.chunk_count = kb.chunks.length;
  kb.built_at = new Date().toISOString();

  fs.mkdirSync(path.dirname(kbPath), { recursive: true });
  fs.writeFileSync(kbPath, JSON.stringify(kb, null, 2));

  return { chunks: kb.chunks, pageCount: kb.page_count };
}
