import express from 'express';
import { getConfigDocs, getSyntaxDocs, renderDiagram } from './mermaidTools';

export const TOOL_ROUTE_LOGS = [
  '  tools  /tools/*',
];

interface RegisterToolRoutesOptions {
  app: express.Express;
}

export const registerToolRoutes = ({ app }: RegisterToolRoutesOptions): void => {
  app.post('/tools/get_syntax_docs', async (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file || typeof file !== 'string') {
        return res.status(400).json({ error: 'File parameter is required and must be a string' });
      }

      const result = await getSyntaxDocs(file);
      return res.json(result);
    } catch (error: any) {
      const message = error.message || 'Failed to load syntax docs';
      const status = message.includes('Invalid syntax doc file') ? 400 : message.includes('Access denied') ? 403 : 500;
      return res.status(status).json({ error: message });
    }
  });

  app.post('/tools/get_config_docs', async (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file || typeof file !== 'string') {
        return res.status(400).json({ error: 'File parameter is required and must be a string' });
      }

      const result = await getConfigDocs(file);
      return res.json(result);
    } catch (error: any) {
      const message = error.message || 'Failed to load config docs';
      const status = message.includes('Invalid config doc file') ? 400 : message.includes('Access denied') ? 403 : 500;
      return res.status(status).json({ error: message });
    }
  });

  app.post('/tools/render_diagram', async (req, res) => {
    try {
      const { mermaidCode, config } = req.body || {};
      const result = await renderDiagram(mermaidCode, config);
      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(500).json({
        diagram: {
          diagramUrl: '',
          linkToMermaidChartEditor: '',
          linkToMermaidChart: '',
          errorMessage: error.message || 'Unknown error processing request',
        },
      });
    }
  });
};

