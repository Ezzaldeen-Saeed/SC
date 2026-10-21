/**
 * @module services/email.service
 * @description Outbound email via SMTP (nodemailer). Currently used to deliver
 * password-reset OTP codes.
 *
 * Email is treated as optional infrastructure. When SMTP credentials are absent
 * (config.smtp.enabled === false) nothing is sent — the code is written to the
 * server log instead and the caller is told delivery didn't happen. That keeps
 * local dev and the reset flow working without a mailbox.
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

/** @type {import('nodemailer').Transporter|null} Lazily built, then reused. */
let transporter = null;

/**
 * Build (once) and return the SMTP transporter, or null when SMTP isn't configured.
 * @returns {import('nodemailer').Transporter|null}
 */
function getTransporter() {
  if (!config.smtp.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

/**
 * Verify the SMTP connection and credentials. Called once at startup so a bad
 * App Password surfaces in the log immediately instead of on a user's first
 * reset attempt. Never throws — a dead mailbox must not stop the server booting.
 * @returns {Promise<boolean>} True when SMTP is configured and reachable.
 */
async function verifyConnection() {
  const tx = getTransporter();
  if (!tx) {
    logger.warn(
      'SMTP not configured — password-reset codes will be printed to this log instead of emailed. ' +
        'Set SMTP_HOST/SMTP_USER/SMTP_PASS in backend/.env to enable delivery.'
    );
    return false;
  }
  try {
    await tx.verify();
    logger.info('SMTP ready', { host: config.smtp.host, port: config.smtp.port, user: config.smtp.user });
    return true;
  } catch (err) {
    logger.error('SMTP verification failed — password-reset emails will not send', { error: err.message });
    return false;
  }
}

/**
 * HTML body for the OTP email. Inline styles only: mail clients strip <style>.
 * @param {string} code - The 6-digit code.
 * @param {string} name - Recipient's display name.
 * @param {number} ttlMinutes - Validity window, in minutes.
 * @returns {string}
 */
function otpTemplate(code, name, ttlMinutes) {
  return `
<div dir="rtl" style="margin:0;padding:32px 16px;background:#f0f4fd;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.08);">

    <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:28px 32px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">SCM</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:4px;">Smart Call Monitor</div>
    </div>

    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">إعادة تعيين كلمة المرور</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#475569;">
        مرحبًا ${name}، وصلنا طلب لإعادة تعيين كلمة المرور الخاصة بحسابك.
        استخدم الكود التالي لإكمال العملية:
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:1px;margin-bottom:10px;">كود التحقق</div>
        <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#2563eb;font-family:'Courier New',monospace;direction:ltr;">${code}</div>
        <div style="font-size:12px;color:#64748b;margin-top:12px;">صالح لمدة ${ttlMinutes} دقائق فقط</div>
      </div>

      <p style="margin:0 0 8px;font-size:13px;line-height:1.8;color:#475569;">
        لو مش إنت اللي طلبت إعادة التعيين، تجاهل الرسالة دي — كلمة المرور الحالية هتفضل زي ما هي.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.8;color:#ef4444;font-weight:600;">
        لا تشارك هذا الكود مع أي شخص.
      </p>
    </div>

    <div style="border-top:1px solid #f1f5f9;padding:16px 32px;text-align:center;">
      <div style="font-size:11px;color:#94a3b8;">© 2026 SCM — Smart Call Monitor · رسالة آلية، برجاء عدم الرد عليها</div>
    </div>

  </div>
</div>`.trim();
}

/**
 * Send a password-reset OTP.
 *
 * Resolves with `delivered:false` (rather than throwing) when SMTP is unconfigured,
 * so the caller can still complete the request and surface a dev hint.
 * A genuine send failure DOES throw — the user must not be told to check an inbox
 * that will stay empty.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient address.
 * @param {string} params.code - The 6-digit code.
 * @param {string} [params.fullName] - Recipient's display name.
 * @returns {Promise<{ delivered: boolean }>}
 * @throws {Error} If SMTP is configured but the send fails.
 */
async function sendPasswordResetOtp({ to, code, fullName }) {
  const name = fullName || to;
  const ttl = config.otp.ttlMinutes;
  const tx = getTransporter();

  if (!tx) {
    logger.warn(`[DEV] SMTP disabled — password-reset code for ${to} is: ${code} (valid ${ttl}m)`);
    return { delivered: false };
  }

  await tx.sendMail({
    from: config.smtp.from,
    to,
    subject: `${code} — كود إعادة تعيين كلمة المرور | SCM`,
    text: `كود إعادة تعيين كلمة المرور الخاص بك هو: ${code}\nالكود صالح لمدة ${ttl} دقائق.\nلا تشارك هذا الكود مع أي شخص.`,
    html: otpTemplate(code, name, ttl),
  });

  logger.info('Password-reset OTP emailed', { to });
  return { delivered: true };
}

module.exports = { sendPasswordResetOtp, verifyConnection };
