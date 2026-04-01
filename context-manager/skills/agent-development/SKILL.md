---
name: Agent Development
description: This skill should be used when the user asks to "create an agent", "add an agent", "write a subagent", "agent frontmatter", "when to use description", "agent examples", "agent tools", "agent colors", "autonomous agent", "evaluate agent", "test agent", "benchmark agent", "agent reliability", "build agent tool", "tool schema", "MCP tool", "tool validation", "tool error handling", or needs guidance on agent structure, system prompts, triggering conditions, tool design, evaluation, or agent development best practices for Claude Code plugins.
version: 0.2.0
---

# Agent Development for Claude Code Plugins

## Overview

Agents are autonomous subprocesses that handle complex, multi-step tasks independently. This skill covers the full lifecycle: **structure & creation**, **tool design**, and **evaluation & testing**.

**Key concepts:**
- Agents are FOR autonomous work, commands are FOR user-initiated actions
- Markdown file format with YAML frontmatter
- Triggering via description field with examples
- System prompt defines agent behavior
- Model and color customization
- Tools are the interface between LLMs and the world — schema and description matter more than implementation
- Evaluation requires statistical rigor, not single-run pass/fail

---

## Part 1: Agent File Structure & Creation

### Complete Format

```markdown
---
name: agent-identifier
description: Use this agent when [triggering conditions]. Examples:

<example>
Context: [Situation description]
user: "[User request]"
assistant: "[How assistant should respond and use this agent]"
<commentary>
[Why this agent should be triggered]
</commentary>
</example>

<example>
[Additional example...]
</example>

model: inherit
color: blue
tools: ["Read", "Write", "Grep"]
---

You are [agent role description]...

**Your Core Responsibilities:**
1. [Responsibility 1]
2. [Responsibility 2]

**Analysis Process:**
[Step-by-step workflow]

**Output Format:**
[What to return]
```

## Frontmatter Fields

### name (required)

Agent identifier used for namespacing and invocation.

**Format:** lowercase, numbers, hyphens only
**Length:** 3-50 characters
**Pattern:** Must start and end with alphanumeric

**Good examples:**
- `code-reviewer`
- `test-generator`
- `api-docs-writer`
- `security-analyzer`

**Bad examples:**
- `helper` (too generic)
- `-agent-` (starts/ends with hyphen)
- `my_agent` (underscores not allowed)
- `ag` (too short, < 3 chars)

### description (required)

Defines when Claude should trigger this agent. **This is the most critical field.**

**Must include:**
1. Triggering conditions ("Use this agent when...")
2. Multiple `<example>` blocks showing usage
3. Context, user request, and assistant response in each example
4. `<commentary>` explaining why agent triggers

**Format:**
```
Use this agent when [conditions]. Examples:

<example>
Context: [Scenario description]
user: "[What user says]"
assistant: "[How Claude should respond]"
<commentary>
[Why this agent is appropriate]
</commentary>
</example>

[More examples...]
```

**Best practices:**
- Include 2-4 concrete examples
- Show proactive and reactive triggering
- Cover different phrasings of same intent
- Explain reasoning in commentary
- Be specific about when NOT to use the agent

### model (required)

Which model the agent should use.

**Options:**
- `inherit` - Use same model as parent (recommended)
- `sonnet` - Claude Sonnet (balanced)
- `opus` - Claude Opus (most capable, expensive)
- `haiku` - Claude Haiku (fast, cheap)

**Recommendation:** Use `inherit` unless agent needs specific model capabilities.

### color (required)

Visual identifier for agent in UI.

**Options:** `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`

**Guidelines:**
- Choose distinct colors for different agents in same plugin
- Use consistent colors for similar agent types
- Blue/cyan: Analysis, review
- Green: Success-oriented tasks
- Yellow: Caution, validation
- Red: Critical, security
- Magenta: Creative, generation

### tools (optional)

Restrict agent to specific tools.

**Format:** Array of tool names

```yaml
tools: ["Read", "Write", "Grep", "Bash"]
```

**Default:** If omitted, agent has access to all tools

**Best practice:** Limit tools to minimum needed (principle of least privilege)

**Common tool sets:**
- Read-only analysis: `["Read", "Grep", "Glob"]`
- Code generation: `["Read", "Write", "Grep"]`
- Testing: `["Read", "Bash", "Grep"]`
- Full access: Omit field or use `["*"]`

## System Prompt Design

The markdown body becomes the agent's system prompt. Write in second person, addressing the agent directly.

### Structure

