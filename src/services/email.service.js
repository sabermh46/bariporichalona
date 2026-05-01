// src/services/email.service.js
const { getEmailWorkerPool } = require('../utils/emailWorkerPool');

const MAX_RETRIES = 3;
const CONCURRENT_SENDS = 2;

class EmailService {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.stats = { queued: 0, sent: 0, failed: 0 };
    this._jobId = 0;
  }

  _nextId() {
    return `email-${Date.now()}-${++this._jobId}`;
  }

  _createJob(to, subject, html, text, metadata, attachments = null) {
    const job = {
      id: this._nextId(),
      to,
      subject,
      html,
      text: text || null,
      metadata: metadata || {},
      retryCount: 0,
    };
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      job.attachments = attachments.map((a) => ({
        filename: a.filename || "attachment",
        content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
      }));
    }
    return job;
  }

  /**
   * Queue an email for delivery (non-blocking).
   * Returns immediately with { queued: true, id }.
   * attachments: optional array of { filename, content: Buffer } (content serialized as base64 for worker).
   */
  queueEmail(to, subject, html, text = null, metadata = {}, attachments = null) {
    const safeMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
    const job = this._createJob(to, subject, html, text, safeMetadata, attachments);
    this.queue.push(job);
    this.stats.queued++;
    this._processQueue();
    return { queued: true, id: job.id };
  }

  /**
   * Send email (default: queued, fire-and-forget).
   * metadata may include: type, table_name, row_id (for emaillog tracking), and other fields.
   * attachments: optional array of { filename, content: Buffer } to attach to the email.
   */
  async sendEmail(to, subject, html, text = null, metadata = {}, attachments = null) {
    if (!to || typeof to !== "string") {
      throw new Error('EmailService.sendEmail: "to" is required and must be a string');
    }
    if (!subject || typeof subject !== "string") {
      throw new Error('EmailService.sendEmail: "subject" is required and must be a string');
    }
    if (!html && html !== "") {
      throw new Error('EmailService.sendEmail: "html" is required');
    }
    return this.queueEmail(to, subject, html, text, metadata, attachments);
  }

  async _processQueue() {
    if (this.processing.size >= CONCURRENT_SENDS || this.queue.length === 0) return;

    const job = this.queue.shift();
    this.processing.add(job.id);

    const pool = getEmailWorkerPool();

    pool.execute("sendEmail", {
      to: job.to,
      subject: job.subject,
      html: job.html,
      text: job.text,
      metadata: job.metadata,
      attachments: job.attachments || null,
    }).then((result) => {
      this.stats.sent++;
      console.log('Email sent to', job.to, result?.messageId || '');
    }).catch((err) => {
      if (job.retryCount < MAX_RETRIES) {
        job.retryCount++;
        this.queue.unshift(job);
        console.warn(`Email retry ${job.retryCount}/${MAX_RETRIES} for ${job.to}:`, err.message);
      } else {
        this.stats.failed++;
        console.error('Email failed after retries:', job.to, err.message);
      }
    }).finally(() => {
      this.processing.delete(job.id);
      this._processQueue();
    });
  }

  /** Queue stats for monitoring */
  getQueueStats() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      sent: this.stats.sent,
      failed: this.stats.failed,
    };
  }

  /** Worker pool stats (workers, queue length, etc.) */
  getWorkerStats() {
    return getEmailWorkerPool().getStats();
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
