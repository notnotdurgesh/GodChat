import { GoogleGenAI, Type } from '@google/genai';
import { StreamManager } from './streamManager';

// Define the schema for the output
export interface CognitiveNode {
  id: string;
  label: string;
  type: 'chapter' | 'concept' | 'subconcept';
  level: number;
  description?: string;
  section?: string;
}

export interface CognitiveEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

export interface CognitiveMapSchema {
  nodes: CognitiveNode[];
  edges: CognitiveEdge[];
}

export class CognitiveMapService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private parseJSON(text: string | null): any {
    if (!text) return null;
    try {
      // Remove any markdown code blocks that might have leaked in
      const cleanText = text.replace(/^```json\n?/g, '').replace(/\n?```$/g, '').trim();
      return JSON.parse(cleanText);
    } catch (e) {
      console.warn('[CognitiveMapService] Failed to parse JSON', e);
      return null;
    }
  }

  async buildCognitiveMap(
    text: string,
    streamManager: StreamManager,
    streamId: string,
    customInstructions?: string
  ): Promise<CognitiveMapSchema> {
    const notifyProgress = (message: string) => {
      streamManager.publish(streamId, 'tool-progress', {
        tool: 'generate_cognitive_map',
        message,
      });
    };

    notifyProgress('Agent 1 [Chapter Detection]: Initializing...');

    // We will chunk the text to a manageable size to prevent hitting free tier API limits.
    // Gemini 3.1 flash lite has a 250,000 tokens per minute free-tier limit.
    // 4 agents run back-to-back, so we need to limit text size safely. (e.g., 100,000 chars is ~25k tokens).
    const safeText = text.length > 100000 ? text.slice(0, 100000) + "\n...[Content Truncated due to Rate Limits]..." : text;

    notifyProgress('Agent 1 [Chapter Detection]: Analyzing document structure...');

    const customGuidance = customInstructions ? `\nUser Instructions to follow closely:\n"${customInstructions}"\n` : '';

    // Agent 1: Chapter Extraction
    const chapterRes = await this.ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: `
You are a document structure analyzer.${customGuidance}
Input: Raw text chunk
Task:
- Identify headings, chapters, sections
- Return structured JSON

Output format:
{
  "chapters": [
    {
      "title": "...",
      "level": 1,
      "pageOrSection": "Chapter 1"
    }
  ]
}

Document:
${safeText}` }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  level: { type: Type.NUMBER },
                  pageOrSection: { type: Type.STRING },
                },
                required: ['title', 'level']
              }
            }
          }
        }
      }
    });

    const chaptersRaw = this.parseJSON(chapterRes.text) || { chapters: [] };
    const chapters = chaptersRaw.chapters || [];

    notifyProgress('Agent 2 [Concept Extraction]: Distilling core ideas...');

    // Agent 2: Concepts
    const conceptRes = await this.ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: `
Extract core concepts from this section. Make sure to capture a concise explanation and a section or page reference if visible.${customGuidance}
Rules:
- Avoid fluff
- Each concept must be atomic
- Include explanation in 1–2 lines

Output:
[
  {
    "concept": "...",
    "description": "...",
    "importance": 1,
    "sectionRef": "p. 10 / Sec 2.1"
  }
]

Document Chapters:
${JSON.stringify(chapters, null, 2)}
Document Excerpt:
${safeText.substring(0, 50000)}` }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              concept: { type: Type.STRING },
              description: { type: Type.STRING },
              importance: { type: Type.NUMBER },
              sectionRef: { type: Type.STRING }
            },
            required: ['concept', 'description', 'importance']
          }
        }
      }
    });

    const conceptsRaw = this.parseJSON(conceptRes.text) || [];
    const concepts = Array.isArray(conceptsRaw) ? conceptsRaw : [];

    notifyProgress('Agent 3 [Relationship Analyzer]: Identifying semantic connections...');

    // Agent 3: Relationships
    const relRes = await this.ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: `
Identify strong hierarchical and logical relationships between concepts and chapters. Use robust academic relationships rather than basic ones.${customGuidance}
Good Types:
- "Subcatergory Of"
- "Foundation For"
- "Expands On"
- "Contrasts With"
- "Implements"

Output:
[
  {
    "from": "Concept A",
    "to": "Concept B",
    "relation": "Foundation For",
    "label": "Serves as foundation for"
  }
]

Chapters & Concepts:
${JSON.stringify({ chapters, concepts }, null, 2)}` }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              from: { type: Type.STRING },
              to: { type: Type.STRING },
              relation: { type: Type.STRING },
              label: { type: Type.STRING }
            },
            required: ['from', 'to', 'relation']
          }
        }
      }
    });

    const relsRaw = this.parseJSON(relRes.text) || [];
    const relationships = Array.isArray(relsRaw) ? relsRaw : [];

    notifyProgress('Agent 4 [Hierarchy Builder]: Assembling X-Ray schema...');

    // Transform to nodes and edges.
    // Use IDs instead of string concepts.
    
    // Fallback: local processing
    const nodes: CognitiveNode[] = [];
    const edges: CognitiveEdge[] = [];
    
    const getId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    chapters.forEach((c: any, idx: number) => {
      const id = 'chapter-' + idx;
      nodes.push({ id, label: c.title, type: 'chapter', level: c.level, section: c.pageOrSection });
    });

    const finalRes = await this.ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: `
You are building a cognitive hierarchy (X-Ray schema).
Input:
- Chapters (includes page/section reference)
- Concepts (includes description, section reference)
- Relationships

Task:
- Organize into nodes and edges suitable for a React Flow visualization.
- Ensure logical parent-child structure.
- Map descriptions and secton boundaries accurately into the node definitions.
- Nodes need id, label, type ('chapter' | 'concept'), level (0 for chapter, 1+ for concept)
- Include descriptions and section properties if available context exists!

Output Schema Example:
{
  "nodes": [{"id": "1", "label": "...", "type": "chapter", "level": 0, "description": "...", "section": "Ch 1"}],
  "edges": [{"source": "1", "target": "2", "type": "Depends On", "label": "Depends On"}]
}

Inputs:
${JSON.stringify({ chapters, concepts, relationships }, null, 2)}
` }] }],
      config: {
         responseMimeType: 'application/json',
         responseSchema: {
           type: Type.OBJECT,
           properties: {
             nodes: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   id: { type: Type.STRING },
                   label: { type: Type.STRING },
                   type: { type: Type.STRING, enum: ['chapter', 'concept', 'subconcept'] },
                   level: { type: Type.NUMBER },
                   description: { type: Type.STRING },
                   section: { type: Type.STRING }
                 },
                 required: ['id', 'label', 'type', 'level']
               }
             },
             edges: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   source: { type: Type.STRING },
                   target: { type: Type.STRING },
                   type: { type: Type.STRING },
                   label: { type: Type.STRING }
                 },
                 required: ['source', 'target', 'type']
               }
             }
           },
           required: ['nodes', 'edges']
         }
      }
    });

    const finalGraph = this.parseJSON(finalRes.text) || { nodes: [], edges: [] };
    
    notifyProgress('Cognitive Map generation complete. Handing over to frontend...');

    return {
      nodes: finalGraph.nodes || [],
      edges: finalGraph.edges || []
    };
  }
}