**Standard template:**
```markdown
You are [role] specializing in [domain].

**Your Core Responsibilities:**
1. [Primary responsibility]
2. [Secondary responsibility]
3. [Additional responsibilities...]

**Analysis Process:**
1. [Step one]
2. [Step two]
3. [Step three]
[...]

**Quality Standards:**
- [Standard 1]
- [Standard 2]

**Output Format:**
Provide results in this format:
- [What to include]
- [How to structure]

**Edge Cases:**
Handle these situations:
- [Edge case 1]: [How to handle]
- [Edge case 2]: [How to handle]
```

### Best Practices

**DO:**
- Write in second person ("You are...", "You will...")
- Be specific about responsibilities
- Provide step-by-step process
- Define output format
- Include quality standards
- Address edge cases
- Keep under 10,000 characters

**DON'T:**
- Write in first person ("I am...", "I will...")
- Be vague or generic
- Omit process steps
- Leave output format undefined
- Skip quality guidance
- Ignore error cases

## Creating Agents

### Method 1: AI-Assisted Generation

Use this prompt pattern:

```
Create an agent configuration based on this request: "[YOUR DESCRIPTION]"

Requirements:
1. Extract core intent and responsibilities
2. Design expert persona for the domain
3. Create comprehensive system prompt with:
   - Clear behavioral boundaries
   - Specific methodologies
   - Edge case handling
   - Output format
4. Create identifier (lowercase, hyphens, 3-50 chars)
5. Write description with triggering conditions
6. Include 2-3 <example> blocks showing when to use

Return JSON with:
{
  "identifier": "agent-name",
  "whenToUse": "Use this agent when... Examples: <example>...</example>",
  "systemPrompt": "You are..."
}
```

### Method 2: Manual Creation

1. Choose agent identifier (3-50 chars, lowercase, hyphens)
2. Write description with examples
3. Select model (usually `inherit`)
4. Choose color for visual identification
5. Define tools (if restricting access)
6. Write system prompt with structure above
7. Save as `agents/agent-name.md`

## Validation Rules

### Identifier Validation

```
Valid: code-reviewer, test-gen, api-analyzer-v2
Invalid: ag (too short), -start (starts with hyphen), my_agent (underscore)
```

**Rules:**
- 3-50 characters
- Lowercase letters, numbers, hyphens only
- Must start and end with alphanumeric
- No underscores, spaces, or special characters

### Description Validation

**Length:** 10-5,000 characters
**Must include:** Triggering conditions and examples
**Best:** 200-1,000 characters with 2-4 examples

### System Prompt Validation

**Length:** 20-10,000 characters
**Best:** 500-3,000 characters
**Structure:** Clear responsibilities, process, output format

## Agent Organization

### Plugin Agents Directory

```
plugin-name/
└── agents/
    ├── analyzer.md
    ├── reviewer.md
    └── generator.md
```

All `.md` files in `agents/` are auto-discovered.

### Namespacing

Agents are namespaced automatically:
- Single plugin: `agent-name`
- With subdirectories: `plugin:subdir:agent-name`

## Testing Agents

### Test Triggering

1. Write agent with specific triggering examples
2. Use similar phrasing to examples in test
3. Check Claude loads the agent
4. Verify agent provides expected functionality

### Test System Prompt

1. Give agent typical task
2. Check it follows process steps
3. Verify output format is correct
4. Test edge cases mentioned in prompt
5. Confirm quality standards are met

---

## Part 2: Agent Tool Design

The LLM never sees your code. It only sees the schema and description. A perfectly implemented tool with a vague description will fail. A simple tool with crystal-clear documentation will succeed.

### Tool Schema Design

Create clear, unambiguous JSON Schema for tools:

```json
{
  "name": "search_database",
  "description": "Search the internal knowledge base for documents matching a query. Returns up to 10 results sorted by relevance.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language search query"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results (1-50, default 10)"
      }
    },
    "required": ["query"]
  }
}
```

### Tool Description Best Practices

- **Be specific**: "Search for GitHub issues by label and state" NOT "Search GitHub"
- **State inputs/outputs**: "Takes a city name, returns temperature in Fahrenheit"
- **Mention limitations**: "Only works for US zip codes"
- **Include examples in description** when helpful for the LLM

### Tool with Input Examples

Use examples to guide LLM tool usage:

```json
{
  "name": "format_date",
  "description": "Convert date strings. Examples: '2024-01-15' -> 'January 15, 2024', 'Jan 15' -> '2024-01-15'"
}
```

### Tool Error Handling

Return errors that help the LLM recover, not generic failures:

```python
# BAD: Silent failure
def search(query):
    results = db.search(query)
    return results or []

# GOOD: Informative error
def search(query):
    if not query.strip():
        return {"error": "Query is empty. Provide a search term."}
    results = db.search(query)
    if not results:
        return {"error": f"No results for '{query}'. Try broader terms or check spelling."}
    return {"results": results, "count": len(results)}
```

