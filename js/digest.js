// The weekly digest shown at the bottom of the home page. Stored in
// settings/digest by the Claude digest routine; see docs/data-model.md.
export function cleanDigest(x, toDate = v => v) {
  if (!x) return null;
  const list = v => (Array.isArray(v) ? v : []);
  const sections = list(x.sections).map(s => ({
    heading: String(s?.heading || ''),
    items: list(s?.items)
      .map(i => (typeof i === 'string' ? { when: '', text: i } : { when: String(i?.when || ''), text: String(i?.text || '') }))
      .filter(i => i.text)
  })).filter(s => s.items.length);
  return { title: String(x.title || ''), updatedAt: toDate(x.updatedAt) || null, sections };
}
