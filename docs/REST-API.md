# OpenFox REST API Reference

OpenFox uses a hybrid architecture: **REST API for CRUD operations** and **WebSocket for real-time streaming/events**.

## Architecture Overview

| Operation Type | Protocol | Examples |
|---------------|----------|----------|
| **CRUD Operations** | REST (HTTP) | Projects, Sessions, Settings, Provider Config |
| **Real-time Streaming** | WebSocket | Chat messages, tool calls, thinking blocks |
| **State Events** | WebSocket | Mode changes, phase changes, criteria updates |
| **Interactive Prompts** | WebSocket | Path confirmations, ask-user questions |

---

## REST API Endpoints

### Projects

#### `GET /api/projects`
List all projects.

**Response:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "My Project",
      "workdir": "/path/to/project",
      "customInstructions": "Optional instructions",
      "createdAt": "2026-03-29T00:00:00Z",
      "updatedAt": "2026-03-29T00:00:00Z"
    }
  ]
}
```

#### `POST /api/projects`
Create a new project.

**Request:**
```json
{
  "name": "My Project",
  "workdir": "/path/to/project"
}
```

**Response (201):**
```json
{
  "project": {
    "id": "uuid",
    "name": "My Project",
    "workdir": "/path/to/project",
    "createdAt": "2026-03-29T00:00:00Z",
    "updatedAt": "2026-03-29T00:00:00Z"
  }
}
```

#### `GET /api/projects/:id`
Load a specific project.

**Response:**
```json
{
  "project": { ... }
}
```

**Errors:**
- `404` - Project not found

#### `PUT /api/projects/:id`
Update project name or custom instructions.

**Request:**
```json
{
  "name": "Updated Name",
  "customInstructions": "New instructions"
}
```

**Response:**
```json
{
  "project": { ... }
}
```

#### `DELETE /api/projects/:id`
Delete a project.

**Response:**
```json
{
  "success": true
}
```

---

### Sessions

#### `GET /api/sessions`
List sessions (optionally filtered by projectId).

**Query Parameters:**
- `projectId` (optional) - Filter sessions by project

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "projectId": "project-uuid",
      "mode": "planner",
      "phase": "plan",
      "isRunning": false,
      "metadata": {
        "title": "Session 1"
      },
      "criteriaCount": 5,
      "criteriaCompleted": 3,
      "recentUserPrompts": ["prompt 1", "prompt 2"],
      "messages": [...]
    }
  ]
}
```

#### `POST /api/sessions`
Create a new session.

**Request:**
```json
{
  "projectId": "project-uuid",
  "title": "My Session"
}
```

**Response (201):**
```json
{
  "session": {
    "id": "uuid",
    "projectId": "project-uuid",
    "mode": "planner",
    "phase": "plan",
    "metadata": {
      "title": "My Session"
    }
  }
}
```

#### `GET /api/sessions/:id`
Load a session with full state (messages, context).

**Response:**
```json
{
  "session": { ... },
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "Hello",
      "timestamp": "2026-03-29T00:00:00Z",
      "tokenCount": 10,
      "isStreaming": false
    }
  ],
  "contextState": {
    "currentTokens": 1500,
    "maxTokens": 128000
  }
}
```

#### `DELETE /api/sessions/:id`
Delete a session.

**Response:**
```json
{
  "success": true
}
```

#### `DELETE /api/projects/:projectId/sessions`
Delete all sessions for a project.

**Response:**
```json
{
  "success": true
}
```

---

### Settings

#### `GET /api/settings/:key`
Get a setting value.

**Response:**
```json
{
  "key": "global_instructions",
  "value": "Always use dark theme"
}
```

**Note:** Returns `null` for non-existent keys.

#### `PUT /api/settings/:key`
Set a setting value.

**Request:**
```json
{
  "value": "New value"
}
```

**Response:**
```json
{
  "key": "global_instructions",
  "value": "New value"
}
```

---

### Provider Configuration

#### `GET /api/providers`
List all configured providers.

**Response:**
```json
{
  "providers": [
    {
      "id": "provider-uuid",
      "name": "Local vLLM",
      "url": "http://localhost:8000",
      "backend": "vllm",
      "models": [
        {
          "id": "llama-3.2-3b",
          "contextWindow": 131072,
          "source": "backend"
        }
      ],
      "isActive": true
    }
  ],
  "activeProviderId": "provider-uuid"
}
```

