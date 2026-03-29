/**
 * Dynamic catalog scanner — discovers agents, skills, and commands
 * from the user's ~/.claude/ directory at runtime.
 *
 * Replaces the old 1787-line static catalog with a filesystem scan.
 * Results are cached for 60s to avoid excessive I/O.
 * @module data/catalog
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createLogger } from "../lib/logger";

const log = createLogger("Catalog");

const HOME = process.env.HOME || "/home/" + (process.env.USER || "user");
const CLAUDE_DIR = join(HOME, ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const PLUGINS_CACHE_DIR = join(CLAUDE_DIR, "plugins", "cache");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const AGENTS_DIR = join(CLAUDE_DIR, "agents");

// ============================================
// Types
// ============================================

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  source: "user" | "plugin";
  plugin?: string;
}

export type CatalogAgent = CatalogItem & { tools: string[] };
export type CatalogSkill = CatalogItem;
export type CatalogCommand = CatalogItem;

// ============================================
// Cache
// ============================================

let cachedSkills: CatalogSkill[] = [];
let cachedAgents: CatalogAgent[] = [];
let cachedCommands: CatalogCommand[] = [];
let lastScanAt = 0;
const CACHE_TTL_MS = 60_000;

// ============================================
// Parsing helpers
// ============================================

function parseYamlFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Handle multi-line description with >
    if (value === ">" || value === "|") value = "";
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (key && value) result[key] = value;
  }
  return result;
}

function extractDescriptionFromMd(content: string): string {
  // Try frontmatter first
  const fm = parseYamlFrontmatter(content);
  if (fm.description) return fm.description.slice(0, 200);

  // Fallback: first non-heading paragraph
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    return trimmed.slice(0, 200);
  }
  return "";
}

function categorizeSkill(id: string, desc: string): string {
  const lo = id.toLowerCase();
  const text = `${lo} ${desc}`.toLowerCase();

  // --- Specific ID-based matches first (high confidence) ---

  // Science & biotech (match ID patterns, not desc — avoids false positives)
  if (/^(bio|chem|med|health|clinical|pharma|pdb|uniprot|ensembl|pubmed|rdkit|scanpy|anndata|esm|alphafold|gwas|flowio|histolab|pydicom|neurokit|neuropixels|omero|scvi|cellxgene|deepchem|datamol|brenda|opentargets|clinvar|cosmic|hmdb|drugbank|metabolomics|biorxiv|gget|pysam|pydeseq|arboreto|diffdock|clinpgx|ena-database|gene-database|string-database|zinc-database|pathml|pyopenms|dentaire|integrative-medicine|wellness|claude-ally-health|nutritional|treatment-plan|scientific-brainstorming|scientific-writing|scientific-visualization|scientific-schematics|scientific-critical|pufferlib|adaptyv|benchling|latchbio|protocolsio|opentrons|labarchive|fluidsim|cobrapy|etetoolkit|scikit-bio|bioservices|pytdc|pymatgen|astropy|qiskit|cirq|qutip|pennylane|simpy)/.test(lo)) return "science";

  // Automation platforms (by ID)
  if (/-(automation|automate)$|^automate-|^zapier|^n8n-|^make-automation/.test(lo)) return "automation";

  // Marketing & SEO (by ID)
  if (/^seo-|^marketing-|^content-market|^email-(marketing|campaign|drafter|sequence)|^social-(media|content)|^cold-email|^copywriting|^ad-creative|^brand-(identity|analyzer|guidelines)|^competitive-(ads|landscape)|^lead-(magnet|research)|^product-strategist|^sales-(automat|enablement)|^executing-marketing|^programmatic-seo|^geo-fundamentals/.test(lo)) return "marketing";

  // Mobile
  if (/^flutter-|^react-native|^expo-|^mobile-|^ios-developer|^swiftui|^vercel-react-native/.test(lo)) return "mobile";

  // PHP / Laravel / WordPress
  if (/^laravel|^php-|^wordpress|^backend-laravel/.test(lo)) return "php";

  // Python
  if (/^python-|^django|^fastapi|^flask|polars|^dask$|^vaex$|^statsmodels$|^sympy$|^matplotlib$|^seaborn$|^plotly$|^scikit-learn$|^pymoo$|^geopandas$|^instructor$|^outlines$|^pydantic|^pymc|^hypothesis-generation/.test(lo)) return "python";

  // TypeScript / Node / NestJS
  if (/^typescript-|^nestjs|^nodejs|^bun-|^zustand|^prisma|^drizzle|^bullmq|^inngest|^trigger-dev|^upstash/.test(lo)) return "typescript";

  // Frontend / React / Next / Vue / Angular
  if (/^react-(?!native)|^next(?:js)?-|^vue-|^svelte-|^angular|^frontend-|^tailwind-|^shadcn|^radix-ui|^core-web-vitals|^responsive-design|^web-component|^senior-frontend|^scroll-experience/.test(lo)) return "frontend";

  // UI/UX Design (strict — only actual design skills)
  if (/^ui-|^ux-|^design-system|^figma|^interaction-design|^visual-design|^design-to-code|^cli-ui-designer|^ui-ux-pro|^material-design|^designer-ui|^design-orchestration|^frontend-design$/.test(lo)) return "design";

  // Database
  if (/^database-|^sql-|^postgres|^mysql|^mongo|^redis|^clickhouse|^neon-|^supabase|^data-engineer$|^senior-data-engineer|^nosql|^event-store|^dbt-/.test(lo)) return "database";

  // DevOps / Infra / Cloud / Deploy
  if (/^docker-|^kubernetes|^devops|^deploy|^ci-|^cicd|^terraform|^cloud-|^railway-|^vercel-deploy|^netlify|^cloudflare|^render-deploy|^gitops|^helm|^istio|^linkerd|^service-mesh|^hybrid-cloud|^k8s-|^prometheus|^grafana|^observability|^monitoring|^incident-|^on-call|^slo-|^cost-optim|^server-management|^senior-devops|^lambda-|^gcp-|^aws-|^azure-(?!devops)/.test(lo)) return "devops";

  // Security
  if (/^security-|^vulnerability|^owasp|^pentest|^penetration|^exploit|^malware|^red-team|^ethical-hacking|^metasploit|^burp-suite|^shodan|^wireshark|^ffuf|^sqlmap|^privilege-escalation|^active-directory|^binary-analysis|^anti-reversing|^memory-forensics|^firmware-analyst|^mtls|^pci-compliance|^api-security|^mobile-security|^backend-security|^frontend-security|^idor-|^file-path-traversal|^cross-site|^html-injection|^broken-auth|^sql-injection|^network-101|^ssh-penetration|^smtp-penetration|^wordpress-penetration|^cloud-penetration|^linux-privilege|^windows-privilege/.test(lo)) return "security";

  // AI / ML / LLM
  if (/^ai-|^ml-|^llm-|^rag-|^embedding|^training|^fine-tun|^agent-|^langchain|^langgraph|^langsmith|^dspy$|^crewai|^autogpt|^claude-agent|^computer-use|^computer-vision|^model-(compression|merging|evaluation)|^nemo-|^openrlhf|^grpo-|^verl-|^simpo|^gguf|^speculative|^long-context|^constitutional|^prompt-(creator|engineer)|^sparse-autoencoder|^pyvene|^nnsight|^hypogenic|^llamaindex|^llamaguard|^llava$|^clip$|^whisper$|^blip|^rwkv|^mamba|^nanogpt|^implementing-llms|^evaluating-(code|llms)|^hugging|^transformers$|^sentence-transformers|^stable-(baselines|diffusion)|^audiocraft|^sentencepiece|^segment-anything|^sglang$|^pytorch|^torch-|^weights-and-biases|^mlflow$|^tensorboard$|^skypilot|^modal$|^modal-serverless|^openrouter|^openai-docs|^gemini-api|^claude-api$|^voice-ai|^speech$|^sora$|^imagegen$|^generate-image|^denario|^biomni|^torchforge|^nowait-reasoning/.test(lo)) return "ai";

  // Testing / QA
  if (/^test-|^tdd-|^e2e-|^playwright$|^playwright-|^qa-|^senior-qa|^smart-test|^outside-in-test|^bats-test/.test(lo)) return "testing";

  // Documentation / Writing
  if (/^doc-|^docs-|^readme$|^changelog-|^documentation-|^technical-writer|^crafting-effective|^writing-clearly|^humanizer$|^beautiful-prose|^wiki-|^codebase-document|^code-documentation|^api-document|^reference-builder|^research-paper|^session-handoff|^meeting-(synthesizer|insights)|^daily-(meeting|news)|^content-research/.test(lo)) return "documentation";

  // Workflow / Git / Code quality
  if (/^git-|^commit$|^create-pr|^fix-pr|^merge$|^review-code|^code-review|^clean-code|^refactor$|^reducing-entropy|^lint-and-validate|^fix-(errors|grammar)|^production-code|^quality-audit|^tech-debt|^sharp-edges|^find-bugs|^debug|^parallel-(debugging|feature)|^workflow-|^default-workflow|^apex$|^oneshot$|^multitask$|^plan-writing|^create-plan|^gepetto|^session-(replay|learning)|^context-management$|^coding-standards|^skill-(creator|judge|developer|installer|workflow|creation)|^hook-creator|^create-(hooks|slash-commands|subagents|agent)|^command-creator|^plugin-forge|^meta-|^loki-mode|^brainstorm|^ultrathink|^behavioral-modes|^block[r]un|^conductor-|^implementer|^step-orchestrator|^orchestrate$|^parallel-workers|^action$/.test(lo)) return "workflow";

  // Business / Finance / Legal / HR
  if (/^business-|^finance-|^legal-|^hr-|^contract-|^invoice|^billing|^payment-|^stripe-|^paypal|^plaid|^startup-|^product-manager|^agile-|^scrum|^backlog|^roadmap|^work-delegator|^pm-architect|^quant-analyst|^risk-(manager|metrics|management)|^backtesting|^data-analyst$|^data-scientist$|^senior-data-scientist|^business-analytics|^market-(sizing|research)|^micro-saas|^app-store-optim|^domain-name/.test(lo)) return "business";

  // Game development
  if (/^game-|^unity-|^godot-|^unreal-|^minecraft/.test(lo)) return "gamedev";

  // Communication / Collaboration
  if (/^slack-|^discord-|^telegram-|^whatsapp-|^teams-|^zoom-|^calendly-|^professional-communication|^feedback-mastery|^difficult-workplace|^team-(communication|collaboration)|^daily-meeting|^standup/.test(lo)) return "communication";

  // Low-code / No-code / Integrations
  if (/^shopify-|^hubspot-|^salesforce-|^notion-|^airtable-|^jira$|^linear$|^trello-|^asana-|^monday-|^clickup-|^wrike-|^basecamp-|^todoist-|^freshdesk-|^freshservice-|^zendesk-|^intercom-|^pagerduty-|^sentry-|^datadog-|^confluence-|^bamboohr-|^zoho-|^coda-|^webflow-|^miro-|^canva-|^box-|^dropbox-|^google-(drive|calendar|sheets)|^one-drive|^outlook-|^instagram-|^tiktok-|^youtube-|^twitter-|^reddit-|^linkedin-|^convertkit-|^mailchimp-|^sendgrid-|^postmark-|^brevo-|^activecampaign-|^klaviyo-|^amplitude-|^segment-|^close-|^cal-com|^circleci-|^gitlab-|^bitbucket-|^github-(automation|workflow|issue)|^vercel-automation|^square-|^docusign-|^work-iq$|^connect$|^connect-apps$/.test(lo)) return "integrations";

  // Rust / Go / C / C++ / Java / C# / other languages
  if (/^rust-|^golang|^go-|^c-pro$|^cpp-|^java-pro$|^csharp-|^ruby-|^elixir-|^haskell-|^julia-|^scala-|^posix-shell|^bash-pro|^powershell|^php-pro$|^dotnet-/.test(lo)) return "languages";

  // Blockchain / Web3
  if (/^blockchain|^solidity|^web3|^nft-|^defi-/.test(lo)) return "blockchain";

  // --- Fallback desc-based (only for truly unclassifiable) ---
  if (/\bkubernetes\b|\bdocker\b|\bci.cd\b|\bcloud\b/.test(text)) return "devops";
  if (/\bllm\b|\bmachine learning\b|\bneural\b|\bfine.tun/.test(text)) return "ai";
  if (/\bsecurity\b|\bvulnerabilit/.test(text)) return "security";

  return "general";
}

// ============================================
// Directory scanning
// ============================================

async function safeLs(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function scanUserSkills(): Promise<CatalogSkill[]> {
  const entries = await safeLs(SKILLS_DIR);
  const results: CatalogSkill[] = [];

  for (const entry of entries) {
    const skillDir = join(SKILLS_DIR, entry);
    const skillFile = join(skillDir, "SKILL.md");
    const content = await safeReadFile(skillFile);

    const fm = parseYamlFrontmatter(content);
    const name = fm.name || entry;
    const description = fm.description || extractDescriptionFromMd(content) || entry;

    results.push({
      id: entry,
      name,
      description: description.slice(0, 200),
      category: categorizeSkill(entry, description),
      source: "user",
    });
  }

  return results;
}

async function scanPluginSkills(): Promise<CatalogSkill[]> {
  const results: CatalogSkill[] = [];
  const publishers = await safeLs(PLUGINS_CACHE_DIR);

  for (const publisher of publishers) {
    const publisherDir = join(PLUGINS_CACHE_DIR, publisher);
    const plugins = await safeLs(publisherDir);

    for (const plugin of plugins) {
      const pluginDir = join(publisherDir, plugin);
      const versions = await safeLs(pluginDir);

      for (const version of versions) {
        const skillsDir = join(pluginDir, version, "skills");
        const skillEntries = await safeLs(skillsDir);

        for (const skillEntry of skillEntries) {
          const skillFile = join(skillsDir, skillEntry, "SKILL.md");
          const content = await safeReadFile(skillFile);
          if (!content) continue;

          const fm = parseYamlFrontmatter(content);
          const name = fm.name || skillEntry;
          const description = fm.description || extractDescriptionFromMd(content) || skillEntry;
          const qualifiedId = `${plugin}:${skillEntry}`;

          // Avoid duplicates (multiple versions)
          if (!results.some(r => r.id === qualifiedId)) {
            results.push({
              id: qualifiedId,
              name,
              description: description.slice(0, 200),
              category: categorizeSkill(skillEntry, description),
              source: "plugin",
              plugin: `${publisher}/${plugin}`,
            });
          }
        }
      }
    }
  }

  return results;
}

async function scanCommands(): Promise<CatalogCommand[]> {
  const results: CatalogCommand[] = [];

  async function scanDir(dir: string, prefix: string) {
    const entries = await safeLs(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry.endsWith(".md")) {
        const content = await safeReadFile(fullPath);
        const fm = parseYamlFrontmatter(content);
        const id = prefix ? `${prefix}:${entry.replace(/\.md$/, "")}` : entry.replace(/\.md$/, "");
        results.push({
          id,
          name: fm.name || id,
          description: (fm.description || extractDescriptionFromMd(content) || id).slice(0, 200),
          category: "command",
          source: "user",
        });
      } else {
        // Recurse into subdirectories
        try {
          const stat = await import("node:fs/promises").then(m => m.stat(fullPath));
          if (stat.isDirectory()) await scanDir(fullPath, prefix ? `${prefix}/${entry}` : entry);
        } catch { /* not a directory */ }
      }
    }
  }

  await scanDir(COMMANDS_DIR, "");
  return results;
}

