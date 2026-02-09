# DCM Troubleshooting Guide

**Version:** 3.0.0
**Generated:** 2026-02-09
**Status:** Production Ready

## Overview

This guide provides solutions to common DCM issues, error messages, and unexpected behavior. For each problem, you'll find symptoms, causes, and step-by-step solutions.

## Quick Diagnostics

Run these commands first to identify the problem area:

```bash
# Check service health
dcm status

# View API logs
dcm logs api | tail -50

# Test database connection
psql -U $DB_USER -d $DB_NAME -c "SELECT 1"

# Check health endpoint
curl http://localhost:3847/health | jq .
```

## Common Issues

### 1. DCM Won't Start

#### Symptom

```bash
dcm start
# Services appear to start but aren't responding
```

#### Possible Causes

- Port already in use
- Database not running
- Missing environment variables
- Permission errors

#### Solution

**Step 1: Check logs**
```bash
dcm logs api
dcm logs ws
```

**Step 2: Check ports**
```bash
# See what's using ports 3847, 3849, 3848
lsof -i :3847
lsof -i :3849
lsof -i :3848

# Kill conflicting processes
kill $(lsof -ti :3847)
```

**Step 3: Verify environment**
```bash
# Check .env exists
ls -la /path/to/context-manager/.env

# Verify required variables
grep DB_USER /path/to/context-manager/.env
grep DB_PASSWORD /path/to/context-manager/.env
```

**Step 4: Test database**
```bash
# Load env
export $(cat /path/to/context-manager/.env | xargs)

# Test connection
psql -U $DB_USER -d $DB_NAME -c "SELECT version();"
```

**Step 5: Restart**
```bash
dcm stop
dcm start
dcm status
```

### 2. Database Connection Failed

#### Symptom

```
Error: DB_USER environment variable is required
# or
database.healthy: false
```

#### Solutions

**Missing Credentials:**
```bash
# Add to .env
echo "DB_USER=dcm" >> .env
echo "DB_PASSWORD=your_password" >> .env
```

**PostgreSQL Not Running:**
```bash
# Check status
sudo systemctl status postgresql

# Start if stopped
sudo systemctl start postgresql

# Enable auto-start
sudo systemctl enable postgresql
```

**Wrong Credentials:**
```bash
# Test credentials
psql -U dcm -d claude_context

# Reset password
sudo -u postgres psql
ALTER USER dcm WITH PASSWORD 'new_password';
```

**Database Doesn't Exist:**
```bash
# Create database
dcm db:setup

# Or manually
psql -U postgres -c "CREATE DATABASE claude_context;"
```

**Connection Refused:**
```bash
# Check PostgreSQL is listening
sudo netstat -tlnp | grep 5432

# Check pg_hba.conf allows local connections
sudo nano /etc/postgresql/*/main/pg_hba.conf

# Add this line:
local   all   all   md5
```

### 3. Hooks Not Firing

#### Symptom

- Actions not being tracked
- Compact save/restore not working
- No data in dashboard

#### Diagnosis

```bash
# Check hooks installed
dcm status

# Manual test
echo '{"tool_name":"Bash","session_id":"test"}' | \
  /path/to/context-manager/hooks/track-action.sh
```

#### Solutions

**Hooks Not Installed:**
```bash
dcm hooks
```

**Wrong Hook Path:**
```bash
# Check settings.json
cat ~/.config/ClaudeCode/settings.json | jq '.hooks'

# Reinstall with correct path
dcm unhook
dcm hooks
```

**Hook Timeout:**
```bash
# Check hook logs (if available)
grep "track-action" /tmp/dcm-api.log

# Increase timeout in hooks.json
nano /path/to/context-manager/hooks/hooks.json
# Change timeout_ms: 3000 to 5000
```

**API Not Running:**
```bash
# Hooks fail silently if API is down
dcm start

# Test API
curl http://localhost:3847/health
```

**Permission Error:**
```bash
# Make hooks executable
chmod +x /path/to/context-manager/hooks/*.sh

# Test execution
bash -n /path/to/context-manager/hooks/track-action.sh
```

### 4. Context Not Restored After Compact

#### Symptom