### Tool Design Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Vague descriptions | LLM picks wrong tool or sends wrong args | Be explicit about purpose, inputs, outputs |
| Silent failures | LLM doesn't know something went wrong | Always return structured error messages |
| Too many tools | LLM confused by choice overload | Group related operations, max 10-15 tools |
| Missing required fields | LLM omits critical arguments | Mark required fields, provide defaults for optional |

### MCP (Model Context Protocol) Tools

For building MCP-compatible tools:

```python
from fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def get_weather(city: str) -> str:
    """Get current weather for a city. Returns temperature and conditions."""
    return f"72F, sunny in {city}"
```

**MCP best practices:**
- One server per domain (database, email, calendar)
- Clear tool names matching the action verb pattern (`get_`, `create_`, `update_`, `delete_`)
- Typed parameters with descriptions
- Structured error responses

---

## Part 3: Agent Evaluation & Testing

Evaluating LLM agents is fundamentally different from testing traditional software -- the same input can produce different outputs, and "correct" often has no single answer.

### Statistical Test Evaluation

Run tests multiple times and analyze result distributions:

```python
def evaluate_agent(agent, test_cases, runs_per_case=5):
    results = {}
    for case in test_cases:
        case_results = []
        for _ in range(runs_per_case):
            output = agent.run(case["input"])
            score = evaluate_output(output, case["expected"])
            case_results.append(score)
        results[case["id"]] = {
            "mean": statistics.mean(case_results),
            "std": statistics.stdev(case_results),
            "min": min(case_results),
            "max": max(case_results),
            "pass_rate": sum(1 for r in case_results if r >= 0.8) / len(case_results)
        }
    return results
```

### Behavioral Contract Testing

Define and test agent behavioral invariants:

- **Format contracts**: Output always matches expected schema
- **Safety contracts**: Never produces harmful content
- **Consistency contracts**: Same intent produces semantically similar outputs
- **Boundary contracts**: Handles edge cases gracefully

### Adversarial Testing

Actively try to break agent behavior:

- Inject contradictory instructions
- Provide malformed inputs
- Test with ambiguous requests
- Attempt prompt injection

### Evaluation Metrics

| Metric | Description | Target |
|---|---|---|
| Task completion rate | Successful vs failed tasks | > 85% |
| Hallucination rate | Factual errors per response | < 5% |
| Tool selection accuracy | Correct tool for the task | > 90% |
| Format compliance | Matches expected output structure | > 95% |
| Recovery rate | Recovers from errors autonomously | > 70% |

### Sharp Edges in Agent Evaluation

| Issue | Severity | Solution |
|---|---|---|
| Agent scores well on benchmarks but fails in production | high | Bridge benchmark and production evaluation with real-world test cases |
| Same test passes sometimes, fails other times | high | Use statistical evaluation (N runs per test, analyze distribution) |
| Agent optimized for metric, not actual task | medium | Multi-dimensional evaluation to prevent gaming |
| Test data accidentally used in training or prompts | critical | Strict data isolation, never include test data in agent context |

---

## Quick Reference

### Minimal Agent

```markdown
---
name: simple-agent
description: Use this agent when... Examples: <example>...</example>
model: inherit
color: blue
---

You are an agent that [does X].

Process:
1. [Step 1]
2. [Step 2]

Output: [What to provide]
```

### Frontmatter Fields Summary

| Field | Required | Format | Example |
|-------|----------|--------|---------|
| name | Yes | lowercase-hyphens | code-reviewer |
| description | Yes | Text + examples | Use when... <example>... |
| model | Yes | inherit/sonnet/opus/haiku | inherit |
| color | Yes | Color name | blue |
| tools | No | Array of tool names | ["Read", "Grep"] |

### Best Practices Checklist

**Agent Structure:**
- Include 2-4 concrete examples in description
- Write specific triggering conditions
- Use `inherit` for model unless specific need
- Choose appropriate tools (least privilege)
- Write clear, structured system prompts
- Test agent triggering thoroughly

**Tool Design:**
- Crystal-clear descriptions (LLM only sees schema + description)
- Explicit error messages that help LLM recover
- Limit to 10-15 tools per agent to avoid confusion
- Use input examples in descriptions when helpful
- Follow MCP standard for interoperability

**Evaluation:**
- Never rely on single-run tests
- Use statistical evaluation (5+ runs per test case)
- Test adversarial inputs alongside happy paths
- Track both benchmark and production metrics
- Maintain strict test data isolation

## Implementation Workflow

1. Define agent purpose and triggering conditions
2. Design tools with clear schemas and descriptions
3. Create `agents/agent-name.md` file with frontmatter
4. Write system prompt following best practices
5. Include 2-4 triggering examples in description
6. Validate structure and test triggering
7. Run statistical evaluation suite
8. Document agent in plugin README
9. Monitor production metrics and iterate
