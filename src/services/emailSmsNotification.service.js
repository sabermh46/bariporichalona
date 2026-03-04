// services/NotificationService.js - uses working EmailService for email delivery
const EmailService = require('./email.service');

class NotificationService {
    async sendRentReminder(data) {
        const { email, phone, renterName, flatNumber, houseName, amount, dueDate, houseOwnerName, flatId, houseId, renterId, table_name, row_id } = data;

        const template = this.getTemplate('rent_reminder', {
            renter_name: renterName,
            flat_number: flatNumber,
            house_name: houseName,
            flat_id: flatId,
            house_id: houseId,
            renter_id: renterId,
            amount: amount,
            due_date: dueDate ? (typeof dueDate === 'object' && dueDate.toLocaleDateString ? dueDate.toLocaleDateString() : String(dueDate)) : '',
            house_owner_name: houseOwnerName || ''
        });

        const promises = [];

        if (email) {
            const metadata = {
                type: 'rent_reminder',
                renterName,
                flatNumber,
                houseName,
                amount,
                flat_id: flatId,
                house_id: houseId,
                renter_id: renterId,
                dueDate: dueDate ? String(dueDate) : null
            };
            if (table_name) metadata.table_name = table_name;
            if (row_id != null) metadata.row_id = row_id;
            promises.push(
                EmailService.sendEmail(email, template.email.subject, template.email.html, template.email.body, metadata)
                    .catch(err => console.error('Email send error:', err))
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
        const { email, phone, renterName, amount, paymentDate, flatNumber, houseName, transactionId, table_name, row_id } = data;

        const template = this.getTemplate('payment_receipt', {
            renter_name: renterName,
            amount: amount,
            payment_date: paymentDate ? (typeof paymentDate === 'object' && paymentDate.toLocaleDateString ? paymentDate.toLocaleDateString() : paymentDate) : '',
            flat_number: flatNumber,
            house_name: houseName,
            transaction_id: transactionId
        });

        const promises = [];

        if (email) {
            const metadata = {
                type: 'payment_receipt',
                renterName,
                amount,
                flatNumber,
                houseName,
                transactionId,
            };
            if (table_name) metadata.table_name = table_name;
            if (row_id != null) metadata.row_id = row_id;
            promises.push(
                EmailService.sendEmail(email, template.email.subject, template.email.html, template.email.body, metadata)
                    .catch(err => console.error('Email send error:', err))
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
        const { email, approverName, expenseAmount, description, houseName } = data;
        const appName = process.env.APP_NAME || 'Bari Porichalona';
        if (email) {
            const subject = `Expense Approval Request: ${expenseAmount} for ${houseName || 'House'}`;
            const html = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
                    <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
                        <h2 style="margin: 0; font-size: 20px;">Expense Approval Request</h2>
                    </div>
                    <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p>Dear <strong>${approverName || 'there'}</strong>,</p>
                        <p>An expense approval has been requested for review.</p>
                        <p><strong>Amount:</strong> ${expenseAmount}<br><strong>Description:</strong> ${description || 'N/A'}<br><strong>House:</strong> ${houseName || 'N/A'}</p>
                        <p>Please log in to review and approve or reject.</p>
                        <p>Best regards,<br><strong>${appName}</strong></p>
                        ${this._footer()}
                    </div>
                </div>
            `;
            await EmailService.sendEmail(email, subject, html, null, {
                type: 'expense_approval',
                expenseAmount,
                description,
                houseName
            }).catch(err => console.error('Email send error:', err));
        }
    }

    async sendAppFeeReceipt(data) {
        const { houseOwnerEmail, houseOwnerName, amount, feeType, paymentDate, houseName, table_name, row_id } = data;

        const template = this.getTemplate('app_fee_receipt', {
            owner_name: houseOwnerName,
            amount: amount,
            fee_type: feeType || 'monthly_subscription',
            payment_date: paymentDate ? (typeof paymentDate === 'object' && paymentDate.toLocaleDateString ? paymentDate.toLocaleDateString() : paymentDate) : '',
            house_name: houseName
        });

        if (houseOwnerEmail) {
            const metadata = {
                type: 'app_fee_receipt',
                houseOwnerName,
                amount,
                feeType,
                houseName
            };
            if (table_name) metadata.table_name = table_name;
            if (row_id != null) metadata.row_id = row_id;
            await EmailService.sendEmail(houseOwnerEmail, template.email.subject, template.email.html, template.email.body, metadata)
                .catch(err => console.error('Email send error:', err));
        }
    }

    /**
     * Notify web owner that a house owner/caretaker has submitted an app fee payment request (pending).
     * Uses table_name='app_fee', row_id=paymentId for emaillog.
     */
    async sendAppFeeRequestToWebOwner(data) {
        const { webOwnerEmail, houseOwnerName, houseOwnerEmail, amount, paymentId, transactionId, notes, requestedAt } = data;
        const template = this.getTemplate('app_fee_request', {
            house_owner_name: houseOwnerName,
            house_owner_email: houseOwnerEmail || '',
            amount,
            transaction_id: transactionId || 'N/A',
            notes: notes || '',
            requested_at: requestedAt ? (typeof requestedAt === 'object' && requestedAt.toLocaleDateString ? requestedAt.toLocaleDateString() : String(requestedAt)) : ''
        });
        if (webOwnerEmail) {
            const metadata = { type: 'app_fee_request', houseOwnerName, amount, paymentId };
            metadata.table_name = 'app_fee';
            metadata.row_id = paymentId;
            await EmailService.sendEmail(webOwnerEmail, template.email.subject, template.email.html, template.email.body, metadata)
                .catch(err => console.error('App fee request email error:', err));
        }
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

    _footer() {
        return `<p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">This mail is sent from Bariporichalona.com</p>`;
    }

    getTemplate(type, data) {
        const appName = process.env.APP_NAME || 'Bari Porichalona';
        const templates = {
            rent_reminder: {
                email: {
                    subject: `Rent Reminder: ${data.amount} due on ${data.due_date || 'due date'}`,
                    body: `Dear ${data.renter_name},\n\nThis is a reminder that your rent payment of ${data.amount} for ${data.house_name} - Flat ${data.flat_number} is due on ${data.due_date}.\n\n${data.house_owner_name ? `From: ${data.house_owner_name}\n\n` : ''}Please ensure payment is made on time to avoid late fees.\n\nBest regards,\n${appName}\n\nThis mail is sent from Bariporichalona.com`,
                    html: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
                        <div style="background: linear-gradient(135deg,rgb(190, 111, 68) 0%,rgb(216, 171, 98) 100%); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
                            <h2 style="margin: 0; font-size: 20px;">Rent Reminder</h2>
                        </div>
                        <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                            <p>Dear <strong>${data.renter_name}</strong>,</p>
                            <p>This is a reminder that your rent payment of <strong>${data.amount}</strong> for <strong>${data.house_name} - Flat ${data.flat_number}</strong> is due on <strong>${data.due_date}</strong>.</p>
                            ${data.house_owner_name ? `<p style="color: #4b5563;">From: <strong>${data.house_owner_name}</strong></p>` : ''}
                            <p>Please ensure payment is made on time to avoid late fees.</p>
                            <p>Best regards,<br><strong>${appName}</strong></p>
                            ${this._footer()}
                        </div>
                    </div>`
                },
                sms: `Rent Reminder: ${data.amount} for ${data.house_name} due on ${data.due_date}. Please pay on time.`
            },
            payment_receipt: {
                email: {
                    subject: `Payment Receipt: ${data.amount} - ${data.house_name || 'Rent Payment'}`,
                    body: `Dear ${data.renter_name},\n\nThank you for your payment of ${data.amount} for ${data.house_name} - Flat ${data.flat_number}.\n\nPayment Date: ${data.payment_date}\nTransaction ID: ${data.transaction_id || 'N/A'}\n\nBest regards,\n${appName}\n\nThis mail is sent from Bariporichalona.com`,
                    html: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
                        <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
                            <h2 style="margin: 0; font-size: 20px;">Payment Receipt</h2>
                        </div>
                        <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                            <p>Dear <strong>${data.renter_name}</strong>,</p>
                            <p>Thank you for your payment of <strong>${data.amount}</strong> for <strong>${data.house_name} - Flat ${data.flat_number}</strong>.</p>
                            <p><strong>Payment Date:</strong> ${data.payment_date}<br><strong>Transaction ID:</strong> ${data.transaction_id || 'N/A'}</p>
                            <p>Best regards,<br><strong>${appName}</strong></p>
                            ${this._footer()}
                        </div>
                    </div>`
                },
                sms: `Payment Receipt: ${data.amount} paid for ${data.house_name}. Thank you!`
            }
        };

        templates.app_fee_receipt = {
            email: {
                subject: `App Fee Receipt: ${data.amount} - ${data.fee_type || 'Subscription'}`,
                body: `Dear ${data.owner_name},\n\nThank you for your payment of ${data.amount} (${data.fee_type || 'subscription'}) for ${data.house_name || 'your house'}.\n\nPayment Date: ${data.payment_date}\n\nBest regards,\n${appName}\n\nThis mail is sent from Bariporichalona.com`,
                html: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
                    <div style="background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
                        <h2 style="margin: 0; font-size: 20px;">App Fee Receipt</h2>
                    </div>
                    <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p>Dear <strong>${data.owner_name}</strong>,</p>
                        <p>Thank you for your payment of <strong>${data.amount}</strong> for <strong>${data.fee_type || 'subscription'}</strong> — ${data.house_name || 'your property'}.</p>
                        <p><strong>Payment Date:</strong> ${data.payment_date}</p>
                        <p>Best regards,<br><strong>${appName}</strong></p>
                        ${this._footer()}
                    </div>
                </div>`
            },
            sms: `Payment Receipt: ${data.amount} received for ${data.fee_type || 'subscription'}. Thank you!`
        };

        templates.app_fee_request = {
            email: {
                subject: `App Fee Payment Request: ${data.amount} from ${data.house_owner_name || 'House Owner'}`,
                body: `A new app fee payment request has been submitted.\n\nHouse Owner: ${data.house_owner_name}\nEmail: ${data.house_owner_email}\nAmount: ${data.amount}\nTransaction ID: ${data.transaction_id}\nRequested: ${data.requested_at}\nNotes: ${data.notes}\n\nPlease log in to verify and accept or reject.\n\nBest regards,\n${appName}`,
                html: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
                    <div style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 24px; border-radius: 8px 8px 0 0; color: white;">
                        <h2 style="margin: 0; font-size: 20px;">App Fee Payment Request</h2>
                    </div>
                    <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                        <p>A new app fee payment request has been submitted and is awaiting your verification.</p>
                        <p><strong>House Owner:</strong> ${data.house_owner_name || 'N/A'}<br><strong>Email:</strong> ${data.house_owner_email || 'N/A'}<br><strong>Amount:</strong> ${data.amount}<br><strong>Transaction ID:</strong> ${data.transaction_id || 'N/A'}<br><strong>Requested:</strong> ${data.requested_at || 'N/A'}</p>
                        ${(data.notes && data.notes.trim()) ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
                        <p>Please log in to the dashboard to verify and accept or reject this payment.</p>
                        <p>Best regards,<br><strong>${appName}</strong></p>
                        ${this._footer()}
                    </div>
                </div>`
            },
            sms: `App fee request: ${data.amount} from ${data.house_owner_name}. Please verify.`
        };

        return templates[type] || templates.rent_reminder;
    }
}

module.exports = new NotificationService();