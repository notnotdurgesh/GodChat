const API_BASE = process.env.BACKEND_URL || process.env.API_BASE || '';

export const mermaidToolsApi = {
    get_syntax_docs: async (args: { file: string }) => {
        const response = await fetch(`${API_BASE}/tools/get_syntax_docs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        return await response.json();
    },

    get_config_docs: async (args: { file: string }) => {
        const response = await fetch(`${API_BASE}/tools/get_config_docs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        return await response.json();
    },

    render_diagram: async (args: { mermaidCode: string, config?: any }) => {
        const response = await fetch(`${API_BASE}/tools/render_diagram`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        const result = await response.json();

        if (result.diagram && result.diagram?.diagramUrl && !result.diagram.errorMessage) {
            const aliasId = `diagram-ref-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            return {
                ...result,
                diagram: {
                    ...result.diagram,
                    diagramUrl: aliasId,
                    _fullUrl: result.diagram.diagramUrl
                },
                _isArtifact: true
            };
        }

        if (result.diagram?.errorMessage) {
            throw new Error(result.diagram.errorMessage);
        }

        return result;
    },
};

