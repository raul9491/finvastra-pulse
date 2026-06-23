import { describe, it, expect } from 'vitest';
import { extractWhatsAppMessages, extractWhatsAppStatuses } from './whatsapp';

const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA123', changes: [{ field: 'messages', value }] }],
});

describe('extractWhatsAppMessages', () => {
  it('parses a text message + contact name + metadata', () => {
    const out = extractWhatsAppMessages(envelope({
      metadata: { display_phone_number: '919247519004', phone_number_id: 'PN1' },
      contacts: [{ profile: { name: 'Ravi Kumar' }, wa_id: '919876543210' }],
      messages: [{ from: '919876543210', id: 'wamid.AAA', timestamp: '1718000000', type: 'text', text: { body: 'Need a home loan' } }],
    }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      waMessageId: 'wamid.AAA', from: '919876543210', phoneNumberId: 'PN1',
      type: 'text', text: 'Need a home loan', mediaId: null, contactName: 'Ravi Kumar',
    });
  });

  it('parses media (image) → mediaId + caption, strips + from from', () => {
    const out = extractWhatsAppMessages(envelope({
      metadata: { phone_number_id: 'PN1' },
      messages: [{ from: '+91 98765 43210', id: 'wamid.IMG', timestamp: '1', type: 'image', image: { id: 'media99', caption: 'My salary slip' } }],
    }));
    expect(out[0]).toMatchObject({ from: '919876543210', type: 'image', mediaId: 'media99', text: 'My salary slip' });
  });

  it('parses an interactive button reply title as text', () => {
    const out = extractWhatsAppMessages(envelope({
      messages: [{ from: '919876543210', id: 'wamid.INT', type: 'interactive', interactive: { button_reply: { id: 'b1', title: 'Yes, interested' } } }],
    }));
    expect(out[0].text).toBe('Yes, interested');
  });

  it('ignores non-WABA objects and non-messages changes', () => {
    expect(extractWhatsAppMessages({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: {} }] }] })).toHaveLength(0);
    expect(extractWhatsAppMessages(envelope({ statuses: [{ id: 'x', status: 'sent' }] }))).toHaveLength(0);
    expect(extractWhatsAppMessages(null)).toHaveLength(0);
  });

  it('skips messages missing id or from', () => {
    const out = extractWhatsAppMessages(envelope({
      messages: [
        { id: 'wamid.NO_FROM', type: 'text', text: { body: 'hi' } },
        { from: '919876543210', type: 'text', text: { body: 'hi' } },
        { from: '919876543210', id: 'wamid.OK', type: 'text', text: { body: 'ok' } },
      ],
    }));
    expect(out).toHaveLength(1);
    expect(out[0].waMessageId).toBe('wamid.OK');
  });
});

describe('extractWhatsAppStatuses', () => {
  it('parses delivery-status updates for outbound messages', () => {
    const out = extractWhatsAppStatuses(envelope({
      statuses: [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '919876543210', timestamp: '123' }],
    }));
    expect(out).toEqual([{ waMessageId: 'wamid.OUT', status: 'delivered', recipientId: '919876543210', timestamp: '123' }]);
  });

  it('returns [] when there are no statuses', () => {
    expect(extractWhatsAppStatuses(envelope({ messages: [] }))).toHaveLength(0);
  });
});
