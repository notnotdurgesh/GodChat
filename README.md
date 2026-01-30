# NexusMind Ecosystem

This repository contains the source code for the **NexusMind** ecosystem, comprising a powerful front-end chat interface and a specialized backend service for diagram generation.

## 📂 Project Components

### 1. [NexusMind Chat](./nexusmind-chat)
The React-based client application featuring an interactive graph view, intelligent chat capabilities, and advanced UI/UX.
- **Location**: `nexusmind-chat/`
- **Key Features**: Graph visualization, Mermaid tool integration, "Thinking" process display.

### 2. [Mermaid MCP Service](./mermaid-mcp)
A backend service compatible with the Model Context Protocol (MCP) that handles Mermaid diagram validation and generation.
- **Location**: `mermaid-mcp/`
- **Key Features**: Syntax validation, secure diagram rendering, API documentation endpoints.

## 🚀 Getting Started

To get the entire system up and running, you will need to start both the client and the server.

### Prerequisites
- Node.js (v18+)
- npm & yarn

### Quick Start Guide

1. **Start the Backend Service:**
   Open a terminal:
   ```bash
   cd mermaid-mcp
   npm install
   npm start
   ```
   *Server will run on port 5000.*

2. **Start the Frontend Client:**
   Open a second terminal:
   ```bash
   cd nexusmind-chat
   yarn install
   yarn dev
   ```
   *Client will run on http://localhost:5173.*

## 📚 Documentation
For detailed instructions, please refer to the README files in each subdirectory:
- [NexusMind Chat Documentation](./nexusmind-chat/README.md)
- [Mermaid MCP Service Documentation](./mermaid-mcp/README.md)