- After compaction, agent loses all context
- `post-compact-restore.sh` doesn't inject context

#### Diagnosis

```bash
# Check compact snapshot exists
curl http://localhost:3847/api/compact/status/session-abc | jq .

# Check restore hook is installed
grep "post-compact-restore" ~/.config/ClaudeCode/settings.json
```

#### Solutions

**No Snapshot Saved:**
```bash
# Pre-compact save hook may have failed
# Check logs
dcm logs api | grep compact

# Manually trigger snapshot
dcm snapshot session-abc
```

**Restore Hook Not Returning Context:**
```bash
# Test restore manually
export SESSION_ID="session-abc"
export AGENT_ID="orchestrator"
/path/to/context-manager/hooks/post-compact-restore.sh

# Should output JSON with hookSpecificOutput.additionalContext
```

**Context Brief Empty:**
```bash
# Check if any data exists for session
curl http://localhost:3847/api/context/orchestrator?session_id=session-abc&format=brief

# If empty, no data was recorded
# Ensure track-action hook is firing
```

### 5. Dashboard Not Loading

#### Symptom

- Blank page or loading spinner forever
- 502 Bad Gateway
- CORS errors in console

#### Solutions

**Dashboard Not Started:**
```bash
dcm status
# If dashboard shows "not running"
dcm start
```

**API Not Reachable:**
```bash
# Check API is running
curl http://localhost:3847/health

# Check NEXT_PUBLIC_API_URL in dashboard
cat /path/to/context-dashboard/.env.local
# Should be: NEXT_PUBLIC_API_URL=http://localhost:3847
```

**CORS Errors:**
```bash
# Add dashboard origin to ALLOWED_ORIGINS
echo "ALLOWED_ORIGINS=http://localhost:3848,http://127.0.0.1:3848" >> .env

# Restart API
dcm restart
```

**Port Conflict:**
```bash
# Check port 3848
lsof -i :3848

# Change dashboard port
cd /path/to/context-dashboard
echo "PORT=3850" > .env.local
bun run dev
```

**Build Errors:**
```bash
# Rebuild dashboard
cd /path/to/context-dashboard
rm -rf .next
bun install
bun run build
bun run start
```

### 6. WebSocket Connection Failed

#### Symptom

```
WebSocket connection to 'ws://localhost:3849' failed
```

#### Solutions

**WebSocket Server Not Running:**
```bash
dcm status
# Check WebSocket line

dcm start
```

**Port Blocked:**
```bash
# Check firewall
sudo ufw status

# Allow port
sudo ufw allow 3849/tcp
```

**Authentication Failed:**
```bash
# Check WS_AUTH_SECRET is set
grep WS_AUTH_SECRET .env

# Generate if missing
echo "WS_AUTH_SECRET=$(openssl rand -hex 32)" >> .env

# Restart WebSocket server
dcm restart
```

### 7. High Memory Usage

#### Symptom

- DCM processes consuming excessive RAM
- Server becomes unresponsive
- OOM (Out of Memory) errors

#### Diagnosis

```bash
# Check memory usage
ps aux | grep bun

# Check database connections
psql -U $DB_USER -d $DB_NAME -c "SELECT count(*) FROM pg_stat_activity;"
```

#### Solutions

**Too Many Database Connections:**
```bash
# Reduce max connections
echo "DB_MAX_CONNECTIONS=5" >> .env
dcm restart
```

**Large Context Snapshots:**
```bash
# Reduce snapshot retention
echo "CLEANUP_SNAPSHOT_MAX_HOURS=12" >> .env
dcm restart
```

**Cleanup Not Running:**
```bash
# Check cleanup stats
curl http://localhost:3847/api/cleanup/stats | jq .

# Force cleanup by restarting
dcm restart
```

**Memory Leak:**
```bash
# Upgrade to latest version
cd /path/to/context-manager
git pull
bun install
dcm restart
```

### 8. Actions Not Appearing in Dashboard

#### Symptom

- Dashboard shows "No actions" or empty charts
- Actions are being performed but not tracked

#### Diagnosis

```bash
# Check actions table
psql -U $DB_USER -d $DB_NAME -c "SELECT COUNT(*) FROM actions;"

# Check recent actions
curl http://localhost:3847/api/actions | jq '.actions | length'
```

