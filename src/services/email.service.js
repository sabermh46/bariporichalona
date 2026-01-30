// src/services/email.service.js
const nodemailer = require('nodemailer');
const db = require('../config/knex');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    async sendEmail(to, subject, html, text = null, metadata = {}) {
        try {
            const mailOptions = {
                from: `"${process.env.APP_NAME}" <${process.env.SMTP_FROM}>`,
                to,
                subject,
                html,
                text: text || html.replace(/<[^>]*>/g, '')
            };

            const info = await this.transporter.sendMail(mailOptions);
            
            // Log the email
            await db('emaillog').insert({
                type: metadata.type || 'general',
                toEmail: to,
                subject,
                content: html,
                status: 'sent',
                metadata: JSON.stringify({
                    ...metadata,
                    messageId: info.messageId,
                    envelope: info.envelope
                }),
                sentAt: new Date()
            });

            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Email send error:', error);
            
            // Log failed email
            await db('emaillog').insert({
                type: metadata.type || 'general',
                toEmail: to,
                subject,
                content: html,
                status: 'failed',
                error: error.message,
                metadata: JSON.stringify(metadata),
                sentAt: new Date()
            });

            throw error;
        }
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
            resetToken: resetToken.substring(0, 10) + '...', // Store partial token
            name: name
        });
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
            name: name
        });
    }
}

module.exports = new EmailService();