// The private event inquiry (P47): turns what a guest filled in into an email to the venue,
// opened in the guest's own email app. The site stores nothing and sends nothing itself.

/** A mailto: link with the subject and body already written. */
export function inquiryLink(venue, fields) {
  const to = venue.private_events.email;
  const lines = [
    `Hello ${venue.name},`,
    '',
    `I'd like to ask about a private event.`,
    '',
    `Date: ${fields.date || 'not decided yet'}`,
    `Guests: ${fields.guests || 'not sure yet'}`,
    `Budget: ${fields.budget || 'open'}`,
    fields.details ? `\n${fields.details}` : null,
    '',
    `${fields.name || ''}`.trim() || null,
    fields.contact ? `Reach me at: ${fields.contact}` : null,
  ].filter((l) => l !== null);
  const subject = `Private event${fields.date ? ` on ${fields.date}` : ''}${fields.guests ? ` for ${fields.guests}` : ''}`;
  return `mailto:${encodeURIComponent(to).replace('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
