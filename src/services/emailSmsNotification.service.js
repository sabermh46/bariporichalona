// services/NotificationService.js - uses working EmailService for email delivery
const fs = require('fs');
const path = require('path');
const EmailService = require('./email.service');

// Read logo once at module load — avoids a synchronous disk read on every email.
let _cachedLogoDataUri = undefined; // undefined = not yet resolved
function _resolveLogoDataUri() {
    if (_cachedLogoDataUri !== undefined) return _cachedLogoDataUri;

    const explicitBase64 = process.env.APP_LOGO_BASE64;
    if (explicitBase64) {
        _cachedLogoDataUri = explicitBase64.startsWith('data:')
            ? explicitBase64
            : `data:image/png;base64,${explicitBase64}`;
        return _cachedLogoDataUri;
    }

    const logoPath = process.env.APP_LOGO_PATH;
    if (logoPath) {
        try {
            const resolvedPath = path.isAbsolute(logoPath)
                ? logoPath
                : path.resolve(process.cwd(), logoPath);
            if (fs.existsSync(resolvedPath)) {
                const extension = path.extname(resolvedPath).replace('.', '').toLowerCase() || 'png';
                const mimeType = extension === 'svg'
                    ? 'image/svg+xml'
                    : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
                _cachedLogoDataUri = `data:${mimeType};base64,${fs.readFileSync(resolvedPath).toString('base64')}`;
                return _cachedLogoDataUri;
            }
        } catch (error) {
            console.warn('[NotificationService] Failed to load logo asset:', error.message);
        }
    }

    _cachedLogoDataUri = null;
    return null;
}

class NotificationService {
    _formatDate(value) {
        if (!value) return '';
        if (typeof value === 'object' && value.toLocaleDateString) {
            return value.toLocaleDateString();
        }
        return String(value);
    }

    _getLogoDataUri() {
        return _resolveLogoDataUri();
    }

    _buildBrandHeader(title, subtitle) {
        const logoDataUri = this._getLogoDataUri();
        const logoMarkup = logoDataUri
            ? `<img src="${logoDataUri}" alt="${process.env.APP_NAME || 'Bari Porichalona'}" style="display:block; max-width:120px; max-height:48px; object-fit:contain; margin-bottom:14px;" />`
            : `<div style="display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,0.18); color:#ffffff; font-size:20px; font-weight:700; letter-spacing:0.5px; margin-bottom:14px;">BP</div>`;

        return `
            <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 52%, #0f172a 100%); padding: 28px 28px 24px; border-radius: 18px 18px 0 0; color: #ffffff;">
                ${logoMarkup}
                <div style="font-family: 'Segoe UI', Arial, sans-serif;">
                    <div style="font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.85; margin-bottom: 8px;">${process.env.APP_NAME || 'Bari Porichalona'}</div>
                    <h2 style="margin: 0; font-size: 24px; line-height: 1.2; font-weight: 700;">${title}</h2>
                    ${subtitle ? `<p style="margin: 10px 0 0; font-size: 14px; line-height: 1.5; opacity: 0.9;">${subtitle}</p>` : ''}
                </div>
            </div>
        `;
    }

    _buildReportCard(label, value, accent = '#0f766e') {
        return `
            <div style="flex: 1 1 150px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px 18px; min-width: 150px;">
                <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 8px;">${label}</div>
                <div style="font-size: 18px; font-weight: 700; color: ${accent}; line-height: 1.2;">${value}</div>
            </div>
        `;
    }

    _buildMoneyRow(label, value, emphasis = false) {
        return `
            <tr>
                <td style="padding: 10px 0; color: #374151; font-size: 14px; ${emphasis ? 'font-weight:700;' : ''}">${label}</td>
                <td style="padding: 10px 0; text-align: right; color: #111827; font-size: 14px; ${emphasis ? 'font-weight:700;' : ''}">${value}</td>
            </tr>
        `;
    }

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
            due_date: this._formatDate(dueDate),
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
        const { email, phone, renterName, amount, paymentDate, flatNumber, houseName, houseAddress, ownerEmail, ownerPhone, transactionId, table_name, row_id, pdfBuffer } = data;

