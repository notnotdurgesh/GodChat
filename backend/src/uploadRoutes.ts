import express from 'express';
import multer from 'multer';
import * as mammoth from 'mammoth';
import * as exceljs from 'exceljs';
import { requireAuth } from './authHttp';
import { AuthRequest } from './serverTypes';
import { AttachmentStore } from './attachmentStore';

// ─── PDF parsing via pdf2json ─────────────────────────────────────────────────
// Pure Node.js CJS library — no DOM globals, no ESM hassle, no warnings.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFParser = require('pdf2json');

function parsePDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true); // true = raw text mode
    parser.on('pdfParser_dataReady', (data: any) => {
      try {
        // Safe decode — some PDF text chunks are not valid URI sequences
        const safeDecode = (str: string): string => {
          try { return decodeURIComponent(str); } catch { return str; }
        };
        const text = data.Pages
          .map((page: any) =>
            page.Texts
              .map((t: any) => t.R.map((r: any) => safeDecode(r.T)).join(''))
              .join(' ')
          )
          .join('\n');
        resolve(text.trim());
      } catch (e) {
        reject(e);
      }
    });
    parser.on('pdfParser_dataError', (err: any) => reject(err?.parserError || err));
    parser.parseBuffer(buffer);
  });
}


export const UPLOAD_ROUTE_LOGS = [
  '  upload /api/chat/upload',
  '  serve  /api/attachments/:id',
];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

export const registerUploadRoutes = ({
  app,
  attachmentStore,
}: {
  app: express.Express;
  attachmentStore: AttachmentStore;
}) => {
  app.post('/api/chat/upload', requireAuth, upload.array('files', 10), async (req: AuthRequest, res) => {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    const userId = req.user!.id;
    const uploadedAttachments = [];

    try {
      for (const file of req.files) {
        let extractedText: string | undefined = undefined;
        const mimeType = file.mimetype;

        // Parse Text from Documents — best-effort; failures here must NOT block the upload.
        if (mimeType === 'application/pdf') {
          try {
            extractedText = await parsePDF(file.buffer);
          } catch (e: any) {
            console.warn(`[Upload] PDF text extraction failed for "${file.originalname}":`, e.message);
          }
        } else if (
          mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          mimeType === 'application/msword'
        ) {
          try {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
          } catch (e: any) {
            console.warn(`[Upload] Word text extraction failed for "${file.originalname}":`, e.message);
          }
        } else if (
          mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          mimeType === 'application/vnd.ms-excel'
        ) {
          try {
            const workbook = new exceljs.Workbook();
            await workbook.xlsx.load(file.buffer as any);
            let sheetsText = '';
            workbook.eachSheet((worksheet, sheetId) => {
               sheetsText += `Sheet: ${worksheet.name}\n`;
               worksheet.eachRow((row, rowNumber) => {
                   const values = row.values as any[];
                   sheetsText += values.slice(1).map(v => typeof v === 'object' && v !== null && 'result' in v ? v.result : v).join('\t') + '\n';
               });
               sheetsText += '\n';
            });
            extractedText = sheetsText.trim();
          } catch (e: any) {
            console.warn(`[Upload] Excel text extraction failed for "${file.originalname}":`, e.message);
          }
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'text/csv' || mimeType === 'text/plain') {
          try {
            extractedText = file.buffer.toString('utf-8');
          } catch (e: any) {
            console.warn(`[Upload] Text extraction failed for "${file.originalname}":`, e.message);
          }
        }

        // Save to Database
        const attachment = await attachmentStore.saveAttachment({
          userId,
          name: file.originalname,
          mimeType,
          size: file.size,
          data: file.buffer,
          extractedText,
        });

        uploadedAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: `/api/attachments/${attachment.id}`,
        });
      }

      res.status(200).json({ success: true, data: uploadedAttachments });
    } catch (error: any) {
      console.error('[Upload Error]', error);
      res.status(500).json({ success: false, error: error.message || 'File processing failed' });
    }
  });

  // Serve attachments — no auth required (UUIDs are unguessable); needed for browser PDF/image preview
  app.get('/api/attachments/:id', async (req, res) => {
    try {
      const attachment = await attachmentStore.getAttachmentById(req.params.id);
      if (!attachment) {
        return res.status(404).json({ success: false, error: 'Attachment not found' });
      }

      // MongoDB may return data as a BSON Binary object rather than a plain Buffer.
      // Normalise to a real Node.js Buffer so res.send() streams raw bytes.
      let dataBuffer: Buffer;
      const raw = attachment.data as any;
      if (Buffer.isBuffer(raw)) {
        dataBuffer = raw;
      } else if (raw && raw._bsontype === 'Binary') {
        // MongoDB BSON Binary — .buffer is a Buffer/Uint8Array
        dataBuffer = Buffer.isBuffer(raw.buffer) ? raw.buffer : Buffer.from(raw.buffer);
      } else if (raw instanceof Uint8Array) {
        dataBuffer = Buffer.from(raw);
      } else if (raw && typeof raw === 'object' && raw.buffer) {
        // Generic ArrayBuffer-like or typed-array wrapper
        dataBuffer = Buffer.from(raw.buffer instanceof ArrayBuffer ? raw.buffer : raw.buffer);
      } else if (raw && typeof raw.value === 'function') {
        // Older MongoDB driver: Binary.value() returns the underlying buffer
        const val = raw.value();
        dataBuffer = Buffer.isBuffer(val) ? val : Buffer.from(val);
      } else {
        dataBuffer = Buffer.from(raw);
      }

      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Length', dataBuffer.length);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.name)}"`);

      res.end(dataBuffer);
    } catch (error: any) {
      console.error('[Attachment Serve Error]', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve attachment' });
    }
  });
};

