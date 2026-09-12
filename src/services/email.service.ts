import nodemailer from 'nodemailer';
import { env } from '../config/env';

/**
 * Builds the transporter on every call rather than once at module-load
 * time. This avoids a subtle bug where dotenv hasn't finished populating
 * process.env yet at the moment this module is first imported (especially
 * under ts-node-dev's respawn behavior), which would otherwise bake in
 * empty SMTP settings permanently for the life of the process.
 */
function buildTransporter() {
  const options: nodemailer.TransportOptions = {
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  } as nodemailer.TransportOptions;

  // Forces IPv4-only connections. Without this, Node may try the SMTP
  // host's IPv6 address first and fail with ENETUNREACH on networks where
  // IPv6 routing is broken or unavailable (common on many home/ISP
  // setups), even though the IPv4 route works fine.
  //
  // @types/nodemailer doesn't declare "family" on its Options type, but
  // Nodemailer's SMTPConnection forwards its options object directly to
  // Node's net.connect/tls.connect, both of which accept it natively --
  // see https://nodejs.org/api/net.html#socketconnectoptions-connectlistener
  // This cast is a deliberate, narrow escape hatch for that specific gap,
  // not a way to bypass the type system generally.
  (options as Record<string, unknown>).family = 4;

  return nodemailer.createTransport(options);
}

/**
 * Builds the HTML body for the account-creation email.
 * Inline styles only -- most email clients (Gmail, Outlook, etc.) strip
 * <style> blocks or ignore external CSS, so every style has to live on
 * the element itself to render consistently.
 */
