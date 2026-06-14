// Ace's AI Weekly — news generator
// Daily top stories (global + India), weekly report, industry events, key AI
// people, a maintained AI/ML careers guide, and Ace's live GitHub repos.
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
const GITHUB_USER = "Ace-2504";

const PROFILE = {
  name: "Harman Singh Sandhu",
  handle: "Ace",
  blurb: "I build AI/ML projects and write about them. This site is one of them — an automated daily AI digest.",
  linkedin: "https://www.linkedin.com/in/harman-singh-sandhu/",
  github: "https://github.com/Ace-2504",
  devto: "https://dev.to/ace2504",
};

const FEEDS = [
  { name: "TechCrunch AI",   url: "https://techcrunch.com/category/artificial-intelligence/feed/", aiOnly: true,  region: "global" },
  { name: "The Verge AI",    url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", aiOnly: true, region: "global" },
  { name: "VentureBeat AI",  url: "https://venturebeat.com/category/ai/feed/", aiOnly: true, region: "global" },
  { name: "Ars Technica",    url: "https://feeds.arstechnica.com/arstechnica/technology-lab", aiOnly: false, region: "global" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", aiOnly: true, region: "global" },
  { name: "Hugging Face",    url: "https://huggingface.co/blog/feed.xml", aiOnly: true, region: "global" },
  { name: "Google AI Blog",  url: "https://blog.google/technology/ai/rss/", aiOnly: true, region: "global" },
  { name: "arXiv cs.AI",     url: "http://export.arxiv.org/rss/cs.AI", aiOnly: true, region: "global" },
  { name: "Analytics India Mag", url: "https://analyticsindiamag.com/feed/", aiOnly: false, region: "india" },
  { name: "Inc42",           url: "https://inc42.com/feed/", aiOnly: false, region: "india" },
  { name: "YourStory",       url: "https://yourstory.com/feed", aiOnly: false, region: "india" },
  { name: "ET Tech",         url: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms", aiOnly: false, region: "india" },
  { name: "Indian Express Tech", url: "https://indianexpress.com/section/technology/feed/", aiOnly: false, region: "india" },
];

const AI_KEYWORDS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|gpt|gemini|claude|llama|mistral|openai|anthropic|deepmind|neural|generative|model|agent|multimodal|diffusion|transformer)\b/i;
const INDIA_KEYWORDS = /\b(india|indian|bengaluru|bangalore|new delhi|mumbai|hyderabad|chennai|pune|iit|iisc|isro|reliance|jio|infosys|tcs|wipro|hcl|zoho|ola|krutrim|sarvam|meity|indiaai|digital india|upi|npci|rupee|sebi|aicte|nasscom)\b/i;

const CATEGORIES = [
  { heading: "Large Language Models", re: /\b(llm|gpt|gemini|claude|llama|mistral|model|parameter|context window|reasoning model)\b/i },
  { heading: "Multimodal & Media",    re: /\b(image|video|audio|voice|multimodal|diffusion|vision|speech|music|3d)\b/i },
  { heading: "Developer Tools & Agents", re: /\b(agent|coding|developer|api|sdk|copilot|ide|tool|framework|mcp)\b/i },
  { heading: "Open Source",           re: /\b(open[- ]?source|open[- ]?weight|apache|mit license|hugging ?face|weights released)\b/i },
  { heading: "Industry & Research",   re: /.*/ },
];

// Industry events / keynotes detector
const BIGCO_RE = /\b(apple|google|microsoft|meta|openai|nvidia|amazon|anthropic|samsung|xai|mistral)\b/i;
const EVENT_RE = /\b(wwdc|google i\/o|\bi\/o\b|build 20|dev ?day|keynote|unveils?|unveiled|announces?|announced|debuts?|launch(?:es|ed)?|re:invent|ignite|gtc|apple intelligence|io 20)\b/i;

// Key AI people — recent article if present in feed, else stable profile link
const PEOPLE = [
  { name: "Sam Altman",      org: "OpenAI",              link: "https://blog.samaltman.com",   re: /\baltman\b/i },
  { name: "Demis Hassabis",  org: "Google DeepMind",     link: "https://x.com/demishassabis",  re: /\bhassabis\b/i },
  { name: "Dario Amodei",    org: "Anthropic",           link: "https://www.darioamodei.com",  re: /\bamodei\b/i },
  { name: "Yann LeCun",      org: "Meta · world models", link: "https://x.com/ylecun",         re: /\blecun\b/i },
  { name: "Jensen Huang",    org: "NVIDIA",              link: "https://nvidianews.nvidia.com",re: /\bjensen huang\b/i },
  { name: "Andrej Karpathy", org: "AI educator",         link: "https://karpathy.ai",          re: /\bkarpathy\b/i },
  { name: "Sundar Pichai",   org: "Google",              link: "https://x.com/sundarpichai",   re: /\bpichai\b/i },
  { name: "Mira Murati",     org: "Thinking Machines",   link: "https://x.com/miramurati",     re: /\bmurati\b/i },
];

// Maintained AI/ML careers guide (helps students pick a high-demand field)
const CAREERS = {
  note: "Demand snapshot for 2026. ML Engineer is the most in-demand AI title; agentic-AI and deep-learning skills carry the highest pay premiums; Python + one cloud is the baseline. Specialisation beats generalisation for freshers.",
  paths: [
    { field: "Machine Learning Engineering", demand: "Very high", note: "#1 AI title — build, deploy & maintain models in production. Best all-round entry into AI." },
    { field: "AI / Agent Engineering (LLM apps)", demand: "Surging", note: "RAG, tool-use & multi-agent systems. ~40% of enterprise apps will embed AI agents by year-end." },
    { field: "Deep Learning / Research", demand: "High (premium pay)", note: "Neural nets for vision & speech. Highest premiums; usually needs strong maths / grad study." },
    { field: "MLOps / AI Infrastructure", demand: "High", note: "Ship & scale models on the cloud. Cloud AI certs add 20–25% to salary." },
    { field: "Data Science / Analytics", demand: "Steady", note: "Foundational, widest entry door; a reliable first step into AI." },
    { field: "Computer Vision", demand: "High", note: "Imaging, robotics, autonomous systems, medical AI." },
    { field: "NLP / LLM Engineering", demand: "Very high", note: "Powers chatbots, search & agents — the hottest application area." },
    { field: "AI Product / Solutions Architect", demand: "High (senior)", note: "5–8 yrs experience; $140k–$332k bands. Translates AI into business value." },
    { field: "AI Safety / Governance", demand: "Growing", note: "Alignment, evals, red-teaming & policy — newer but expanding fast." },
  ],
  fresher: [
    { skill: "Python (NumPy, Pandas)", why: "The lingua franca of ML — non-negotiable." },
    { skill: "Maths foundations", why: "Linear algebra, probability & calculus — enough to reason about models." },
    { skill: "Core ML (scikit-learn)", why: "Regression, classification, evaluation, the ML workflow." },
    { skill: "One deep-learning framework (PyTorch)", why: "Build & train neural nets; PyTorch dominates research & jobs." },
    { skill: "LLMs: prompting + RAG basics", why: "Ship a small LLM app — the most visible skill to recruiters now." },
    { skill: "SQL + data wrangling", why: "Real AI work is mostly data; SQL is everywhere." },
    { skill: "One cloud + Git/GitHub", why: "AWS leads (~40% of postings), then Azure & GCP. Version everything." },
    { skill: "Ship a portfolio project", why: "A deployed project that solves a real problem is the #1 differentiator." },
  ],
  experienced: [
    { skill: "MLOps & deployment", why: "Docker, CI/CD, monitoring, model/versioning — production is where value lives." },
    { skill: "Agentic system design", why: "Multi-agent orchestration, tool-use, evals — the surging frontier." },
    { skill: "Cloud AI at scale", why: "AWS/Azure/GCP architecture; certs add a 20–25% salary premium." },
    { skill: "LLM fine-tuning & evals", why: "Adapt, measure and harden models for a domain." },
    { skill: "Distributed training / GPU optimisation", why: "Cost & latency engineering for large models." },
    { skill: "ML system design", why: "Trade-offs across data, latency, cost & reliability at scale." },
    { skill: "Domain specialisation", why: "CV, NLP, recsys, healthcare — depth beats breadth at senior levels." },
    { skill: "AI → business translation", why: "Leading teams and tying models to measurable outcomes." },
  ],
};

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

async function fetchRepos(){
  try{
    const r = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=100`,
      { headers: { "User-Agent": "ai-weekly-report", "Accept": "application/vnd.github+json" } });
    if(!r.ok){ console.error("! repos " + r.status); return []; }
    const repos = await r.json();
    return (Array.isArray(repos) ? repos : [])
      .filter(x => !x.fork)
      .sort((a, b) => (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at)))
      .slice(0, 6)
      .map(x => ({ name: x.name, desc: x.description || "", url: x.html_url, stars: x.stargazers_count || 0, language: x.language || "" }));
  }catch(e){ console.error("! repos: " + e.message); return []; }
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function llmJSON(system, user){
  if(!OPENROUTER_API_KEY) return null;
  const body = JSON.stringify({ model: OPENROUTER_MODEL, temperature: 0.3,
    messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  for(let attempt = 0; attempt < 4; attempt++){
    try{
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json",
          "HTTP-Referer": REPO_URL, "X-Title": "Ace's AI Weekly" },
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
  const [feedResults, repos] = await Promise.all([ Promise.all(FEEDS.map(fetchFeed)), fetchRepos() ]);
  const all = feedResults.flat();

  let items = all.filter(x => x.aiOnly || AI_KEYWORDS.test(x.title + " " + x.snippet));
  items.forEach(x => { x.india = x.region === "india" || INDIA_KEYWORDS.test(x.title + " " + x.snippet); });

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

  const top      = await pickTop(globalDay.length ? globalDay : weekItems.slice(0, 30), "international");
  const topIndia = await pickTop(indiaDay, "India-focused");

  // weekly category sections (India reserved for its own section)
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
  if(indiaWeek.length) sections.push({ heading: "India & Subcontinent", items: indiaWeek.slice(0, 8).map(p => ({ title: p.title, url: p.url, source: p.source, summary: p.snippet })) });

  // Industry events (auto from feeds)
  const events = weekItems
    .filter(x => BIGCO_RE.test(x.title) && EVENT_RE.test(x.title + " " + x.snippet))
    .slice(0, 8)
    .map(p => ({ title: p.title, url: p.url, source: p.source, published: p.published, summary: p.snippet }));

  // Key AI people — recent article if mentioned, else stable profile link
  const people = PEOPLE.map(p => {
    const hit = weekItems.find(x => p.re.test(x.title + " " + x.snippet));
    return { name: p.name, org: p.org, link: hit ? hit.url : p.link, article: hit ? hit.title : null, source: hit ? hit.source : "Profile" };
  });

  // Dedup: keep the day's top stories out of the headlines list
  const topUrls = new Set([top?.url, topIndia?.url].filter(Boolean));
  const headlines = (globalDay.length ? globalDay : weekItems)
    .filter(h => !topUrls.has(h.url)).slice(0, 12)
    .map(h => ({ title: h.title, url: h.url, source: h.source, published: h.published }));

  const today = iso(now).slice(0, 10);
  const weekStart = iso(daysAgo(6)).slice(0, 10);

  const daily = { date: today, top, topIndia, headlines, events, people };
  const weekly = {
    weekOf: `${weekStart} to ${today}`, generated: iso(now),
    intro: `${weekItems.length} AI items this week (${indiaWeek.length} India-relevant) across ${new Set(weekItems.map(i => i.source)).size} sources.`,
    sections,
    careers: CAREERS,
    profile: { ...PROFILE, repos },
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

  console.log(`OK — ${items.length} items, ${weekItems.length} this week (${indiaWeek.length} India), ${events.length} events, ${repos.length} repos, top: ${top?.title || "none"}`);
  if(!OPENROUTER_API_KEY) console.log("(no OPENROUTER_API_KEY — newest-first + raw snippets)");
}
main().catch(e => { console.error(e); process.exit(1); });