#### Solutions

**Track-Action Hook Not Firing:**
```bash
# Test hook manually
echo '{"tool_name":"Read","session_id":"test","tool_output":"test"}' | \
  bash /path/to/context-manager/hooks/track-action.sh

# Check API received it
curl http://localhost:3847/api/actions | jq .
```

**Database Write Failed:**
```bash
# Check logs for errors
dcm logs api | grep "POST /api/actions"

# Check database is writable
psql -U $DB_USER -d $DB_NAME -c "INSERT INTO actions (tool_name, tool_type) VALUES ('test', 'builtin');"
```

**Session ID Mismatch:**
```bash
# Actions tracked with wrong session_id
# Check current session
ls -lt /tmp/.claude-context/*.json | head -1

# Check actions by session
curl "http://localhost:3847/api/actions?session_id=session-abc" | jq .
```

### 9. Wave Not Transitioning

#### Symptom

- Wave stuck in "running" state
- Cannot start next wave

#### Diagnosis

```bash
# Get current wave
curl http://localhost:3847/api/waves/session-abc/current | jq .

# Get batch status
curl http://localhost:3847/api/orchestration/batch/batch-uuid | jq .
```

#### Solutions

**Subtasks Still Running:**
```bash
# Check subtask statuses
curl http://localhost:3847/api/orchestration/batch/batch-uuid | jq '.batch.subtasks[].status'

# Manually complete stuck subtask
curl -X PATCH http://localhost:3847/api/subtasks/subtask-uuid \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

**Batch Not Completed:**
```bash
# Complete batch manually
curl -X POST http://localhost:3847/api/orchestration/batch/batch-uuid/complete

# Then transition wave
curl -X POST http://localhost:3847/api/waves/session-abc/transition
```

### 10. Routing Suggestions Inaccurate

#### Symptom

- `/api/routing/suggest` returns wrong tools
- Low success rate for suggestions

#### Solutions

**Submit Feedback:**
```bash
# Negative feedback for bad suggestion
curl -X POST http://localhost:3847/api/routing/feedback \
  -H "Content-Type: application/json" \
  -d '{"keyword":"test","tool_name":"wrong-tool","successful":false}'

# Positive feedback for good suggestion
curl -X POST http://localhost:3847/api/routing/feedback \
  -H "Content-Type: application/json" \
  -d '{"keyword":"test","tool_name":"right-tool","successful":true}'
```

**Insufficient Training Data:**
```bash
# Check keyword count
curl http://localhost:3847/api/routing/stats | jq .

# Use system for longer to build feedback data
```

## Error Messages

### `EADDRINUSE: Address already in use`

**Meaning:** Port is already occupied.

**Solution:**
```bash
# Find process using port
lsof -i :3847

# Kill it
kill $(lsof -ti :3847)

# Or change port
echo "PORT=3850" >> .env
```

### `Connection refused`

**Meaning:** Service not running or firewall blocking.

**Solution:**
```bash
# Start service
dcm start

# Check firewall
sudo ufw status
sudo ufw allow 3847/tcp
```

### `Invalid token`

**Meaning:** WebSocket authentication failed.

**Solution:**
```bash
# Check WS_AUTH_SECRET matches
grep WS_AUTH_SECRET /path/to/context-manager/.env

# Regenerate token
curl -X POST http://localhost:3847/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test"}'
```

### `Validation failed`

**Meaning:** Request body doesn't match schema.

**Solution:**
```bash
# Check API documentation for correct schema
# Common issues:
# - Missing required fields
# - Wrong data types
# - Invalid UUIDs

# Example correct request:
curl -X POST http://localhost:3847/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"id":"session-abc","started_at":"2026-02-09T10:00:00Z"}'
```

### `Database query failed`

**Meaning:** SQL error or connection issue.

**Solution:**
```bash
# Check database is running
sudo systemctl status postgresql

# Check connection
psql -U $DB_USER -d $DB_NAME -c "SELECT 1;"

