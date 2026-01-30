# Mermaid MCP Service

A powerful Model Context Protocol (MCP) compatible service for generating and validating Mermaid diagrams. This service acts as a bridge between AI agents/tools and the Mermaid diagramming ecosystem, effectively serving as an intelligent specialized "Model Context Provider" for diagramming tasks.

## 🚀 Features

- **Diagram Generation**: Renders Mermaid code into viewable/editable URLs (Mermaid Ink & Live Editor).
- **Syntax Validation**: Validates Mermaid syntax using `@a24z/mermaid-parser` to ensure correctness before rendering.
- **Documentation Access**: distinct API endpoints to retrieve syntax documentation (`get_syntax_docs`) and styling configuration docs (`get_config_docs`).
- **Secure & Robust**: Implements path traversal protection, CORS, and request logging.

## 📋 Prerequisites

- **Node.js**: v18 or higher recommended.
- **npm** or **yarn**: for dependency management.

## 🛠️ Installation

1. Navigate to the project directory:
   ```bash
   cd mermaid-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## 🏃‍♂️ Running the Service

### Production Mode
To start the server in production mode:
```bash
npm start
```

### Development Mode
To start the server with hot-reloading (using nodemon) on port 5000:
```bash
npm run dev
```

The server will start on port **5000** by default (or the port specified in `process.env.PORT`).

## 🔌 API Endpoints

### 1. Render Diagram (`/tools/render_diagram`)
**Method:** `POST`
**Body:**
```json
{
  "mermaidCode": "graph TD; A-->B;",
  "config": { "theme": "neo" } // Optional
}
```
**Response:** Returns a JSON object containing the `diagramUrl` (image) and `linkToMermaidChartEditor` (editable link).

### 2. Get Syntax Documentation (`/tools/get_syntax_docs`)
**Method:** `POST`
**Body:**
```json
{
  "file": "flowchart.md" 
}
```
**Response:** Returns the content of the requested documentation file.

### 3. Get Configuration Documentation (`/tools/get_config_docs`)
**Method:** `POST`
**Body:**
```json
{
  "file": "looks-and-themes.md"
}
```

## 🔒 Security
- **Safe File Access**: Only files listed in the whitelist can be accessed.
- **Input Validation**: All inputs are strictly validated to prevent injection or errors.

## 🤝 Contribution
Feel free to submit issues or pull requests to improve the service!
