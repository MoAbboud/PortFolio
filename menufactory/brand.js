// Everything that names the product lives here and nowhere else.
//
// "Menu Factory" is a working name; the author is still choosing the real one. A rename is a
// change to this file and nothing more - tests/brand.test.js fails if the name is spelled out
// anywhere in looks/, shared/, library/, admin/ or venues/.

export const brand = {
  name: 'Menu Factory',
  owner: 'Mohamad Abboud',
  site: 'https://moabboud.dev/menufactory/library/',
  contact: 'https://moabboud.dev',
};

/** The wording of the bar on every preview page. */
export function previewBarText(venueName) {
  return `Unofficial preview of ${venueName}, made by ${brand.owner} for ${brand.name}. This is not ${venueName}'s own website.`;
}
