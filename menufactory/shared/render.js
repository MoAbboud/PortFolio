// Loads a venue into its look.
//
// A venue page is a small index.html next to its venue.json:
//
//   <script type="module">
//     import { mount } from '../../shared/render.js';
//     mount();
//   </script>
//
// mount() reads venue.json, loads the look it names (looks/<look>/look.js and look.css), and
// hands the look the venue and a set of helpers. Then it adds the parts every page carries
// whatever the look: the motion button, and the preview bar on previews.
//
// ?look=<name> shows the same venue in another look - for the library, the owner's Look
// screen and the tests. Switching a venue for real is the style.look value in venue.json.

import { brand, previewBarText } from '../brand.js';
import * as hours from './hours.js';
import { initMotion, getMotion, onMotionChange, mountMotionButton } from './motion.js';
import { inquiryLink } from './inquiry.js';

const LIB = new URL('./lib/', import.meta.url);
const loaded = new Map();

function addStylesheet(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
  return new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

/** Loads a classic script once; resolves when it has run. */
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`could not load ${src}`)), { once: true });
      document.head.append(script);
    }));
  }
  return loaded.get(src);
}

/** Escapes text for use inside HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function priceFormatter(venue) {
  const format = new Intl.NumberFormat(venue.language ?? 'en-US', { style: 'currency', currency: venue.currency ?? 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (amount) => format.format(amount);
}

function directionsUrl(location) {
  const address = [location.street, location.city, location.region, location.postal_code, location.country].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function showError(root, message) {
  document.documentElement.classList.remove('js');
  if (document.querySelector('[data-prerendered]')) {
    root.remove();
    return;
  }
  root.innerHTML = `<div class="load-error"><h1>This page could not load</h1><p>${esc(message)}</p></div>`;
}

export async function mount({ venueUrl = './venue.json', host = document.body } = {}) {
  initMotion();
  // The look renders into its own container, so it can replace everything it owns without
  // touching the preview bar or the motion button.
  const root = document.createElement('div');
  root.className = 'look-root';
  host.append(root);
  const sharedCss = addStylesheet(new URL('./shared.css', import.meta.url));
  const venueHref = new URL(venueUrl, document.baseURI);

  let venue;
  try {
    const response = await fetch(venueHref, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`venue.json answered ${response.status}`);
    venue = await response.json();
  } catch (error) {
    await sharedCss;
    showError(root, error.message);
    mountMotionButton();
    return;
  }

  // A seasonal menu past its last day is not shown (the content check also flags it).
  const todayHere = hours.localNow(new Date(), venue.locations[0].time_zone).date;
  venue = { ...venue, menus: venue.menus.filter((m) => !m.until || m.until >= todayHere) };

  const lookName = new URLSearchParams(location.search).get('look') || venue.style?.look;
  const lookBase = new URL(`../looks/${encodeURIComponent(lookName)}/`, import.meta.url);
  const place = venue.locations[0];
  const now = () => new Date();
  const timers = [];

  const ctx = {
    venue,
    location: place,
    lookName,
    esc,
    price: priceFormatter(venue),
    directions: directionsUrl(place),
    tel: place.phone ? `tel:${place.phone.replace(/[^\d+]/g, '')}` : null,
    // Calling in comes first: "Call to order" keeps the order off the delivery apps (P43).
    callLabel: venue.phone_orders ? 'Call to order' : 'Call',
    orderUrl: venue.order_url ?? null,
    reserveUrl: venue.reserve_url ?? null,
    // The private event inquiry (P47), when the venue takes them: fields in, mailto: link out.
    privateEvents: venue.private_events ?? null,
    inquiryLink: (fields) => inquiryLink(venue, fields),
    /** Opens the guest's email app with the inquiry written. Announced first, for the checks. */
    sendInquiry(fields) {
      const link = inquiryLink(venue, fields);
      document.dispatchEvent(new CustomEvent('inquiry', { detail: link }));
      window.location.href = link;
    },
    asset: (file) => new URL(file, venueHref).href,
    lookAsset: (file) => new URL(file, lookBase).href,
    hours,
    now,
    today: () => hours.localNow(now(), place.time_zone).date,
    openLine: () => hours.describeOpen(hours.openStatus(place, now())),
    happyHourLine: () => hours.describeHappyHour(hours.happyHourStatus(place, now())),
    happyHourOn: () => hours.happyHourStatus(place, now()).on,
    notices: () => (venue.notices ?? []).filter((n) => hours.isShowing(n, ctx.today())),
    events: (limit) => hours.upcomingEvents(venue.events, ctx.today(), limit),
    /** Runs fn now and again every minute, for the live lines. */
    live(fn) {
      fn();
      timers.push(setInterval(fn, 60_000));
    },
    motion: { get level() { return getMotion(); }, onChange: onMotionChange },
    /** GSAP with ScrollTrigger, loaded once from shared/lib/. */
    async gsap() {
      await loadScript(new URL('gsap.min.js', LIB).href);
      await loadScript(new URL('ScrollTrigger.min.js', LIB).href);
      window.gsap.registerPlugin(window.ScrollTrigger);
      return window.gsap;
    },
    /** Three.js as an ES module, loaded only when a look asks for it. */
    three: () => import(new URL('three/three.module.js', LIB).href),
  };

  let look;
  try {
    [look] = await Promise.all([import(new URL('look.js', lookBase).href), addStylesheet(new URL('look.css', lookBase)), sharedCss]);
  } catch (error) {
    showError(root, `The look "${lookName}" could not be loaded.`);
    mountMotionButton();
    return;
  }

  document.title = venue.name;
  document.documentElement.lang = venue.language ?? 'en-US';
  document.documentElement.dataset.look = lookName;

  if (venue.mode === 'preview') {
    const bar = document.createElement('div');
    bar.className = 'preview-bar';
    bar.setAttribute('role', 'note');
    bar.innerHTML = `${esc(previewBarText(venue.name))} <a href="${esc(brand.site)}">See the other looks</a>`;
    host.prepend(bar);
  }

  await look.render(root, venue, ctx);
  mountMotionButton();
  // The look has drawn: the plain pre-rendered copy (P41) is no longer needed on screen.
  document.querySelector('[data-prerendered]')?.remove();
  document.documentElement.dataset.mounted = '1';
}
