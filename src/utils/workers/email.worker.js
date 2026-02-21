// utils/workers/email.worker.js
const { parentPort } = require('worker_threads');
const nodemailer = require('nodemailer');
const knex = require('knex');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

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

    const { to, subject, html, text, metadata = {} } = data;
    const mailOptions = {
      from: `"${process.env.APP_NAME || 'App'}" <${process.env.SMTP_FROM}>`,
      to,
      subject,
      html,
      text: text || (typeof html === 'string' ? html.replace(/<[^>]*>/g, '') : ''),
    };

    const info = await transporter.sendMail(mailOptions);

    await db('emaillog').insert({
      type: metadata.type || 'general',
      toEmail: to,
      subject,
      content: html,
      status: 'sent',
      metadata: JSON.stringify({
        ...metadata,
        messageId: info.messageId,
        envelope: info.envelope,
      }),
    });

    parentPort.postMessage({ taskId, data: { success: true, messageId: info.messageId } });
  } catch (error) {
    const { to, subject, html, metadata = {} } = data || {};
    try {
      await db('emaillog').insert({
        type: metadata.type || 'general',
        toEmail: to || 'unknown',
        subject: subject || '(no subject)',
        content: html || null,
        status: 'failed',
        error: error.message,
        metadata: metadata ? JSON.stringify(metadata) : null,
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