        const template = this.getTemplate('payment_receipt', {
            renter_name: renterName,
            amount: amount,
            payment_date: this._formatDate(paymentDate),
            flat_number: flatNumber,
            house_name: houseName,
            house_address: houseAddress || null,
            owner_email: ownerEmail || null,
            owner_phone: ownerPhone || null,
            transaction_id: transactionId,
            status: data.status || 'paid',
            base_rent: data.breakdown?.baseRent || 0,
            amenities: data.breakdown?.amenities || 0,
            late_fee: data.breakdown?.lateFee || 0,
            total_amount: amount,
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
            const attachments = pdfBuffer && Buffer.isBuffer(pdfBuffer)
                ? [{ filename: 'invoice.pdf', content: pdfBuffer }]
                : null;
            promises.push(
                EmailService.sendEmail(email, template.email.subject, template.email.html, template.email.body, metadata, attachments)
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
                email: (() => {
                    const subject = `Payment Receipt: ${data.amount} - ${data.house_name || 'Rent Payment'}`;
                    const totalAmount = Number(data.total_amount || data.amount || 0);
                    const baseRent = Number(data.base_rent || 0);
                    const amenities = Number(data.amenities || 0);
                    const lateFee = Number(data.late_fee || 0);

                    return {
                        subject,
                        body: `Dear ${data.renter_name},\n\nYour rent payment has been recorded successfully.\n\nHouse: ${data.house_name || 'N/A'}\nFlat: ${data.flat_number || 'N/A'}\nPayment Date: ${data.payment_date || 'N/A'}\nTransaction ID: ${data.transaction_id || 'N/A'}\nTotal Paid: ${totalAmount.toFixed(2)}\n\nBest regards,\n${appName}\n\nThis mail is sent from Bariporichalona.com`,
                        html: `
                            <div style="background:#eef2f7; padding:24px 12px;">
                                <div style="max-width: 680px; margin: 0 auto; font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);">
                                    ${this._buildBrandHeader('Payment Receipt', 'Rent payment recorded successfully and summarized below.')}
                                    <div style="padding: 24px 28px 28px;">
                                        <div style="margin-bottom: 22px; display: flex; flex-wrap: wrap; gap: 12px;">
                                            ${this._buildReportCard('Renter', data.renter_name || 'N/A', '#0f766e')}
                                            ${this._buildReportCard('House', data.house_name || 'N/A', '#0f766e')}
                                            ${this._buildReportCard('Flat', data.flat_number != null ? String(data.flat_number) : 'N/A', '#0f766e')}
                                            ${this._buildReportCard('Status', String(data.status || 'paid').toUpperCase(), '#0f766e')}
                                        </div>

                                        <div style="border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; background: #f8fafc; margin-bottom: 20px;">
                                            <table style="width: 100%; border-collapse: collapse;">
                                                ${this._buildMoneyRow('Payment Date', data.payment_date || 'N/A')}
                                                ${this._buildMoneyRow('Transaction ID', data.transaction_id || 'N/A')}
                                                ${this._buildMoneyRow('Base Rent', `BDT ${baseRent.toFixed(2)}`)}
                                                ${amenities > 0 ? this._buildMoneyRow('Amenities', `BDT ${amenities.toFixed(2)}`) : ''}
                                                ${lateFee > 0 ? this._buildMoneyRow('Late Fee', `BDT ${lateFee.toFixed(2)}`) : ''}
                                                ${this._buildMoneyRow('Total Paid', `BDT ${totalAmount.toFixed(2)}`, true)}
                                            </table>
                                        </div>

                                        ${(data.house_address || data.owner_email || data.owner_phone) ? `
                                        <div style="border: 1px solid #d1fae5; border-radius: 16px; padding: 16px 20px; background: #f0fdf4; margin-bottom: 20px;">
                                            <p style="margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #065f46; letter-spacing: 0.05em; text-transform: uppercase;">Property &amp; Owner Details</p>
                                            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #1f2937;">
                                                ${data.house_address ? `<tr><td style="padding: 5px 0; color: #6b7280; width: 130px;">Address</td><td style="padding: 5px 0;">${data.house_address}</td></tr>` : ''}
                                                ${data.owner_email ? `<tr><td style="padding: 5px 0; color: #6b7280;">Owner Email</td><td style="padding: 5px 0;"><a href="mailto:${data.owner_email}" style="color: #0f766e; text-decoration: none;">${data.owner_email}</a></td></tr>` : ''}
                                                ${data.owner_phone ? `<tr><td style="padding: 5px 0; color: #6b7280;">Owner Phone</td><td style="padding: 5px 0;">${data.owner_phone}</td></tr>` : ''}
                                            </table>
                                        </div>` : ''}

                                        <div style="padding: 18px 20px; border-left: 4px solid #14b8a6; background: #ecfeff; border-radius: 12px; color: #134e4a; margin-bottom: 22px;">
                                            <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.6;">Dear <strong>${data.renter_name || 'there'}</strong>, your payment has been recorded successfully.</p>
                                            <p style="margin: 0; font-size: 14px; line-height: 1.6;">Please keep this email for your records. A PDF invoice may also be attached when enabled.</p>
                                        </div>

                                        <p style="margin: 0; font-size: 14px; line-height: 1.7;">Best regards,<br><strong>${appName}</strong></p>
                                        ${this._footer()}
                                    </div>
                                </div>
                            </div>
                        `,
                    };
                })(),
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