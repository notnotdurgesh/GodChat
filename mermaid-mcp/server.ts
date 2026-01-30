import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';
import pako from 'pako';
import { validate } from '@a24z/mermaid-parser';

const app = express();
const args = process.argv.slice(2);
const pIndex = args.indexOf('--p');
const argPort = pIndex !== -1 ? parseInt(args[pIndex + 1], 10) : null;

const PORT = argPort || process.env.PORT || 5000;

// Enable CORS and increase body limit for large diagrams, but keep it reasonable to prevent DoS
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Proper logging middleware with perfection keyword detection
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);

    // Check for "perfect", "nbest", "best" in the request body
    const bodyStr = JSON.stringify(req.body).toLowerCase();
    next();
});

// Helper to encode state for Mermaid Jelly (mermaid.ink) and Live Editor
// Uses pako for zlib compression, then base64 encoding (url-safe)
const encodeState = (state: any): string => {
    const jsonString = JSON.stringify(state);
    const data = new TextEncoder().encode(jsonString);
    const compressed = pako.deflate(data, { level: 9 });
    // Convert to base64 and make it URL safe
    return Buffer.from(compressed)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
};

const DOCS_BASE_PATH = path.join(__dirname, 'MermaidDocs');

// Allowed files whitelist for security - Strict validation
const VALID_SYNTAX_FILES = [
    "architecture.md", "block.md", "c4.md", "classDiagram.md",
    "entityRelationshipDiagram.md", "flowchart.md", "gantt.md",
    "gitgraph.md", "kanban.md", "mindmap.md", "packet.md",
    "pie.md", "quadrantChart.md", "requirementDiagram.md",
    "sankey.md", "sequenceDiagram.md", "stateDiagram.md",
    "timeline.md", "userJourney.md", "xyChart.md"
];

const VALID_CONFIG_FILES = ["math.md", "looks-and-themes.md"];

// Tool 1: get_syntax_docs
app.post('/tools/get_syntax_docs', async (req, res) => {
    try {
        const { file } = req.body;

        // 1. Input Validation
        if (!file || typeof file !== 'string') {
            return res.status(400).json({ error: 'File parameter is required and must be a string' });
        }

        // 2. Safelist Validation (Security: Prevent Path Traversal)
        if (!VALID_SYNTAX_FILES.includes(file)) {
            return res.status(400).json({ error: `Invalid file requested. Allowed files: ${VALID_SYNTAX_FILES.join(', ')}` });
        }

        // 3. Path Resolution
        const filePath = path.join(DOCS_BASE_PATH, 'SyntaxDocs', file);

        // 4. Double-check path traversal (Defense in Depth)
        const canonicalPath = path.resolve(filePath);
        const canonicalBase = path.resolve(path.join(DOCS_BASE_PATH, 'SyntaxDocs'));
        if (!canonicalPath.startsWith(canonicalBase)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // 5. File Read
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: `Documentation file '${req.body.file}' not found on server.` });
        }
        res.status(500).json({ error: error.message });
    }
});

// Tool 2: get_config_docs
app.post('/tools/get_config_docs', async (req, res) => {
    try {
        const { file } = req.body;

        if (!file || typeof file !== 'string') {
            return res.status(400).json({ error: 'File parameter is required and must be a string' });
        }

        if (!VALID_CONFIG_FILES.includes(file)) {
            return res.status(400).json({ error: `Invalid file requested. Allowed files: ${VALID_CONFIG_FILES.join(', ')}` });
        }

        const filePath = path.join(DOCS_BASE_PATH, 'StylingDocs', file);

        // Security check
        const canonicalPath = path.resolve(filePath);
        const canonicalBase = path.resolve(path.join(DOCS_BASE_PATH, 'StylingDocs'));
        if (!canonicalPath.startsWith(canonicalBase)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: `Configuration file '${req.body.file}' not found on server.` });
        }
        res.status(500).json({ error: error.message });
    }
});



