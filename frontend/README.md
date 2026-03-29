# Frontend

The React client for jellyfsch. Chat generation, persistence, imports, authentication, and Mermaid tooling are all served by the unified backend in `../backend`.

## Features

- Interactive graph view for branching conversations
- SSE-based streaming chat responses
- Authenticated server-backed session persistence
- Mermaid diagrams rendered through the unified backend
- Import support for Gemini, Claude, and ChatGPT shared chats

## Prerequisites

- Node.js v18+
- The `backend` service running locally

## Development

From the repo root:
```bash
npm run dev
```

Or from this package directly:
```bash
npm run dev
```

The Vite app runs on `http://localhost:3000` and expects the backend on `http://localhost:5001` unless `VITE_BACKEND_URL` is overridden.

## Build

```bash
npm run build
```
