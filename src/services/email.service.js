// src/services/email.service.js
//
// Email is delivered via a DURABLE OUTBOX, not an in-process queue/worker pool.
// sendEmail()/queueEmail() only INSERT a row into `email_outbox` and return
// immediately; a cPanel cron job (scripts/process-email-queue.js) claims and
// sends pending rows. Benefits: no SMTP/PDF work or worker threads in the web
// process, and queued mail survives Passenger restarts (previously it was lost).
const db = require('../config/knex');

const MAX_ATTEMPTS = parseInt(process.env.EMAIL_MAX_ATTEMPTS, 10) || 3;
// Hard cap on a single serialized row (html + base64 attachments) to keep one
// oversized attachment from bloating the table / blowing the MySQL packet size.
const MAX_ROW_BYTES = parseInt(process.env.EMAIL_MAX_ROW_BYTES, 10) || 8 * 1024 * 1024;

class EmailService {
  constructor() {
    // Process-local counters; authoritative counts come from the DB in getQueueStats().
    this.stats = { enqueued: 0, dropped: 0 };
  }

  _serializeAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return null;
    }
    const normalized = attachments.map((a) => ({
      filename: a.filename || 'attachment',
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
    }));
    return JSON.stringify(normalized);
  }

  /**
   * Enqueue an email into the durable outbox (non-blocking, never throws to
   * fire-and-forget callers). Returns { queued: true, id } or { queued: false, dropped: true }.
   * attachments: optional array of { filename, content: Buffer } (stored as base64).
   */
  async queueEmail(to, subject, html, text = null, metadata = {}, attachments = null) {
    try {
      const safeMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
      const attachmentsJson = this._serializeAttachments(attachments);

      const approxBytes =
        (html ? Buffer.byteLength(html) : 0) + (attachmentsJson ? attachmentsJson.length : 0);
      if (approxBytes > MAX_ROW_BYTES) {
        this.stats.dropped++;
        console.error(`Email payload too large (${approxBytes} bytes) for: ${to}. Dropped.`);
        return { queued: false, dropped: true };
      }

      const [id] = await db('email_outbox').insert({
        to_email: to,
        subject,
        html: html == null ? '' : html,
        text: text || null,
        metadata: Object.keys(safeMetadata).length ? JSON.stringify(safeMetadata) : null,
        attachments: attachmentsJson,
        status: 'pending',
        attempts: 0,
        max_attempts: MAX_ATTEMPTS,
        next_attempt_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      this.stats.enqueued++;
      return { queued: true, id: id != null ? String(id) : null };
    } catch (err) {
      // Never throw: callers fire-and-forget. Log so the failure is visible.
      this.stats.dropped++;
      console.error('Failed to enqueue email to', to, '-', err.message);
      return { queued: false, dropped: true };
    }
  }

  /**
   * Send email (enqueues into the outbox; delivered by the cron drainer).
   * metadata may include: type, table_name, row_id (for emaillog tracking).
   * attachments: optional array of { filename, content: Buffer }.
   */
  async sendEmail(to, subject, html, text = null, metadata = {}, attachments = null) {
    if (!to || typeof to !== 'string') {
      throw new Error('EmailService.sendEmail: "to" is required and must be a string');
    }
    if (!subject || typeof subject !== 'string') {
      throw new Error('EmailService.sendEmail: "subject" is required and must be a string');
    }
    if (html == null) {
      throw new Error('EmailService.sendEmail: "html" is required');
    }
    return this.queueEmail(to, subject, html, text, metadata, attachments);
  }

  /** Outbox stats for monitoring (counts by status). Async — reads the DB. */
  async getQueueStats() {
    try {
      const rows = await db('email_outbox')
        .select('status')
        .count({ n: '*' })
        .groupBy('status');
      const byStatus = rows.reduce((acc, r) => {
        acc[r.status] = Number(r.n);
        return acc;
      }, {});
      return {
        pending: byStatus.pending || 0,
        processing: byStatus.processing || 0,
        sent: byStatus.sent || 0,
        failed: byStatus.failed || 0,
        enqueuedThisRun: this.stats.enqueued,
        droppedThisRun: this.stats.dropped,
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Delivery mode info (no in-process workers anymore). */
  getWorkerStats() {
    return { mode: 'cron-outbox', workers: 0, note: 'Delivered by scripts/process-email-queue.js' };
  }

  async sendPasswordResetEmail(email, resetToken, name = null) {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    const subject = 'Reset Your Password';

    const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reset Your Password</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
                    .content { padding: 30px; background-color: #ffffff; }
                    .button { 
                        display: inline-block; 
                        padding: 12px 24px; 
                        background-color: #007bff; 
                        color: white; 
                        text-decoration: none; 
                        border-radius: 4px; 
                        margin: 20px 0; 
                    }
                    .footer { 
                        margin-top: 30px; 
                        padding-top: 20px; 
                        border-top: 1px solid #eee; 
                        font-size: 12px; 
                        color: #666; 
                    }
                    .token { 
                        background-color: #f8f9fa; 
                        padding: 10px; 
                        font-family: monospace; 
                        word-break: break-all; 
                        margin: 15px 0; 
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Reset Your Password</h1>
                    </div>
                    <div class="content">
                        <p>Hello ${name || 'there'},</p>
                        <p>We received a request to reset your password. Click the button below to reset it:</p>
                        
                        <div style="text-align: center;">
                            <a href="${resetUrl}" class="button">Reset Password</a>
                        </div>
                        
                        <p>Or copy and paste this link in your browser:</p>
                        <div class="token">${resetUrl}</div>
                        
                        <p>This link will expire in 1 hour.</p>
                        
                        <p>If you didn't request a password reset, please ignore this email.</p>
                        
                        <p>Best regards,<br>${process.env.APP_NAME} Team</p>
                    </div>
                    <div class="footer">
                        <p>This is an automated message. Please do not reply to this email.</p>
                        <p>© ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        `;

    return this.sendEmail(email, subject, html, null, {
      type: 'password_reset',
      resetToken: resetToken.substring(0, 10) + '...',
      name: name,
    });
  }

  async sendWelcomeCredentialsEmail(email, name = null, password) {
    const loginUrl = `${process.env.CLIENT_URL}/login`;
    const subject = `Your ${process.env.APP_NAME} Account Credentials`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Created</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f9873c; padding: 20px; text-align: center; color: #fff; border-radius: 4px 4px 0 0; }
          .content { padding: 30px; background-color: #ffffff; border: 1px solid #e0e0e0; }
          .credentials { background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 16px; margin: 20px 0; }
          .credentials p { margin: 6px 0; }
          .credentials strong { display: inline-block; width: 90px; color: #555; }
          .button { display: inline-block; padding: 12px 28px; background-color: #f9873c; color: #fff; text-decoration: none; border-radius: 4px; margin: 20px 0; font-weight: bold; }
          .warning { color: #856404; background-color: #fff3cd; border: 1px solid #ffc107; padding: 10px 14px; border-radius: 4px; font-size: 13px; margin-top: 16px; }
          .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #888; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h2 style="margin:0">Welcome to ${process.env.APP_NAME}</h2></div>
          <div class="content">
            <p>Hello ${name || 'there'},</p>
            <p>An account has been created for you. Use the credentials below to log in:</p>
            <div class="credentials">
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <div style="text-align:center">
              <a href="${loginUrl}" class="button">Log In Now</a>
            </div>
            <p class="warning">⚠️ Please change your password immediately after your first login.</p>
            <p>Best regards,<br>${process.env.APP_NAME} Team</p>
          </div>
          <div class="footer">This is an automated message. Please do not reply to this email.<br>
            © ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(email, subject, html, null, { type: 'welcome_credentials', name });
  }

  async sendPasswordChangedEmail(email, name = null) {
    const subject = 'Password Changed Successfully';

    const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Password Changed</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
                    .content { padding: 30px; background-color: #ffffff; }
                    .alert { 
                        background-color: #d4edda; 
                        border: 1px solid #c3e6cb; 
                        color: #155724; 
                        padding: 15px; 
                        border-radius: 4px; 
                        margin: 20px 0; 
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Password Changed</h1>
                    </div>
                    <div class="content">
                        <p>Hello ${name || 'there'},</p>
                        
                        <div class="alert">
                            <strong>Your password has been changed successfully.</strong>
                        </div>
                        
                        <p>If you did not make this change, please contact our support team immediately.</p>
                        
                        <p>For security reasons, we recommend:</p>
                        <ul>
                            <li>Using a strong, unique password</li>
                            <li>Enabling two-factor authentication if available</li>
                            <li>Not sharing your password with anyone</li>
                        </ul>
                        
                        <p>Best regards,<br>${process.env.APP_NAME} Team</p>
                    </div>
                </div>
            </body>
            </html>
        `;

    return this.sendEmail(email, subject, html, null, {
      type: 'password_changed',
      name: name,
    });
  }
}

module.exports = new EmailService();