async function scanAgents(): Promise<CatalogAgent[]> {
  const entries = await safeLs(AGENTS_DIR);
  const results: CatalogAgent[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const content = await safeReadFile(join(AGENTS_DIR, entry));
    const fm = parseYamlFrontmatter(content);
    const id = entry.replace(/\.md$/, "");

    results.push({
      id,
      name: fm.name || id,
      description: (fm.description || extractDescriptionFromMd(content) || id).slice(0, 200),
      category: categorizeSkill(id, fm.description || ""),
      source: "user",
      tools: [],
    });
  }

  return results;
}

// ============================================
// Public API
// ============================================

export async function scanCatalog(): Promise<{
  skills: CatalogSkill[];
  agents: CatalogAgent[];
  commands: CatalogCommand[];
}> {
  const now = Date.now();
  if (now - lastScanAt < CACHE_TTL_MS && cachedSkills.length > 0) {
    return { skills: cachedSkills, agents: cachedAgents, commands: cachedCommands };
  }

  log.info("Scanning skills catalog...");
  const t0 = Date.now();

  const [userSkills, pluginSkills, cmds, agts] = await Promise.all([
    scanUserSkills(),
    scanPluginSkills(),
    scanCommands(),
    scanAgents(),
  ]);

  cachedSkills = [...userSkills, ...pluginSkills];
  cachedCommands = cmds;
  cachedAgents = agts;
  lastScanAt = now;

  log.info(`Catalog scanned: ${cachedSkills.length} skills, ${cachedAgents.length} agents, ${cachedCommands.length} commands in ${Date.now() - t0}ms`);

  return { skills: cachedSkills, agents: cachedAgents, commands: cachedCommands };
}

// Legacy exports for backward compatibility
export const agents: CatalogAgent[] = [];
export const skills: CatalogSkill[] = [];
export const commands: CatalogCommand[] = [];
