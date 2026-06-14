// AI Weekly Report — news generator (India + International + Students)
// Fetches AI news from global & Indian RSS feeds, dedupes, picks a daily top
// story (global + India), composes a weekly report, and a student section.
// OpenRouter is optional: without a key it uses newest-first + raw snippets.

import Parser from "rss-parser";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "data");
const ARCHIVE = join(DATA, "archive");

// ---- Config ----------------------------------------------------------------
const REPO_URL = process.env.REPO_URL || "https://github.com/your-username/ai-weekly-report";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

// region: "global" or "india". aiOnly feeds skip keyword filtering.
const FEEDS = [
  // International
  { name: "TechCrunch AI",   url: "https://techcrunch.com/category/artificial-intelligence/feed/", aiOnly: true,  region: "global" },
  { name: "The Verge AI",    url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", aiOnly: true, region: "global" },
  { name: "VentureBeat AI",  url: "https://venturebeat.com/category/ai/feed/", aiOnly: true, region: "global" },
  { name: "Ars Technica",    url: "https://feeds.arstechnica.com/arstechnica/technology-lab", aiOnly: false, region: "global" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", aiOnly: true, region: "global" },
  { name: "Hugging Face",    url: "https://huggingface.co/blog/feed.xml", aiOnly: true, region: "global" },
  { name: "Google AI Blog",  url: "https://blog.google/technology/ai/rss/", aiOnly: true, region: "global" },
  { name: "arXiv cs.AI",     url: "http://export.arxiv.org/rss/cs.AI", aiOnly: true, region: "global" },
  // India
  { name: "Analytics India Mag", url: "https://analyticsindiamag.com/feed/", aiOnly: false, region: "india" },
  { name: "Inc42",           url: "https://inc42.com/feed/", aiOnly: false, region: "india" },
  { name: "YourStory",       url: "https://yourstory.com/feed", aiOnly: false, region: "india" },
  { name: "ET Tech",         url: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms", aiOnly: false, region: "india" },
  { name: "Indian Express Tech", url: "https://indianexpress.com/section/technology/feed/", aiOnly: false, region: "india" },
];

const AI_KEYWORDS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|gpt|gemini|claude|llama|mistral|openai|anthropic|deepmind|neural|generative|model|agent|multimodal|diffusion|transformer)\b/i;

const INDIA_KEYWORDS = /\b(india|indian|bengaluru|bangalore|new delhi|mumbai|hyderabad|chennai|pune|iit|iisc|isro|reliance|jio|infosys|tcs|wipro|hcl|zoho|ola|krutrim|sarvam|meity|indiaai|digital india|upi|npci|rupee|sebi|aicte|nasscom)\b/i;

const STUDENT_KEYWORDS = /\b(student|students|course|courses|learn|learning|tutorial|scholarship|internship|intern|hackathon|certification|certificate|curriculum|campus|university|college|education|free tier|exam|fellowship|bootcamp)\b/i;

const CATEGORIES = [
  { heading: "Large Language Models", re: /\b(llm|gpt|gemini|claude|llama|mistral|model|parameter|context window|reasoning model)\b/i },
  { heading: "Multimodal & Media",    re: /\b(image|video|audio|voice|multimodal|diffusion|vision|speech|music|3d)\b/i },
  { heading: "Developer Tools & Agents", re: /\b(agent|coding|developer|api|sdk|copilot|ide|tool|framework|mcp)\b/i },
  { heading: "Open Source",           re: /\b(open[- ]?source|open[- ]?weight|apache|mit license|hugging ?face|weights released)\b/i },
  { heading: "Industry & Research",   re: /.*/ },
];

// Evergreen, hand-verified free learning resources for students.
const STUDENT_RESOURCES = [
  { name: "Kaggle Learn", desc: "Free hands-on micro-courses (Python, ML, deep learning).", url: "https://www.kaggle.com/learn", tag: "Global" },
  { name: "fast.ai — Practical Deep Learning", desc: "Free, project-first deep-learning course.", url: "https://course.fast.ai", tag: "Global" },
  { name: "DeepLearning.AI Short Courses", desc: "Free short courses on LLMs, RAG, agents.", url: "https://www.deeplearning.ai/short-courses/", tag: "Global" },
  { name: "Hugging Face Learn", desc: "Free NLP, LLM, and agents courses with notebooks.", url: "https://huggingface.co/learn", tag: "Global" },
  { name: "Karpathy — Neural Nets: Zero to Hero", desc: "Free video series building models from scratch.", url: "https://karpathy.ai/zero-to-hero.html", tag: "Global" },
  { name: "Google Colab", desc: "Free cloud notebooks with GPU/TPU for experiments.", url: "https://colab.research.google.com", tag: "Tools" },
  { name: "GitHub Student Developer Pack", desc: "Free dev tools & cloud credits for verified students.", url: "https://education.github.com/pack", tag: "Tools" },
  { name: "NPTEL / SWAYAM", desc: "Free IIT/IISc online courses incl. AI & ML (India).", url: "https://nptel.ac.in", tag: "India" },
  { name: "IIT Madras BS — Data Science & Apps", desc: "Online degree; foundational level open to all (India).", url: "https://study.iitm.ac.in", tag: "India" },
  { name: "IndiaAI (Govt of India)", desc: "National AI portal: datasets, programmes, skilling.", url: "https://indiaai.gov.in", tag: "India" },
];

// ---- Helpers ---------------------------------------------------------------
const parser = new Parser({ timeout: 20000, headers: { "User-Agent": "ai-weekly-report/1.0" } });
const now = new Date();
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const daysAgo = (n) => new Date(now.getTime() - n * DAY);
const cleanTitle = (t) => (t || "").replace(/\s+/g, " ").trim();
function snippet(it){
  let s = it.contentSnippet || it.summary || it.content || "";
  s = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 280 ? s.slice(0, 277) + "…" : s;
}

async function fetchFeed(feed){
  try{
    const f = await parser.parseURL(feed.url);
    return (f.items || []).map(it => ({
      title: cleanTitle(it.title), url: it.link, source: feed.name,
      aiOnly: feed.aiOnly, region: feed.region,
      published: it.isoDate || it.pubDate || null, snippet: snippet(it),
    })).filter(x => x.title && x.url);
  }catch(e){ console.error(`! feed failed: ${feed.name} — ${e.message}`); return []; }
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Calls OpenRouter; retries on 429 (free-tier rate limit) / 5xx with backoff.
async function llmJSON(system, user){
  if(!OPENROUTER_API_KEY) return null;
  const body = JSON.stringify({ model: OPENROUTER_MODEL, temperature: 0.3,
    messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  for(let attempt = 0; attempt < 4; attempt++){
    try{
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json",
          "HTTP-Referer": REPO_URL, "X-Title": "AI Weekly Report" },
        body,
      });
      if(r.status === 429 || r.status >= 500){
        const waitMs = 5000 * (attempt + 1);
        console.error(`! OpenRouter ${r.status} — retry ${attempt + 1}/4 in ${waitMs / 1000}s`);
        await sleep(waitMs);
        continue;
      }
      if(!r.ok){ console.error("! OpenRouter " + r.status); return null; }
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || "";
      const m = txt.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : txt);
    }catch(e){ console.error("! LLM error: " + e.message); await sleep(3000); }
  }
  console.error("! OpenRouter — gave up after retries, using fallback");
  return null;
}

async function pickTop(pool, label){
  if(!pool.length) return null;
  const llm = await llmJSON(
    `You are an AI news editor. From the ${label} stories, pick the single most important and summarize it in 2 plain factual sentences. No marketing words. JSON: {"index": <number>, "summary": "..."}.`,
    pool.map((h, i) => `${i}: ${h.title} — ${h.source}`).join("\n"));
  if(llm && pool[llm.index]){
    const h = pool[llm.index];
    return { title: h.title, url: h.url, source: h.source, published: h.published, summary: llm.summary || h.snippet };
  }
  const h = pool[0];
  return { title: h.title, url: h.url, source: h.source, published: h.published, summary: h.snippet };
}

// ---- Main ------------------------------------------------------------------
async function main(){
  mkdirSync(ARCHIVE, { recursive: true });
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();

  // AI filter (general feeds) + tag India relevance
  let items = all.filter(x => x.aiOnly || AI_KEYWORDS.test(x.title + " " + x.snippet));
  items.forEach(x => { x.india = x.region === "india" || INDIA_KEYWORDS.test(x.title + " " + x.snippet); });

  // dedupe
  const seen = new Set();
  items = items.filter(x => {
    const k = x.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if(seen.has(k)) return false; seen.add(k); return true;
  });
  items.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

  const weekItems = items.filter(x => x.published && new Date(x.published) >= daysAgo(7));
  const dayItems  = items.filter(x => x.published && new Date(x.published) >= daysAgo(2));

  const globalDay = (dayItems.length ? dayItems : weekItems).filter(x => !x.india).slice(0, 30);
  const indiaDay  = (dayItems.length ? dayItems : weekItems).filter(x =>  x.india).slice(0, 30);

  const top      = await pickTop(globalDay.length ? globalDay : weekItems.slice(0,30), "international");
  const topIndia = await pickTop(indiaDay, "India-focused");

  // weekly sections (global categories) — India items reserved for their own section
  const used = new Set();
  const indiaWeek = weekItems.filter(x => x.india);
  const sections = [];
  for(const cat of CATEGORIES){
    const picks = [];
    for(const it of weekItems){
      if(picks.length >= 6) break;
      if(used.has(it.url) || it.india) continue;
      if(cat.re.test(it.title + " " + it.snippet)){ picks.push(it); used.add(it.url); }
    }
    if(picks.length) sections.push({ heading: cat.heading, items: picks.map(p => ({ title: p.title, url: p.url, source: p.source, summary: p.snippet })) });
  }
  // India section
  if(indiaWeek.length) sections.push({ heading: "India & Subcontinent", items: indiaWeek.slice(0, 8).map(p => ({ title: p.title, url: p.url, source: p.source, summary: p.snippet })) });

  // student news (filtered) + curated resources
  const studentNews = weekItems.filter(x => STUDENT_KEYWORDS.test(x.title + " " + x.snippet))
    .slice(0, 6).map(p => ({ title: p.title, url: p.url, source: p.source, published: p.published }));

  const today = iso(now).slice(0, 10);
  const weekStart = iso(daysAgo(6)).slice(0, 10);

  const daily = {
    date: today, top, topIndia,
    headlines: (globalDay.length ? globalDay : weekItems).slice(0, 12).map(h => ({ title: h.title, url: h.url, source: h.source, published: h.published })),
  };
  const weekly = {
    weekOf: `${weekStart} to ${today}`, generated: iso(now),
    intro: `${weekItems.length} AI items this week (${indiaWeek.length} India-relevant) across ${new Set(weekItems.map(i=>i.source)).size} sources.`,
    sections,
    student: { resources: STUDENT_RESOURCES, news: studentNews },
  };

  const archiveDates = existsSync(ARCHIVE)
    ? readdirSync(ARCHIVE).filter(f => f.endsWith(".json")).map(f => f.replace(".json", "")) : [];
  if(!archiveDates.includes(today)) archiveDates.push(today);
  const index = {
    daysTracked: archiveDates.length, itemsThisWeek: weekItems.length,
    indiaThisWeek: indiaWeek.length, sourcesTracked: FEEDS.length,
    lastUpdate: iso(now), repoUrl: REPO_URL,
    archive: archiveDates.sort().reverse().slice(0, 60),
  };

  writeFileSync(join(DATA, "daily.json"), JSON.stringify(daily, null, 2));
  writeFileSync(join(DATA, "weekly.json"), JSON.stringify(weekly, null, 2));
  writeFileSync(join(DATA, "index.json"), JSON.stringify(index, null, 2));
  writeFileSync(join(ARCHIVE, `${today}.json`), JSON.stringify({ daily, weekly }, null, 2));

  console.log(`OK — ${items.length} items, ${weekItems.length} this week (${indiaWeek.length} India), top: ${top?.title || "none"} | India top: ${topIndia?.title || "none"}`);
  if(!OPENROUTER_API_KEY) console.log("(no OPENROUTER_API_KEY — newest-first + raw snippets)");
}
main().catch(e => { console.error(e); process.exit(1); });
