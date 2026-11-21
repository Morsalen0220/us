import crypto from 'node:crypto';

export function generateSubscriberTokens() {
  return {
    confirmToken: crypto.randomBytes(24).toString('hex'),
    unsubscribeToken: crypto.randomBytes(24).toString('hex')
  };
}

export function formatPhysicalAddress(settings = {}) {
  const legalName = settings.publisher_legal_name || settings.site_name || 'TechHaven US Media LLC';
  const street = settings.publisher_street_address || '';
  const city = settings.publisher_city || 'New York';
  const state = settings.publisher_state || 'NY';
  const postal = settings.publisher_postal_code || '';
  const country = settings.publisher_country || 'United States';
  return [legalName, street, city, [state, postal].filter(Boolean).join(' '), country].filter(Boolean).join(', ');
}

export function buildDoubleOptInEmail({ email, confirmUrl, unsubscribeUrl, settings = {} }) {
  const siteName = settings.site_name || 'TechHaven US';
  const addressLine = formatPhysicalAddress(settings);
  const subject = `Confirm your subscription to ${siteName}`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
      <h2 style="margin-top:0;">Confirm your ${siteName} subscription</h2>
      <p>You requested to receive US &amp; Europe technology updates, AI briefings, and practical guides at <strong>${email}</strong>.</p>
      <p style="margin:24px 0;">
        <a href="${confirmUrl}" style="background:#2563eb;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Confirm Subscription</a>
      </p>
      <p style="font-size:13px;color:#475569;">If the button does not work, copy and paste this link:<br>${confirmUrl}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0;">
      <p style="font-size:12px;color:#64748b;">
        Sent under GDPR &amp; US CAN-SPAM compliance by ${addressLine}.<br>
        Didn't request this? <a href="${unsubscribeUrl}" style="color:#2563eb;">Unsubscribe immediately in 1 click</a>.
      </p>
    </div>
  `.trim();

  const text = [
    `Confirm your subscription to ${siteName}`,
    '',
    `Confirm here: ${confirmUrl}`,
    '',
    `If you did not request this, unsubscribe immediately: ${unsubscribeUrl}`,
    `Physical Mailing Address: ${addressLine}`
  ].join('\n');

  return { subject, html, text };
}

export async function sendDoubleOptInEmail({ email, confirmUrl, unsubscribeUrl, settings = {} }) {
  const provider = String(settings.newsletter_provider || 'local').toLowerCase();
  const apiKey = String(settings.newsletter_api_key || '').trim();
  const listId = String(settings.newsletter_list_id || '').trim();
  const fromName = settings.newsletter_from_name || settings.site_name || 'TechHaven US Dispatch';
  const fromEmail = settings.newsletter_from_email || settings.contact_email || 'newsletter@techhavenus.com';
  const emailMsg = buildDoubleOptInEmail({ email, confirmUrl, unsubscribeUrl, settings });

  if (!apiKey || provider === 'local') {
    return { delivered: false, provider: 'local', confirmUrl };
  }

  try {
    if (provider === 'brevo') {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email }],
          subject: emailMsg.subject,
          htmlContent: emailMsg.html,
          textContent: emailMsg.text
        }),
        signal: AbortSignal.timeout(8000)
      });
      return { delivered: res.ok, provider: 'brevo', status: res.status };
    }

    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [email],
          subject: emailMsg.subject,
          html: emailMsg.html,
          text: emailMsg.text
        }),
        signal: AbortSignal.timeout(8000)
      });
      return { delivered: res.ok, provider: 'resend', status: res.status };
    }

    if (provider === 'buttondown') {
      const res = await fetch('https://api.buttondown.com/v1/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${apiKey}` },
        body: JSON.stringify({
          email_address: email,
          type: 'unactivated',
          tags: ['techhavenus', 'gdpr-consented']
        }),
        signal: AbortSignal.timeout(8000)
      });
      const json = await res.json().catch(() => ({}));
      return { delivered: res.ok, provider: 'buttondown', providerId: json.id || '' };
    }

    if (provider === 'mailchimp' && listId && apiKey.includes('-')) {
      const dc = apiKey.split('-').pop();
      const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
      const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
      const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members/${subscriberHash}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          email_address: email,
          status_if_new: 'pending',
          status: 'pending'
        }),
        signal: AbortSignal.timeout(8000)
      });
      const json = await res.json().catch(() => ({}));
      return { delivered: res.ok, provider: 'mailchimp', providerId: json.id || subscriberHash };
    }
  } catch (err) {
    return { delivered: false, provider, error: err.message };
  }

  return { delivered: false, provider, confirmUrl };
}

export async function syncConfirmedSubscriber(subscriber, settings = {}) {
  const provider = String(settings.newsletter_provider || 'local').toLowerCase();
  const apiKey = String(settings.newsletter_api_key || '').trim();
  const listId = String(settings.newsletter_list_id || '').trim();
  if (!apiKey || provider === 'local') return { synced: false };

  try {
    if (provider === 'brevo') {
      const payload = {
        email: subscriber.email,
        updateEnabled: true,
        attributes: { SOURCE: subscriber.source || 'website', GDPR_CONSENT: true }
      };
      if (/^\d+$/.test(listId)) payload.listIds = [Number.parseInt(listId, 10)];
      const res = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000)
      });
      return { synced: res.ok };
    }

    if (provider === 'mailchimp' && listId && apiKey.includes('-')) {
      const dc = apiKey.split('-').pop();
      const subscriberHash = crypto.createHash('md5').update(subscriber.email.toLowerCase()).digest('hex');
      const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
      const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members/${subscriberHash}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({ email_address: subscriber.email, status: 'subscribed' }),
        signal: AbortSignal.timeout(8000)
      });
      return { synced: res.ok };
    }
  } catch {
    return { synced: false };
  }
  return { synced: true };
}

export async function unsubscribeFromProvider(email, settings = {}) {
  const provider = String(settings.newsletter_provider || 'local').toLowerCase();
  const apiKey = String(settings.newsletter_api_key || '').trim();
  const listId = String(settings.newsletter_list_id || '').trim();
  if (!apiKey || provider === 'local') return;

  try {
    if (provider === 'brevo') {
      await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ emailBlacklisted: true }),
        signal: AbortSignal.timeout(6000)
      });
    } else if (provider === 'mailchimp' && listId && apiKey.includes('-')) {
      const dc = apiKey.split('-').pop();
      const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
      const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
      await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members/${subscriberHash}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({ status: 'unsubscribed' }),
        signal: AbortSignal.timeout(6000)
      });
    }
  } catch {
    // Non-blocking remote unsubscribe
  }
}