#### `GET /api/providers/:id/models`
Get models for a specific provider.

**Response:**
```json
{
  "models": [
    {
      "id": "llama-3.2-3b",
      "contextWindow": 131072,
      "source": "backend"
    }
  ]
}
```

#### `POST /api/providers/:id/activate`
Activate a provider (global).

**Request:**
```json
{
  "model": "llama-3.2-3b"
}
```

**Response:**
```json
{
  "success": true,
  "activeProviderId": "provider-uuid",
  "model": "llama-3.2-3b",
  "backend": "vllm"
}
```

#### `POST /api/sessions/:id/provider`
Set provider/model for a specific session.

**Request:**
```json
{
  "providerId": "provider-uuid",
  "model": "llama-3.2-3b"
}
```

**Response:**
```json
{
  "session": { ... },
  "messages": [...],
  "contextState": {
    "currentTokens": 1500,
    "maxTokens": 131072
  }
}
```

---

### Dev Server

#### `GET /api/dev-server?workdir=/path`
Get dev server status.

**Response:**
```json
{
  "state": "running",
  "url": "http://localhost:5173",
  "hotReload": true,
  "config": {
    "command": "npm run dev",
    "url": "http://localhost:5173",
    "hotReload": true
  }
}
```

#### `POST /api/dev-server/start?workdir=/path`
Start dev server.

#### `POST /api/dev-server/stop?workdir=/path`
Stop dev server.

#### `POST /api/dev-server/restart?workdir=/path`
Restart dev server.

#### `GET /api/dev-server/logs?workdir=/path`
Get full log buffer.

#### `GET /api/dev-server/config?workdir=/path`
Get dev server config.

#### `POST /api/dev-server/config?workdir=/path`
Save dev server config.

**Request:**
```json
{
  "command": "npm run dev",
  "url": "http://localhost:5173",
  "hotReload": true
}
```

---

## WebSocket Events (Real-time Only)

WebSocket is now used **only** for:

### Chat Streaming
- `chat.send` - Send message
- `chat.stop` - Stop generation
- `chat.continue` - Continue after interruption
- `chat.delta` - Text streaming
- `chat.thinking` - Thinking block content
- `chat.tool_preparing` - Tool call detected
- `chat.tool_call` - Tool being called
- `chat.tool_output` - Streaming tool output
- `chat.tool_result` - Tool result
- `chat.done` - Generation complete
- `chat.error` - Error during generation

### Session State Events
- `mode.changed` - Mode switch (planner/builder)
- `phase.changed` - Workflow phase change
- `criteria.updated` - Criteria changes
- `context.state` - Context window updates
- `session.running` - Running state changes

### Interactive Prompts
- `chat.path_confirmation` - Request path access confirmation
- `path.confirm` - User response
- `chat.ask_user` - Request user answer
- `ask.answer` - User response

### Message Queue (During Execution)
- `queue.asap` - Queue message for ASAP injection
- `queue.completion` - Queue message for turn completion
- `queue.cancel` - Cancel queued message
- `queue.state` - Queue state broadcast

---

## Migration Notes

### What Changed

**Before (WebSocket for everything):**
```javascript
wsClient.send('project.create', { name, workdir })
wsClient.send('session.load', { sessionId })
wsClient.send('settings.get', { key })
```

**After (REST for CRUD):**
```javascript
fetch('/api/projects', { method: 'POST', body: { name, workdir } })
fetch(`/api/sessions/${sessionId}`)
fetch(`/api/settings/${key}`)
```

### What Stayed on WebSocket

- Chat message streaming (text deltas, tool calls)
- Real-time state events (mode, phase, criteria)
- Interactive prompts (path confirmation, ask-user)
- Message queue during agent execution

### Benefits

1. **Simpler frontend code** - No WebSocket boilerplate for CRUD
2. **Better caching** - HTTP caching for GET requests
3. **Easier debugging** - REST endpoints visible in browser dev tools
4. **Standard patterns** - REST for data, WS for events
5. **Better error handling** - HTTP status codes for errors