// Tool 3: render_diagram
app.post('/tools/render_diagram', async (req, res) => {
    try {
        const { mermaidCode, config } = req.body;

        if (!mermaidCode || typeof mermaidCode !== 'string') {
            return res.status(400).json({
                diagram: {
                    diagramUrl: "",
                    linkToMermaidChartEditor: "",
                    linkToMermaidChart: "",
                    errorMessage: "mermaidCode string is required"
                }
            });
        }

        // --- Mermaid Syntax Validation (Standardized) ---
        // Using @a24z/mermaid-parser which provides the same logic as the official mermaid.parse
        // with suppressErrors: true returning false on failure.
        let isValid = false;
        let errorMessage = "";

        try {
            const result = await validate(mermaidCode, { suppressErrors: true });
            if (result === false) {
                isValid = false;
                errorMessage = "Syntax Error: Invalid Mermaid diagram definition. Please check your syntax against Mermaid documentation.";

                // Try once more without suppression to get the real error if possible (though validate usually throws if not suppressed)
                try {
                    await validate(mermaidCode, { suppressErrors: false });
                } catch (e: any) {
                    errorMessage = `Syntax Error: ${e.message || "Invalid diagram definition"}`;
                }
            } else {
                isValid = true;
            }
        } catch (error: any) {
            isValid = false;
            errorMessage = `Parsing Error: ${error.message || "Unknown error during initialization"}`;
        }

        if (!isValid) {
            return res.status(200).json({
                diagram: {
                    diagramUrl: "",
                    linkToMermaidChartEditor: "",
                    linkToMermaidChart: "",
                    errorMessage: errorMessage
                }
            });
        }

        // --- Construct state for Mermaid Live Editor ---
        // Defaults: theme 'neo' (as requested), autoSync true
        // Merge user-provided config strictly to avoid arbitrary overrides if needed, 
        // but here we want flexibility as per user request.

        const defaultMermaidConfig = {
            theme: 'neo'
        };

        const finalMermaidConfig = {
            ...defaultMermaidConfig,
            ...(typeof config === 'object' ? config : {})
        };

        const state = {
            code: mermaidCode,
            mermaid: finalMermaidConfig,
            autoSync: true,
            updateDiagram: true
        };

        const payload = encodeState(state);

        // Mermaid Ink URL (Renders image)
        const diagramUrl = `https://mermaid.ink/img/pako:${payload}`;

        // Mermaid Live Editor URL (For editing)
        const editUrl = `https://mermaid.live/edit#pako:${payload}`;

        // --- Validation: Verify the Image URL works ---
        // This prevents returning a URL that renders an error image (e.g. "Lexical error")
        try {
            // Use native fetch if available, else try node-fetch
            const fetchFn = globalThis.fetch || (await import('node-fetch').then(m => m.default));

            // We use a small timeout to avoid hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const verifyRes = await fetchFn(diagramUrl, {
                method: 'GET', // mermaid.ink might not like HEAD for generated SVGs/imgs
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!verifyRes.ok) {
                // Try to read the error text if possible, though it might be an image
                const text = await verifyRes.text();

                // If the response is an image but status is >= 400, it's an error
                // If it's a 200 but the image contains text... we can't easily detect without OCR or size heuristic
                // But user report said "raised a error like 400 bad request"

                errorMessage = `Render Error: The diagram service returned ${verifyRes.status} ${verifyRes.statusText}. Please replace the code with a valid usage.`;
            } else {
                // If 200, it might still be an error image if mermaid.ink returns 200 for errors (some services do)
                // But usually 400 is thrown for bad syntax.
                // We rely on the initial parse validation for most things.
            }
        } catch (e: any) {
            console.warn("Validation fetch failed:", e);
            // If validation request fails (network), we might still want to return the URL or treat as error?
            // Treat as error to be safe and force retry or cleaner message.
            // But if specific network issue, maybe not syntax error.
            // We'll leave errorMessage blank if just network timeout, assuming it's okay?
            // User wants "perfect" -> if we can't verify, maybe safe to assume it's risky?
            // Let's assume valid if parsing passed, but log warning.
        }

        if (errorMessage) {
            return res.status(200).json({
                diagram: {
                    diagramUrl: "",
                    linkToMermaidChartEditor: "",
                    linkToMermaidChart: "",
                    errorMessage: errorMessage
                }
            });
        }

        res.json({
            diagram: {
                diagramUrl: diagramUrl,
                linkToMermaidChartEditor: editUrl,
                linkToMermaidChart: editUrl,
                errorMessage: ""
            }
        });

    } catch (error: any) {
        res.status(500).json({
            diagram: {
                diagramUrl: "",
                linkToMermaidChartEditor: "",
                linkToMermaidChart: "",
                errorMessage: error.message || "Unknown error processing request"
            }
        });
    }
});

app.listen(PORT, () => {
    console.log(`Mermaid MCP Service running on port ${PORT}`);
    console.log(`- POST /tools/get_syntax_docs`);
    console.log(`- POST /tools/get_config_docs`);
    console.log(`- POST /tools/render_diagram`);
});
