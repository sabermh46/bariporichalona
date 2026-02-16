// services/NotificationService.js
const nodemailer = require('nodemailer');

class NotificationService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE || false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    async sendRentReminder(data) {
        const { email, phone, renterName, flatNumber, houseName, amount, dueDate, daysBefore } = data;

        const template = this.getTemplate('rent_reminder', {
            renter_name: renterName,
            flat_number: flatNumber,
            house_name: houseName,
            amount: amount,
            due_date: dueDate.toLocaleDateString(),
            days_before: daysBefore
        });

        const promises = [];

        if (email) {
            promises.push(
                this.sendEmail({
                    to: email,
                    subject: template.email.subject,
                    text: template.email.body,
                    html: template.email.html
                }).catch(err => console.error('Email send error:', err))
            );
        }

        if (phone) {
            promises.push(
                this.sendSMS({
                    to: phone,
                    message: template.sms
                }).catch(err => console.error('SMS send error:', err))
            );
        }

        await Promise.all(promises);
    }

    async sendPaymentReceipt(data) {
        const { email, phone, renterName, amount, paymentDate, flatNumber, houseName, transactionId } = data;

        const template = this.getTemplate('payment_receipt', {
            renter_name: renterName,
            amount: amount,
            payment_date: paymentDate.toLocaleDateString(),
            flat_number: flatNumber,
            house_name: houseName,
            transaction_id: transactionId
        });

        const promises = [];

        if (email) {
            promises.push(
                this.sendEmail({
                    to: email,
                    subject: template.email.subject,
                    text: template.email.body,
                    html: template.email.html
                }).catch(err => console.error('Email send error:', err))
            );
        }

        if (phone) {
            promises.push(
                this.sendSMS({
                    to: phone,
                    message: template.sms
                }).catch(err => console.error('SMS send error:', err))
            );
        }

        await Promise.all(promises);
    }

    async sendExpenseApprovalRequest(data) {
        // This would typically send to web_owner or house owner
        // Implementation depends on your user structure
        console.log('Expense approval requested:', data);
    }

    async sendAppFeeReceipt(data) {
        const { houseOwnerEmail, houseOwnerName, amount, feeType, paymentDate, houseName } = data;

        const template = this.getTemplate('app_fee_receipt', {
            owner_name: houseOwnerName,
            amount: amount,
            fee_type: feeType,
            payment_date: paymentDate.toLocaleDateString(),
            house_name: houseName
        });

        if (houseOwnerEmail) {
            await this.sendEmail({
                to: houseOwnerEmail,
                subject: template.email.subject,
                text: template.email.body,
                html: template.email.html
            }).catch(err => console.error('Email send error:', err));
        }
    }

    async sendEmail({ to, subject, text, html }) {
        const mailOptions = {
            from: process.env.SMTP_FROM || '"Rental Management" <noreply@example.com>',
            to,
            subject,
            text,
            html: html || text
        };

        return this.transporter.sendMail(mailOptions);
    }

    async sendSMS({ to, message }) {
        // Implement SMS sending using Twilio, Vonage, or local provider
        console.log(`SMS to ${to}: ${message}`);
        // Example with Twilio:
        // const client = require('twilio')(accountSid, authToken);
        // return client.messages.create({
        //     body: message,
        //     from: process.env.TWILIO_PHONE,
        //     to: to
        // });
    }

    getTemplate(type, data) {
        const templates = {
            rent_reminder: {
                email: {
                    subject: `Rent Reminder: ${data.amount} due in ${data.days_before} days`,
                    body: `Dear ${data.renter_name},\n\nThis is a reminder that your rent payment of ${data.amount} for ${data.house_name} - Flat ${data.flat_number} is due on ${data.due_date}.\n\nPlease ensure payment is made on time to avoid late fees.\n\nBest regards,\nManagement`,
                    html: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
                        <h2>Rent Reminder</h2>
                        <p>Dear ${data.renter_name},</p>
                        <p>This is a reminder that your rent payment of <strong>${data.amount}</strong> for <strong>${data.house_name} - Flat ${data.flat_number}</strong> is due on <strong>${data.due_date}</strong>.</p>
                        <p>Please ensure payment is made on time to avoid late fees.</p>
                        <p>Best regards,<br>Management</p>
                    </div>`
                },
                sms: `Rent Reminder: ${data.amount} for ${data.house_name} due on ${data.due_date}. Please pay on time.`
            },
            payment_receipt: {
                email: {
                    subject: `Payment Receipt: ${data.amount}`,
                    body: `Dear ${data.renter_name},\n\nThank you for your payment of ${data.amount} for ${data.house_name} - Flat ${data.flat_number}.\n\nPayment Date: ${data.payment_date}\nTransaction ID: ${data.transaction_id || 'N/A'}\n\nBest regards,\nManagement`,
                    html: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
                        <h2>Payment Receipt</h2>
                        <p>Dear ${data.renter_name},</p>
                        <p>Thank you for your payment of <strong>${data.amount}</strong> for <strong>${data.house_name} - Flat ${data.flat_number}</strong>.</p>
                        <p><strong>Payment Date:</strong> ${data.payment_date}<br>
                        <strong>Transaction ID:</strong> ${data.transaction_id || 'N/A'}</p>
                        <p>Best regards,<br>Management</p>
                    </div>`
                },
                sms: `Payment Receipt: ${data.amount} paid for ${data.house_name}. Thank you!`
            }
        };

        return templates[type] || templates.rent_reminder;
    }
}

module.exports = new NotificationService();