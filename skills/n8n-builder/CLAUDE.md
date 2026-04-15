# n8n Workflow Builder

This project enables Claude to build high-quality n8n workflows using the n8n MCP server and n8n skills.

## Environment

- **n8n Instance**: n8n Cloud
- **MCP Server**: n8n-mcp (czlonkowski/n8n-mcp)
- **Skills**: n8n-skills (czlonkowski/n8n-skills)

## Setup

### MCP Server (n8n-mcp)

**Option A — Hosted (easiest, free tier: 100 calls/day):**
Visit dashboard.n8n-mcp.com — no local setup required.

**Option B — npx (local):**
Add to `.mcp.json` in your project root:
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "<your-n8n-cloud-url>",
        "N8N_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

**Option C — Docker:**
```bash
docker pull ghcr.io/czlonkowski/n8n-mcp:latest
```

### Skills (n8n-skills)

**Claude Code (recommended):**
```
/plugin install czlonkowski/n8n-skills
```

**Manual:**
Clone `czlonkowski/n8n-skills` and copy skill folders to `~/.claude/skills/`

### n8n API Credentials

Required environment variables for workflow management tools:
- `N8N_API_URL` — your n8n Cloud instance URL
- `N8N_API_KEY` — API key from n8n settings → API → Create key

## Available MCP Tools

### Documentation & Discovery

| Tool | Purpose |
|------|---------|
| `tools_documentation` | Access MCP tool documentation |
| `search_nodes` | Full-text search across 1,396 nodes (812 core + 584 community, filter by core/community/verified) |
| `get_node` | Retrieve node details (minimal/standard/full modes) |
| `validate_node` | Validate node configuration |
| `validate_workflow` | Complete workflow validation including AI Agent checks |
| `search_templates` | Search 2,709 templates (by keyword/nodes/task/metadata) |
| `get_template` | Retrieve complete workflow JSON from templates |

### Workflow Management

| Tool | Purpose |
|------|---------|
| `n8n_create_workflow` | Create new workflows |
| `n8n_get_workflow` | Retrieve existing workflows (full/structure/minimal modes) |
| `n8n_update_full_workflow` | Full workflow replacement |
| `n8n_update_partial_workflow` | Incremental updates — 19 operation types incl. `patchNodeField`, `activateWorkflow`, `transferWorkflow` (most used: 38,287 uses, 99% success) |
| `n8n_delete_workflow` | Permanently delete workflows |
| `n8n_list_workflows` | List workflows with filtering/pagination |
| `n8n_validate_workflow` | Validate workflow by ID |
| `n8n_autofix_workflow` | Auto-fix common workflow issues |
| `n8n_deploy_template` | Deploy a template directly to n8n instance |
| `n8n_workflow_versions` | Version history and rollback |

### Execution Management

| Tool | Purpose |
|------|---------|
| `n8n_test_workflow` | Test/trigger workflows |
| `n8n_executions` | Manage executions (list, get, delete) |

### Data & Credentials

| Tool | Purpose |
|------|---------|
| `n8n_manage_datatable` | CRUD on n8n data tables and rows (supports filtering, dry-run) |
| `n8n_manage_credentials` | Full credential CRUD + schema discovery (`getSchema`) |

### Security & Audit

| Tool | Purpose |
|------|---------|
| `n8n_audit_instance` | Security audit: 5 risk categories + deep scan (hardcoded secrets, unauthenticated webhooks, error handling, data retention) |

### Guides

| Tool | Purpose |
|------|---------|
| `ai_agents_guide` | AI agent workflow guidance |

## Available Skills

Skills are installed globally (`~/.claude/skills/`) and locally (`./n8n-skills/skills/`). They activate automatically based on context:

1. **n8n Expression Syntax** - Correct `{{}}` patterns and variable access
2. **n8n MCP Tools Expert** - Effective use of MCP server tools (HIGHEST PRIORITY)
3. **n8n Workflow Patterns** - 5 proven architectural approaches
4. **n8n Validation Expert** - Interpret and resolve validation errors
5. **n8n Node Configuration** - Operation-aware node setup
6. **n8n Code JavaScript** - JavaScript in Code nodes
7. **n8n Code Python** - Python with limitations awareness

Invoke manually with `/n8n-workflow-patterns`, `/n8n-expression-syntax`, etc.

## Workflow Building Process

### 1. Understand Requirements
- Clarify the workflow's purpose and triggers
- Identify required integrations and data flow
- Determine error handling needs

### 2. Search Templates First
```
search_templates → Find similar workflows
get_template → Get workflow JSON as starting point
```

### 3. Research Nodes
```
search_nodes → Find appropriate nodes
get_node → Get configuration details
```

### 4. Build Incrementally
- Start with trigger node
- Add nodes one at a time
- Validate after each addition

### 5. Validate Before Deployment
```
validate_workflow → Check for errors
Fix any issues → Re-validate
```

### 6. Test
```
n8n_test_workflow → Run with test data
Verify outputs → Adjust as needed
```

## Safety Rules

- **NEVER edit production workflows directly** - Always create copies
- **NEVER deploy without validation** - Use `validate_workflow` first
- **NEVER skip testing** - Always test with realistic data
- **NEVER use default values blindly** - Configure parameters explicitly

## Quality Standards

### Before Creating
- Search templates for existing patterns
- Understand all required node configurations
- Plan error handling strategy

### During Building
- Validate nodes as you add them
- Use proper n8n expression syntax
- Follow established workflow patterns

### Before Deployment
- Run `validate_workflow` with strict profile
- Test with representative data
- Verify error handling works

## Workflow Patterns

Use these 5 proven patterns as architectural foundations:

1. **Webhook Processing** - External triggers → Process → Respond
2. **HTTP API Integration** - Fetch data → Transform → Store/Send
3. **Database Operations** - Query → Process → Update
4. **AI Workflows** - Input → AI processing → Output handling
5. **Scheduled Tasks** - Cron trigger → Batch process → Report

## Expression Syntax Reference

```javascript
// Access input data
{{ $json.fieldName }}

// Access previous node output
{{ $('NodeName').item.json.field }}

// Access all items from a node
{{ $('NodeName').all() }}

// Conditional logic
{{ $json.status === 'active' ? 'yes' : 'no' }}

// Date/time
{{ $now.toISO() }}
{{ $today.format('yyyy-MM-dd') }}
```

## Common Mistakes to Avoid

- Using expressions inside Code nodes (use variables instead)
- Forgetting `$json.body` for webhook data access
- Not handling empty/null values
- Skipping validation before deployment
- Editing production workflows directly