function buildHtmlBody(fullName: string, toEmail: string, tempPassword: string): string {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

            <!-- Header -->
            <tr>
              <td style="background-color: #1f2d50; padding: 28px 32px;">
                <span style="color: #ffffff; font-size: 18px; font-weight: 600; letter-spacing: 0.2px;">
                  BCC Training Department
                </span>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 32px;">
                <h1 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">
                  Your account has been created
                </h1>
                <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #4a4a4a;">
                  Hello ${escapeHtml(fullName)},<br/><br/>
                  An administrator has created an account for you on the
                  <strong>BCC Disciples</strong> system. Use the credentials
                  below to sign in for the first time.
                </p>

                <!-- Credentials box -->
                <table role="presentation" width="100%" style="background-color: #f4f5f7; border-radius: 8px; margin-bottom: 24px;">
                  <tr>
                    <td style="padding: 18px 20px;">
                      <p style="margin: 0 0 10px; font-size: 13px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.4px;">
                        Email
                      </p>
                      <p style="margin: 0 0 18px; font-size: 15px; color: #1a1a1a; font-weight: 500;">
                        ${escapeHtml(toEmail)}
                      </p>
                      <p style="margin: 0 0 10px; font-size: 13px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.4px;">
                        Temporary password
                      </p>
                      <p style="margin: 0; font-size: 16px; color: #1a1a1a; font-weight: 600; font-family: 'Courier New', Courier, monospace; letter-spacing: 0.5px;">
                        ${escapeHtml(tempPassword)}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #6b6b6b;">
                  For your security, you'll be asked to set a new password and
                  complete your profile the first time you log in.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color: #1f2d50; border-radius: 8px;">
                      <a href="${escapeHtml(env.clientUrl)}"
                         style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">
                        Log in to BCC Disciples
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 20px 32px; border-top: 1px solid #ececec;">
                <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #9a9a9a;">
                  If you did not expect this email, please contact your administrator.
                  This is an automated message from the BCC Disciples system.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/** Minimal HTML-escaping for values interpolated into the templates in this file. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildResetHtmlBody(fullName: string, resetUrl: string): string {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

            <tr>
              <td style="background-color: #1f2d50; padding: 28px 32px;">
                <span style="color: #ffffff; font-size: 18px; font-weight: 600; letter-spacing: 0.2px;">
                  BCC Training Department
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding: 32px;">
                <h1 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">
                  Reset your password
                </h1>
                <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #4a4a4a;">
                  Hello ${escapeHtml(fullName)},<br/><br/>
                  We received a request to reset the password for your
                  <strong>BCC Disciples</strong> account. Click the button
                  below to choose a new password.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                  <tr>
                    <td style="background-color: #1f2d50; border-radius: 8px;">
                      <a href="${escapeHtml(resetUrl)}"
                         style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">
                        Reset my password
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #9a9a9a;">
                  This link expires in 1 hour and can only be used once.
                  If you didn't request this, you can safely ignore this
                  email -- your password will stay unchanged.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding: 20px 32px; border-top: 1px solid #ececec;">
                <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #9a9a9a;">
                  This is an automated message from the BCC Disciples system.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/**
 * Security notice sent to the OLD email address whenever an account's
 * email is changed. Deliberately sent to the address being REPLACED, not
 * the new one -- the whole point is to alert whoever actually owns that
 * old inbox, in case they weren't the one who made the change. It does
 * not include a way to undo the change (there's no revert token/flow in
 * this system yet); it tells them to contact an administrator instead.
 */
function buildEmailChangedHtmlBody(fullName: string, oldEmail: string, newEmail: string): string {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

            <tr>
              <td style="background-color: #1f2d50; padding: 28px 32px;">
                <span style="color: #ffffff; font-size: 18px; font-weight: 600; letter-spacing: 0.2px;">
                  BCC Training Department
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding: 32px;">
                <h1 style="margin: 0 0 16px; font-size: 20px; color: #1a1a1a;">
                  Your account email was changed
                </h1>
                <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #4a4a4a;">
                  Hello ${escapeHtml(fullName)},<br/><br/>
                  The email address on your <strong>BCC Disciples</strong>
                  account was just changed from this address to:
                </p>

                <table role="presentation" width="100%" style="background-color: #f4f5f7; border-radius: 8px; margin-bottom: 24px;">
                  <tr>
                    <td style="padding: 16px 20px;">
                      <p style="margin: 0; font-size: 15px; color: #1a1a1a; font-weight: 600;">
                        ${escapeHtml(newEmail)}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.6; color: #4a4a4a;">
                  <strong>If you made this change,</strong> no action is needed --
                  simply sign in from now on using your new email address.
                </p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #CC1111;">
                  <strong>If you did NOT make this change,</strong> please contact
                  your system administrator immediately, since someone else may
                  have access to your account.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding: 20px 32px; border-top: 1px solid #ececec;">
                <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #9a9a9a;">
                  This is an automated security notice from the BCC Disciples system.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

export async function sendTempPasswordEmail(
  toEmail: string,
  fullName: string,
  tempPassword: string
): Promise<void> {
  const subject = 'BCC Account Creation';

  // Plain-text fallback -- shown by clients/screen readers that don't
  // render HTML, and helps avoid spam filters that penalize HTML-only mail.
  const text =
    `Hello ${fullName},\n\n` +
    `An administrator has created an account for you on the BCC Disciples system.\n\n` +
    `Email: ${toEmail}\n` +
    `Temporary password: ${tempPassword}\n\n` +
    `Please log in and you will be asked to set a new password and complete your profile.\n\n` +
    `If you did not expect this email, please contact your administrator.`;

  const html = buildHtmlBody(fullName, toEmail, tempPassword);

  if (!env.smtp.host) {
    // In local/dev setups without SMTP configured, log instead of failing the request.
    console.log(`[email:dev-mode] Would send to ${toEmail}:\n${text}`);
    return;
  }

  const transporter = buildTransporter();

  // Throws on failure -- callers (seed.service.ts, adminUser.controller.ts)
  // are responsible for catching this and deciding what the user sees.
  // We deliberately do NOT swallow errors here: a silently failed email
  // means someone has an account with credentials nobody received.
  const info = await transporter.sendMail({
    from: env.smtp.fromAddress,
    to: toEmail,
    subject,
    text,
    html,
  });

  console.log(`[email] Sent temp-password email to ${toEmail} (messageId: ${info.messageId})`);
}

export async function sendPasswordResetEmail(
  toEmail: string,
  fullName: string,
  resetUrl: string
): Promise<void> {
  const subject = 'Reset your BCC Disciples password';

  const text =
    `Hello ${fullName},\n\n` +
    `We received a request to reset the password for your BCC Disciples account.\n\n` +
    `Reset your password using this link: ${resetUrl}\n\n` +
    `This link expires in 1 hour and can only be used once.\n` +
    `If you didn't request this, you can safely ignore this email.`;

  const html = buildResetHtmlBody(fullName, resetUrl);

  if (!env.smtp.host) {
    console.log(`[email:dev-mode] Would send to ${toEmail}:\n${text}`);
    return;
  }

  const transporter = buildTransporter();

  const info = await transporter.sendMail({
    from: env.smtp.fromAddress,
    to: toEmail,
    subject,
    text,
    html,
  });

  console.log(`[email] Sent password reset email to ${toEmail} (messageId: ${info.messageId})`);
}

/**
 * Sends the "your email was changed" security notice to the OLD address.
 * Called by authController.changeEmail AFTER the change has already been
 * saved to the database -- this is purely a notification, not a
 * confirmation gate. The caller wraps this in its own try/catch and logs
 * failures without failing the request, matching the pattern used for
 * forgotPassword's reset email above.
 */
export async function sendEmailChangedNotice(
  oldEmail: string,
  fullName: string,
  newEmail: string
): Promise<void> {
  const subject = 'Your BCC Disciples account email was changed';

  const text =
    `Hello ${fullName},\n\n` +
    `The email address on your BCC Disciples account was just changed from this address to: ${newEmail}\n\n` +
    `If you made this change, no action is needed.\n\n` +
    `If you did NOT make this change, please contact your system administrator immediately, ` +
    `since someone else may have access to your account.`;

  const html = buildEmailChangedHtmlBody(fullName, oldEmail, newEmail);

  if (!env.smtp.host) {
    console.log(`[email:dev-mode] Would send to ${oldEmail}:\n${text}`);
    return;
  }

  const transporter = buildTransporter();

  const info = await transporter.sendMail({
    from: env.smtp.fromAddress,
    to: oldEmail,
    subject,
    text,
    html,
  });

  console.log(`[email] Sent email-changed notice to ${oldEmail} (messageId: ${info.messageId})`);
}