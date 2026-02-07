#!/usr/bin/env bun
/**
 * Import Claude Code sessions from disk to DCM database
 * Usage: bun run scripts/import-sessions.ts [--limit N] [--project PATH]
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

const API_URL = process.env.DCM_API_URL || "http://127.0.0.1:3847";
const CLAUDE_PROJECTS = process.env.CLAUDE_PROJECTS || `${process.env.HOME}/.claude/projects`;

interface SessionLine {
  type: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  data?: unknown;
  toolName?: string;
  toolInput?: unknown;
}

interface SessionInfo {
  sessionId: string;
  projectPath: string;
  projectName: string;
  startedAt: Date;
  endedAt?: Date;
  prompts: string[];
  toolsUsed: string[];
  totalTools: number;
  totalSuccess: number;
  totalErrors: number;
}

async function findSessionFiles(basePath: string, limit?: number): Promise<string[]> {
  const files: string[] = [];

  try {
    const projectDirs = await readdir(basePath);

    for (const projectDir of projectDirs) {
      const projectPath = join(basePath, projectDir);
      const projectStat = await stat(projectPath);

      if (!projectStat.isDirectory()) continue;

      const projectFiles = await readdir(projectPath);
      for (const file of projectFiles) {
        // Only main session files (UUID format), not agent-* files
        if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
          files.push(join(projectPath, file));
          if (limit && files.length >= limit) return files;
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning ${basePath}:`, error);
  }

  return files;
}

async function parseSessionFile(filePath: string): Promise<SessionInfo | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let sessionId: string | undefined;
    let projectPath: string | undefined;
    let startedAt: Date | undefined;
    let endedAt: Date | undefined;
    const prompts: string[] = [];
    const toolsUsed = new Set<string>();
    let totalTools = 0;
    let totalSuccess = 0;
    let totalErrors = 0;

    for (const line of lines) {
      try {
        const parsed: SessionLine = JSON.parse(line);

        // Extract session info
        if (parsed.sessionId && !sessionId) {
          sessionId = parsed.sessionId;
        }
        if (parsed.cwd && !projectPath) {
          projectPath = parsed.cwd;
        }

        // Track timestamps
        if (parsed.timestamp) {
          const ts = new Date(parsed.timestamp);
          if (!startedAt || ts < startedAt) startedAt = ts;
          if (!endedAt || ts > endedAt) endedAt = ts;
        }

        // Extract user prompts
        if (parsed.type === 'user' && parsed.message?.role === 'user') {
          const content = parsed.message.content;
          if (typeof content === 'string') {
            // Skip meta/command messages
            if (!content.startsWith('<command-') && content.length < 500) {
              prompts.push(content.substring(0, 200));
            }
          } else if (Array.isArray(content)) {
            const textContent = content.find(c => c.type === 'text')?.text;
            if (textContent && !textContent.startsWith('Base directory') && textContent.length < 500) {
              prompts.push(textContent.substring(0, 200));
            }
          }
        }

        // Track tool usage
        if (parsed.type === 'tool_use' && parsed.toolName) {
          toolsUsed.add(parsed.toolName);
          totalTools++;
        }

        if (parsed.type === 'tool_result') {
          // Check if error
          const data = parsed.data as { error?: boolean };
          if (data?.error) {
            totalErrors++;
          } else {
            totalSuccess++;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!sessionId) {
      // Use filename as session ID
      sessionId = basename(filePath, '.jsonl');
    }

    // Derive project path from directory structure
    if (!projectPath) {
      const dirName = basename(dirname(filePath));
      projectPath = dirName.replace(/^-/, '/').replace(/-/g, '/');
    }

    const projectName = basename(projectPath) || 'Unknown';

    return {
      sessionId,
      projectPath: projectPath || '/unknown',
      projectName,
      startedAt: startedAt || new Date(),
      endedAt,
      prompts: prompts.slice(0, 10), // Keep first 10 prompts
      toolsUsed: Array.from(toolsUsed),
      totalTools,
      totalSuccess,
      totalErrors,
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

async function importSession(session: SessionInfo): Promise<boolean> {
  try {
    // 1. Create or get project
    const projectRes = await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: session.projectPath,
        name: session.projectName,
        metadata: { imported: true, source: 'disk-sync' }
      })
    });

    let projectId: string;
    if (projectRes.ok) {
      const project = await projectRes.json();
      projectId = project.id;
    } else {
      // Project might already exist, try to find it
      const findRes = await fetch(`${API_URL}/api/projects?path=${encodeURIComponent(session.projectPath)}`);
      if (findRes.ok) {
        const projects = await findRes.json();
        if (projects.length > 0) {
          projectId = projects[0].id;
        } else {
          console.error(`Failed to create/find project for ${session.projectPath}`);
          return false;
        }
      } else {
        return false;
      }
    }

    // 2. Create session
    const sessionRes = await fetch(`${API_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: session.sessionId,
        project_id: projectId,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString(),
        total_tools_used: session.totalTools,
        total_success: session.totalSuccess,
        total_errors: session.totalErrors,
      })
    });

    if (!sessionRes.ok && sessionRes.status !== 409) {
      // 409 = already exists, which is fine
      const err = await sessionRes.text();
      console.error(`Failed to create session ${session.sessionId}: ${err}`);
      return false;
    }

    // 3. Create a request for each user prompt
    for (const prompt of session.prompts.slice(0, 5)) {
      await fetch(`${API_URL}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          session_id: session.sessionId,
          prompt: prompt,
          prompt_type: detectPromptType(prompt),
          status: 'completed',
          metadata: { imported: true }
        })
      });
    }

    return true;
  } catch (error) {
    console.error(`Error importing session ${session.sessionId}:`, error);
    return false;
  }
}

function detectPromptType(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) return 'debug';
  if (lower.includes('add') || lower.includes('create') || lower.includes('implement')) return 'feature';
  if (lower.includes('refactor') || lower.includes('clean')) return 'refactor';
  if (lower.includes('explain') || lower.includes('what') || lower.includes('how')) return 'explain';
  if (lower.includes('search') || lower.includes('find')) return 'search';
  return 'general';
}

async function main() {
  const args = process.argv.slice(2);
  let limit: number | undefined;
  let projectFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
    if (args[i] === '--project' && args[i + 1]) {
      projectFilter = args[i + 1];
      i++;
    }
  }

  console.log(`🔍 Scanning Claude Code sessions in ${CLAUDE_PROJECTS}...`);
  const sessionFiles = await findSessionFiles(CLAUDE_PROJECTS, limit);
  console.log(`📁 Found ${sessionFiles.length} session files`);

  let imported = 0;
  let failed = 0;

  for (const file of sessionFiles) {
    if (projectFilter && !file.includes(projectFilter)) continue;

    const session = await parseSessionFile(file);
    if (!session) {
      failed++;
      continue;
    }

    const success = await importSession(session);
    if (success) {
      imported++;
      process.stdout.write(`\r✅ Imported: ${imported}/${sessionFiles.length}`);
    } else {
      failed++;
    }
  }

  console.log(`\n\n📊 Import complete:`);
  console.log(`   ✅ Successfully imported: ${imported}`);
  console.log(`   ❌ Failed: ${failed}`);
}

main().catch(console.error);
