// utils/workers/email.worker.js
const { parentPort } = require('worker_threads');
const nodemailer = require('nodemailer');
const knex = require('knex');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Worker is at src/utils/workers/ → go up 3 levels to repo root
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const UPLOADS_PDFS = path.join(PROJECT_ROOT, 'uploads', 'pdfs');

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baripknex',
    charset: 'utf8mb4',
  },
  pool: { min: 1, max: 2 },
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

parentPort.on('message', async ({ taskId, task, data }) => {
  try {
    if (task !== 'sendEmail') {
      throw new Error(`Unknown task: ${task}`);
    }

    const { to, subject, html, text, metadata = {}, attachments: attachmentsPayload = null } = data;
    const tableName = metadata.table_name || null;
    const rowId = metadata.row_id != null ? BigInt(metadata.row_id) : null;

    const mailOptions = {
      from: `"${process.env.APP_NAME || 'App'}" <${process.env.SMTP_FROM}>`,
      to,
      subject,
      html,
      text: text || (typeof html === 'string' ? html.replace(/<[^>]*>/g, '') : ''),
    };

    let decodedAttachments = null;
    if (attachmentsPayload && Array.isArray(attachmentsPayload) && attachmentsPayload.length > 0) {
      decodedAttachments = attachmentsPayload.map((a) => ({
        filename: a.filename || 'attachment',
        content: Buffer.from(a.content, 'base64'),
      }));
      mailOptions.attachments = decodedAttachments;
    }

    const info = await transporter.sendMail(mailOptions);

    let invoicePdfPath = null;
    if (decodedAttachments && tableName === 'rent_payment' && rowId != null) {
      const pdfAttachment = decodedAttachments.find(
        (a) => a.filename && a.filename.toLowerCase().endsWith('.pdf')
      );
      if (pdfAttachment && pdfAttachment.content && pdfAttachment.content.length > 0) {
        let existingMeta = {};
        try {
          const [row] = await db('rent_payment').where('id', rowId).select('metadata');
          if (row && row.metadata) {
            existingMeta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          }
        } catch (_) {}
        const alreadyHasPdf = !!existingMeta.invoicePdfPath;
        if (!alreadyHasPdf) {
          const folderName = crypto.randomBytes(6).toString('hex');
          const dirPath = path.join(UPLOADS_PDFS, folderName);
          const filePath = path.join(dirPath, 'invoice.pdf');
          try {
            if (!fs.existsSync(UPLOADS_PDFS)) {
              fs.mkdirSync(UPLOADS_PDFS, { recursive: true });
            }
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(filePath, pdfAttachment.content);
            invoicePdfPath = `/uploads/pdfs/${folderName}/invoice.pdf`;
          } catch (fsErr) {
            console.error('[email.worker] Failed to save invoice PDF:', fsErr.message);
          }
          if (invoicePdfPath) {
            try {
              existingMeta.invoicePdfPath = invoicePdfPath;
              await db('rent_payment').where('id', rowId).update({
                metadata: JSON.stringify(existingMeta),
                updated_at: new Date(),
              });
            } catch (dbErr) {
              console.error('[email.worker] Failed to update rent_payment metadata:', dbErr.message);
            }
          }
        } else {
          invoicePdfPath = existingMeta.invoicePdfPath;
        }
      }
    }

    const logMetadata = { ...metadata };
    delete logMetadata.table_name;
    delete logMetadata.row_id;
    if (invoicePdfPath) {
      logMetadata.invoicePdfPath = invoicePdfPath;
    }
    await db('emaillog').insert({
      type: metadata.type || 'general',
      toEmail: to,
      subject,
      content: html,
      status: 'sent',
      table_name: tableName,
      row_id: rowId,
      metadata: JSON.stringify({
        ...logMetadata,
        messageId: info.messageId,
        envelope: info.envelope,
      }),
    });

    parentPort.postMessage({ taskId, data: { success: true, messageId: info.messageId } });
  } catch (error) {
    const { to, subject, html, metadata = {} } = data || {};
    try {
      const failMetadata = data?.metadata || {};
      const logMeta = { ...failMetadata };
      delete logMeta.table_name;
      delete logMeta.row_id;
      await db('emaillog').insert({
        type: failMetadata.type || 'general',
        toEmail: to || 'unknown',
        subject: subject || '(no subject)',
        content: html || null,
        status: 'failed',
        error: error.message,
        table_name: failMetadata.table_name || null,
        row_id: failMetadata.row_id != null ? BigInt(failMetadata.row_id) : null,
        metadata: Object.keys(logMeta).length ? JSON.stringify(logMeta) : null,
      });
    } catch (logErr) {
      console.error('Failed to log email error:', logErr);
    }

    parentPort.postMessage({
      taskId,
      error: error.message,
      data: null,
    });
  }
});

process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await db.destroy();
  process.exit(0);
});
