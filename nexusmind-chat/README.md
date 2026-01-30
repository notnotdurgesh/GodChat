# NexusMind Chat

The client-side interface for the NexusMind ecosystem. This modern React application provides an interactive chat interface with diverse capabilities, including graph visualization, Mermaid diagram rendering, and intelligent "thinking" process displays.

## 🌟 Features

- **Interactive Graph View**: Visualize concepts and connections in a dynamic D3.js graph.
- **Smart Chat Interface**:
  - **Thinking Process**: Visualizes the AI's reasoning steps (`<think>` tags).
  - **Suggestions**: Interactive suggestion chips for quick replies or branching.
  - **Diverge Mode**: Branch conversations and explore different paths.
- **Mermaid Support**: Renders diagrams directly within the chat.
- **Responsive Design**: Optimized for both desktop and mobile experiences.

## 📋 Prerequisites

- **Node.js**: v18 or higher recommended.
- **Yarn**: Recommended package manager.

## 🛠️ Installation

1. Navigate to the project directory:
   ```bash
   cd nexusmind-chat
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

## 🏃‍♂️ Running the Application

### Development Server
To start the local development server with Vite:
```bash
yarn dev
```
The application will typically be accessible at `http://localhost:5173`.

### Production Build
To build the application for production:
```bash
yarn build
```
To preview the production build locally:
```bash
yarn preview
```

## 🏗️ Project Structure

- **`src/components`**: Reusable UI components (GraphView, ChatMessage, Suggestions, etc.).
- **`src/services`**: API services and integration logic (e.g., `mermaidToolService.ts`, `geminiService.ts`).
- **`src/contexts`**: React contexts for state management (ThemeContext, etc.).
- **`src/types.ts`**: TypeScript type definitions.

## 🎨 Styling
The project uses standard CSS/SCSS alongside utility classes/libraries (`react-colorful`, `framer-motion`) for a polished, premium aesthetic.

## 🤝 Contribution
Contributions are welcome! Please ensure you lint your code (`yarn lint`) before submitting.
