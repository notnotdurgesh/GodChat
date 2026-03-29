import { Tool, Type } from "@google/genai";

export const MERMAID_TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "get_syntax_docs",
                description: "Fetches the official syntax documentation for a specific Mermaid diagram type. You MUST select the filename that matches the diagram type you are interested in.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        file: {
                            type: Type.STRING,
                            enum: [
                                "architecture.md", "block.md", "c4.md", "classDiagram.md",
                                "entityRelationshipDiagram.md", "flowchart.md", "gantt.md",
                                "gitgraph.md", "kanban.md", "mindmap.md", "packet.md",
                                "pie.md", "quadrantChart.md", "requirementDiagram.md",
                                "sankey.md", "sequenceDiagram.md", "stateDiagram.md",
                                "timeline.md", "userJourney.md", "xyChart.md"
                            ],
                            description: "The specific documentation filename to retrieve (e.g., 'flowchart.md')."
                        }
                    },
                    required: ["file"]
                }
            },
            {
                name: "get_config_docs",
                description: "Retrieves configuration-level documentation — things that apply across diagram types such as looks, themes, or KaTeX math.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        file: {
                            type: Type.STRING,
                            enum: ["math.md", "looks-and-themes.md"],
                            description: "The configuration document to retrieve."
                        }
                    },
                    required: ["file"]
                }
            },
            {
                name: "render_diagram",
                description: "Renders a Mermaid diagram. You MUST use this tool. Pass the raw diagram code in the 'mermaidCode' parameter.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        mermaidCode: {
                            type: Type.STRING,
                            description: "The raw Mermaid diagram code (e.g., 'graph TD...')."
                        },
                        config: {
                            type: Type.OBJECT,
                            description: "Optional. Configuration object for the diagram (theme, etc)."
                        }
                    },
                    required: ["mermaidCode"]
                }
            }
        ]
    }
];