# Check logs for SQL errors
dcm logs api | grep "Database"
```

## Log File Locations

| Log File | Location | Purpose |
|----------|----------|---------|
| API Server | `/tmp/dcm-api.log` | HTTP requests, errors, info |
| WebSocket Server | `/tmp/dcm-ws.log` | WS connections, events |
| Dashboard | `/tmp/dcm-dashboard.log` | Next.js build, runtime |
| Guardian | `/tmp/dcm-guardian.log` | Context monitoring |

## Health Check Commands

```bash
# API health
curl http://localhost:3847/health | jq .

# Database connectivity
psql -U $DB_USER -d $DB_NAME -c "SELECT 1;"

# WebSocket port
nc -zv localhost 3849

# Dashboard accessibility
curl -I http://localhost:3848

# All services
dcm status
```

## Performance Issues

### Slow API Responses

**Diagnosis:**
```bash
# Check response time
time curl http://localhost:3847/api/dashboard/kpis

# Check database query performance
psql -U $DB_USER -d $DB_NAME -c "EXPLAIN ANALYZE SELECT * FROM actions LIMIT 100;"
```

**Solutions:**
```bash
# Add missing indexes (if any)
psql -U $DB_USER -d $DB_NAME -c "\d actions"

# Reduce max connections
echo "DB_MAX_CONNECTIONS=5" >> .env

# Clear old data
dcm db:reset  # WARNING: Deletes all data
```

### Hook Timeouts

**Symptom:** Hooks timing out before completion.

**Solution:**
```bash
# Increase timeout in hooks.json
nano /path/to/context-manager/hooks/hooks.json

# Change timeout_ms for specific hook
# Example: "timeout_ms": 5000
```

## Data Integrity

### Verify Database Schema

```bash
# List tables
psql -U $DB_USER -d $DB_NAME -c "\dt"

# Expected tables:
# - projects
# - requests
# - task_lists
# - subtasks
# - actions
# - keyword_tool_scores
# - agent_messages
# - agent_contexts
# - sessions
# - wave_states
# - orchestration_batches
# - agent_registry
```

### Check Data Consistency

```bash
# Count records
psql -U $DB_USER -d $DB_NAME -c "
SELECT
  (SELECT COUNT(*) FROM projects) as projects,
  (SELECT COUNT(*) FROM sessions) as sessions,
  (SELECT COUNT(*) FROM actions) as actions;
"
```

## Reset Procedures

### Soft Reset (Preserve Database)

```bash
dcm stop
# Database remains intact
dcm start
```

### Hard Reset (Clear Database)

```bash
dcm stop
dcm db:reset  # WARNING: Deletes all data
dcm start
```

### Complete Reinstall

```bash
dcm stop
dcm unhook
rm -rf /path/to/context-manager/.env
rm -rf /path/to/context-manager/node_modules
dcm install
```

## Support Resources

### Documentation

- [API Reference](./03-api-reference.md)
- [Hooks System](./04-hooks-system.md)
- [Configuration](./13-configuration.md)

### Logs

```bash
# View all logs
dcm logs api
dcm logs ws
dcm logs dashboard
```

### Community

- **GitHub Issues:** Report bugs and feature requests
- **Discussions:** Ask questions and share solutions

## Preventive Maintenance

### Regular Checks

```bash
# Daily
dcm status

# Weekly
dcm logs api | grep ERROR

# Monthly
psql -U $DB_USER -d $DB_NAME -c "VACUUM ANALYZE;"
```

### Backup Strategy

```bash
# Backup database
pg_dump -U $DB_USER claude_context > backup-$(date +%Y%m%d).sql

# Backup configuration
cp .env .env.backup
```

### Update Procedure

```bash
# 1. Backup
dcm stop
cp -r /path/to/context-manager /path/to/context-manager.backup

# 2. Update
cd /path/to/context-manager
git pull
bun install

# 3. Migrate database if needed
dcm db:setup

# 4. Restart
dcm start
dcm status
```

## Next Steps

- [13-configuration.md](./13-configuration.md) - Configuration reference
- [12-cli-reference.md](./12-cli-reference.md) - CLI commands
- [15-contributing.md](./15-contributing.md) - Development guide

---

**Status:** Troubleshooting guide current as of v3.0.0. Updated regularly.
