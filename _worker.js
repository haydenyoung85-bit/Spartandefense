var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/auth.js
var COOKIE_NAME = "mss_admin";
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}
__name(textToBase64Url, "textToBase64Url");
function base64UrlToText(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
__name(base64UrlToText, "base64UrlToText");
async function signature(payload, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signed));
}
__name(signature, "signature");
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}
__name(safeEqual, "safeEqual");
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}
__name(getCookie, "getCookie");
async function createSession(username, secret) {
  const payload = textToBase64Url(JSON.stringify({ username, expires: Date.now() + 8 * 60 * 60 * 1e3 }));
  return `${payload}.${await signature(payload, secret)}`;
}
__name(createSession, "createSession");
async function isAuthenticated(request, env) {
  const secret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
  if (!secret) return false;
  const token = getCookie(request, COOKIE_NAME);
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = await signature(payload, secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const session = JSON.parse(base64UrlToText(payload));
    return session.username === (env.ADMIN_USERNAME || "modernspartansd") && session.expires > Date.now();
  } catch {
    return false;
  }
}
__name(isAuthenticated, "isAuthenticated");
function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
}
__name(sessionCookie, "sessionCookie");
function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
__name(clearSessionCookie, "clearSessionCookie");
function unauthorized() {
  return Response.json({ ok: false, error: "Please sign in again." }, { status: 401 });
}
__name(unauthorized, "unauthorized");

// _lib/http.js
var NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE_HEADERS });
}
__name(json, "json");
function storageUnavailable() {
  return json({ ok: false, error: "Website storage has not been connected in Cloudflare yet." }, 503);
}
__name(storageUnavailable, "storageUnavailable");
function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}
__name(cleanText, "cleanText");

// api/photos/[id].js
async function onRequestGet({ params, env }) {
  if (!env.SITE_DATA) return new Response("Not found", { status: 404 });
  const result = await env.SITE_DATA.getWithMetadata(`photo:${params.id}`, "arrayBuffer");
  if (!result.value) return new Response("Not found", { status: 404 });
  return new Response(result.value, { headers: { "Content-Type": result.metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
__name(onRequestGet, "onRequestGet");
async function onRequestDelete({ request, params, env }) {
  if (!await isAuthenticated(request, env)) return unauthorized();
  if (!env.SITE_DATA) return storageUnavailable();
  await env.SITE_DATA.delete(`photo:${params.id}`);
  const photos = await env.SITE_DATA.get("photos:index", "json") || [];
  await env.SITE_DATA.put("photos:index", JSON.stringify(photos.filter((photo) => photo.id !== params.id)));
  return json({ ok: true });
}
__name(onRequestDelete, "onRequestDelete");

// api/contact.js
async function onRequestPost({ request, env }) {
  if (!env.SITE_DATA) return storageUnavailable();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Please check the form and try again." }, 400);
  }
  if (body.website) return json({ ok: true });
  const lead = {
    id: crypto.randomUUID(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    name: cleanText(body.name, 100),
    phone: cleanText(body.phone, 40),
    email: cleanText(body.email, 150),
    message: cleanText(body.message, 1500),
    freeClass: Boolean(body.freeClass)
  };
  if (!lead.name || !lead.phone || !lead.email || !lead.message) return json({ ok: false, error: "Please complete every required field." }, 400);
  await env.SITE_DATA.put(`lead:${lead.createdAt}:${lead.id}`, JSON.stringify(lead));
  return json({ ok: true, message: "Thanks. Modern Spartan will be in touch soon." });
}
__name(onRequestPost, "onRequestPost");

// _lib/defaults.js
var DEFAULT_CONTENT = {
  business: {
    name: "Modern Spartan Self-Defense",
    location: "513 N. B Street, Eufaula, OK",
    locationNote: "Inside TNT Fitness",
    phone: "(918) 470-1458",
    phoneHref: "+19184701458",
    email: "modernspartanselfdefense@gmail.com",
    instagram: "modernspartansd"
  },
  hero: {
    eyebrow: "Eufaula, Oklahoma \xB7 At TNT Fitness",
    title: "Train for what doesn\u2019t come with rules.",
    text: "Krav Maga, Carlos Machado Jiu-Jitsu, and women\u2019s self-defense\u2014taught right here in Eufaula."
  },
  about: {
    kicker: "Built in Eufaula",
    title: "No ego. No shortcuts. Useful training.",
    text: "We opened Modern Spartan so people around Eufaula could learn to protect themselves without driving hours or walking into a room full of attitude. Classes are coached, practical, and built to meet beginners where they are.",
    quote: "Show up willing to work. We\u2019ll take care of the rest."
  },
  programs: [
    { name: "Adult Krav Maga", tag: "Practical self-defense", description: "Direct, pressure-tested training built around awareness, striking, escapes, and getting home safe.", details: "Adults \xB7 All experience levels \xB7 2\u20133 classes each week" },
    { name: "Carlos Machado Jiu-Jitsu", tag: "Control under pressure", description: "Technical grappling that develops composure, leverage, control, and the ability to solve problems from difficult positions.", details: "Adults \xB7 Beginner friendly \xB7 Rank development" },
    { name: "Spartan Legacy", tag: "Women\u2019s self-defense", description: "Focused training for women who want stronger awareness, practical responses, and confidence that carries beyond the gym.", details: "Women \xB7 Saturdays at 11:00 AM" },
    { name: "Complete Training", tag: "Stand-up and ground", description: "Combine Krav Maga and Carlos Machado Jiu-Jitsu for a broader skill set and more weekly training.", details: "Unlimited CMJJ plus all scheduled Krav Maga classes" }
  ],
  pricing: [
    { name: "Carlos Machado Jiu-Jitsu", details: "Unlimited CMJJ training", price: "$100", suffix: "/ month", featured: false },
    { name: "Adult Krav Maga", details: "Unlimited \xB7 2\u20133 classes each week", price: "$100", suffix: "/ month", featured: false },
    { name: "Krav Maga + CMJJ", details: "Both programs in one membership", price: "$125", suffix: "/ month", featured: true }
  ],
  schedule: {
    month: "September",
    note: "Schedules update monthly. Select Sunday and Friday dates are announced by the academy.",
    days: [
      { day: "Sundays", detail: "Specific dates", classes: [{ time: "3:00 PM", name: "CMJJ Rank Evaluation / Test Prep" }] },
      { day: "Wednesdays", detail: "", classes: [{ time: "6:00 PM", name: "Adult Krav Maga" }, { time: "7:00 PM", name: "Carlos Machado Jiu-Jitsu" }] },
      { day: "Select Fridays", detail: "", classes: [{ time: "6:00 PM", name: "Adult Krav Maga" }, { time: "7:00 PM", name: "Carlos Machado Jiu-Jitsu" }] },
      { day: "Saturdays", detail: "", classes: [{ time: "11:00 AM", name: "Spartan Legacy (Women\u2019s Self-Defense)" }, { time: "12:00 PM", name: "Adult Krav Maga" }, { time: "1:00 PM", name: "Carlos Machado Jiu-Jitsu" }] }
    ]
  },
  seminar: {
    label: "Community training",
    title: "College-bound safety seminars",
    text: "Practical awareness and personal-safety training for students preparing to leave home."
  }
};
function normalizeContent(value) {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_CONTENT);
  return {
    ...structuredClone(DEFAULT_CONTENT),
    ...value,
    business: { ...DEFAULT_CONTENT.business, ...value.business || {} },
    hero: { ...DEFAULT_CONTENT.hero, ...value.hero || {} },
    about: { ...DEFAULT_CONTENT.about, ...value.about || {} },
    schedule: { ...DEFAULT_CONTENT.schedule, ...value.schedule || {} },
    seminar: { ...DEFAULT_CONTENT.seminar, ...value.seminar || {} },
    programs: Array.isArray(value.programs) ? value.programs.slice(0, 8) : DEFAULT_CONTENT.programs,
    pricing: Array.isArray(value.pricing) ? value.pricing.slice(0, 8) : DEFAULT_CONTENT.pricing
  };
}
__name(normalizeContent, "normalizeContent");

// api/content.js
async function onRequestGet2({ env }) {
  if (!env.SITE_DATA) return json({ ok: true, content: DEFAULT_CONTENT, usingDefaults: true });
  const saved = await env.SITE_DATA.get("site:content", "json");
  return json({ ok: true, content: normalizeContent(saved) });
}
__name(onRequestGet2, "onRequestGet");
async function onRequestPut({ request, env }) {
  if (!await isAuthenticated(request, env)) return unauthorized();
  if (!env.SITE_DATA) return storageUnavailable();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid content." }, 400);
  }
  const content = normalizeContent(body.content);
  content.business.name = cleanText(content.business.name, 100);
  content.business.location = cleanText(content.business.location, 160);
  content.business.locationNote = cleanText(content.business.locationNote, 100);
  content.business.phone = cleanText(content.business.phone, 30);
  content.business.phoneHref = cleanText(content.business.phoneHref, 30);
  content.business.email = cleanText(content.business.email, 150);
  content.business.instagram = cleanText(content.business.instagram, 80).replace(/^@/, "");
  await env.SITE_DATA.put("site:content", JSON.stringify(content));
  return json({ ok: true, content });
}
__name(onRequestPut, "onRequestPut");

// api/leads.js
async function onRequestGet3({ request, env }) {
  if (!await isAuthenticated(request, env)) return unauthorized();
  if (!env.SITE_DATA) return storageUnavailable();
  const listed = await env.SITE_DATA.list({ prefix: "lead:", limit: 100 });
  const leads = (await Promise.all(listed.keys.map((key) => env.SITE_DATA.get(key.name, "json")))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ ok: true, leads });
}
__name(onRequestGet3, "onRequestGet");
async function onRequestDelete2({ request, env }) {
  if (!await isAuthenticated(request, env)) return unauthorized();
  if (!env.SITE_DATA) return storageUnavailable();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ ok: false, error: "Missing request ID." }, 400);
  const listed = await env.SITE_DATA.list({ prefix: "lead:", limit: 100 });
  const key = listed.keys.find((item) => item.name.endsWith(`:${id}`));
  if (!key) return json({ ok: false, error: "Request not found." }, 404);
  await env.SITE_DATA.delete(key.name);
  return json({ ok: true });
}
__name(onRequestDelete2, "onRequestDelete");

// api/login.js
async function onRequestPost2({ request, env }) {
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: "Admin password has not been configured in Cloudflare." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }
  const username = String(body.username || "").trim();
  const expectedUsername = env.ADMIN_USERNAME || "modernspartansd";
  if (username !== expectedUsername || String(body.password || "") !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "Incorrect username or password." }, 401);
  }
  const token = await createSession(expectedUsername, env.SESSION_SECRET || env.ADMIN_PASSWORD);
  return new Response(JSON.stringify({ ok: true, username: expectedUsername }), {
    headers: { ...Object.fromEntries(Object.entries({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })), "Set-Cookie": sessionCookie(token) }
  });
}
__name(onRequestPost2, "onRequestPost");

// api/logout.js
function onRequestPost3() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie() }
  });
}
__name(onRequestPost3, "onRequestPost");

// api/photos/index.js
async function photoIndex(env) {
  return await env.SITE_DATA.get("photos:index", "json") || [];
}
__name(photoIndex, "photoIndex");
async function onRequestGet4({ env }) {
  if (!env.SITE_DATA) return json({ ok: true, photos: [] });
  return json({ ok: true, photos: await photoIndex(env) });
}
__name(onRequestGet4, "onRequestGet");
async function onRequestPost4({ request, env }) {
  if (!await isAuthenticated(request, env)) return unauthorized();
  if (!env.SITE_DATA) return storageUnavailable();
  const form = await request.formData();
  const file = form.get("photo");
  const caption = String(form.get("caption") || "Academy training").trim().slice(0, 120);
  if (!(file instanceof File) || !file.type.startsWith("image/")) return json({ ok: false, error: "Choose an image file." }, 400);
  if (file.size > 4 * 1024 * 1024) return json({ ok: false, error: "Photos must be smaller than 4 MB." }, 413);
  const id = crypto.randomUUID();
  const metadata = { id, caption, type: file.type, size: file.size, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  await env.SITE_DATA.put(`photo:${id}`, await file.arrayBuffer(), { metadata: { type: file.type } });
  const photos = await photoIndex(env);
  photos.unshift(metadata);
  await env.SITE_DATA.put("photos:index", JSON.stringify(photos.slice(0, 24)));
  return json({ ok: true, photo: metadata });
}
__name(onRequestPost4, "onRequestPost");

// api/session.js
async function onRequestGet5({ request, env }) {
  const authenticated = await isAuthenticated(request, env);
  return json({ ok: true, authenticated, username: authenticated ? env.ADMIN_USERNAME || "modernspartansd" : null });
}
__name(onRequestGet5, "onRequestGet");

// _lib/embedded.js
var ADMIN_HTML = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n  <meta name="robots" content="noindex,nofollow">\n  <meta name="theme-color" content="#08090a">\n  <title>Modern Spartan \u2014 Website Admin</title>\n  <style>\n    :root{--bg:#08090a;--panel:#111416;--panel2:#171a1d;--line:#30353a;--text:#f1f2f2;--muted:#959ba0;--red:#9a1b23;--red2:#c23a43;--ok:#4f9e72;--warn:#e3b35d}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:linear-gradient(135deg,#08090a,#0d1012);color:var(--text);font:16px/1.45 "Helvetica Neue",Arial,sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}.hidden{display:none!important}.shell{min-height:100svh}.login{min-height:100svh;display:grid;place-items:center;padding:1.25rem}.login-card{width:min(430px,100%);padding:1.5rem;border:1px solid var(--line);border-top:4px solid var(--red);background:var(--panel);box-shadow:0 30px 90px rgba(0,0,0,.45)}.helmet{width:56px;height:68px;margin-bottom:1rem;background:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAHeCAYAAADtpLM4AACAAElEQVR42u2dZ5wkV3W3n9Mzs0m70kpahV3liMgZbEwwYDBgwMgkY4NJNuDXgAUYY0ywMTmb4JxthMk5BxNFEEEooRxXq7BaxV1tnOn7fjhV3dXVlTvOzP/5qbUz3RVu3a6pc+6JIIQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIcT0MgeYGdby1ygxM8y65zAg8SvWt33WMVK/J/ZLHz9JKzWOsvN09msZc3NzI50XIZYrs5MegBDLmQWYI4Q7gx1Orwzuka2JnwPQ9l25Erg0ei+P9cA9gbW+mbXjYwRoWyAk9k+evx1Cz/stwEJ3e4sGkzVG0sdMDjCEkLyO5IetxL6+UWBnu90+G9g5qe9IiKWKFAAhJkiAX8Xs74FN9Av95L+p3QjApQYvC/C9nMOvMnhVgD8CVoSAmXXEbawIxMdLCnOAYBbL6lzhDtECPoBFGxsZCkny2OYHDonzdj5KnyOEcEW73X4arugIIYaIFAAhJkiAjRbC0cBqrCtM488zpG5yZX2fAE8HfgTsyzj8ugAPBw7GBb6FWKSDYRAybAfxIELIkeb911Bpu872oXjLxLEM2BFCuH0kky/EMkcKgBCT5fIAtwBr6K62OxSIyvijjcAKshWAEL0fMg4X8g6elM+VhfoQJyR1rEuBW4d4eCFERGvwQwghmmKwxYxrLdvUn7NLz89p83ySfcAdpCwKtUINPbDPrPdcnVfe+0UvyxhGTvDgPPDLVasylRshxIBIARBistwSApeGSDBmiUHLfyvgQrKdc+x9uHWhs6hORvxVIgQjFQ04MJbxU7ZbYCdwyfz8UA0MQogIKQBCTJAAe4ALgYWawjl2lW/Gj5HFPmB7g2H1WBZ6/QZ9469/zb07Wc5xDLgZuGJ+vsFJhBClSAEQYrK0MS4CdudtkCNkDTfvn4GnBGYfG/bWHE+lRb5Zwx2rn9PMbAtwXfPDCiGKUBCgEJMmcAm+2t0PT7/rC/kHd8eHgOFm/63A54DvFh6ZUv+5pX+psqrPstgPaKdPujWic4SrgR2DHVYIkYcUACEmz3XA1cDRZGfJGV6Y50bgHOBreO7/Lyk28ccWgCzZnLlgH5azvUiRKFEy4nEtRNe6GyHESJACIMTkuRW4GHhwxmexL/4HwOuAc1bALTXs+vtyjjlSeiwXGe9VYAdwXv3dhBBVkQIgxISZg33zcH5w035P2fzEz5uBHwJ7M4R/vE9WNsDQU+jM8oL2s0lmEBQFOqYKAN0EXD7ssQshuigIUIgJM+/y9AI87S1vdX4kcEDOZ8cDx+Z8toshrqLzQva7H+ZTpaJggquAG4c1biFEP1IAhJgwUSndK/HAvqya+wE4AtiQc4ijgftmfWBmdxgsDMvmX5iqWMGxX4PLAJUAFmKESAEQYgoIcD2+6oV+JSDgq//DsvY1aBncBZjpP3DYHmB+0o70muefB85mBO4LIUQXKQBCTAe3A+cmfk8vmtcBp2TtGLy17z3IdhHcjgvUXKz2ByMj1hNuwzMcJq23CLGkkQIgxHSwgCsAe6FbFzghg+eAk8la5buAPwE4JuOzW0mspFPHBJqZ9AckkO9NMOAa86wIIcQIkQIgxPRwAb76tRC1401IyBZu5l+bsd9e4EDgbukPgufRz0MUZR8YSl3/AfYtqiYcH/YS88JIQogRIgVAiOlhC3BtzmcB2ASsz/hsDy48707KQhAFAIb4AMMiLbVtMG0iWK9V4Ly2Z0QIIUaIFAAhpocbKTZ9bwSOy3h/N27mPwVYk/wgwN6Q0w9gWApBoF5dgKwDJHbfAZw1pKEJIQqQAiDE9LDbPPp9gWxT+Vqy/fy7DO4wOBazdKrgXrrldMcWVFfFIJDTT+gmPAVQCDFipAAIMT0E4GIzduV8vgK4M/1/tzuDvzYSwtGpz5IKQKOqvE3M+5UaCmWcCrgEd4UIIUaMFAAhpogAl4fALWQvolu4BWBF6v19eMW/dcCdUp/tpRsj0GxMY7IbmNEGzkcdAIUYC1IAhJgurse7A+YJ7BOBg5JvRIJzD10LQbLHxx7otShEB566HPsQ2Ic3AJof9FhCiHKkAAgxXdwCXJTzWQAOBw5Jvb9g1ukjcIq5JSAm6QLoHGTUNDA3GF606JIxDE8IgRQAIaaNXXhBoKxVcMDTAI/veTOwEEInbe7I0FsRsE12l8D4eLkMktlXtdZA6vPrzDrlkIUQI0YKgBDTRcDN4DvIlp+rcTdAjOHKwm24oD8YrxcQfxboVgKstfgfiqWg9wr6Dhl6t7yEwLahzKIQohQpAEJMH5cDN8S/pKLwW3jFv1WJ9+bxGgIB2J/eVMFYOQgDFetJUOcwFQMIDVdeLgoqACTE2JACIMTUYVvNuJJI1qaEqOEWgKSfP+Cug4AHAp5E9297Hi+rG0IYTnufMpluzXbbg8c+TF1wohBLFSkAQkwZZmF7CLnCMABHAel8/9jMP4NXBFwZbdvGg+tCTuGdwcr4Vrme8o/N4DY1ABJivEgBEGLKCIF5PB9+X/L9RPregbgSkOQOusF+R+OuAKL37qDfGm+J8432eqptdi35fRCEECNACoAQU4iZXWapQMCEIF2Jt/9NLq634WZ0gCOBwxK7pTMKRrrmD5Xe6h1HgEsCCgAUYpxIARBiOrk85BcEmsMD/WboCtfb6Db9WW/WYyFoM310risqZHQhXQVGCDEGpAAIMYWEELYBl8cO8gwt4Gg8JTDmVroKwH4hcNfEZzvJjgEYJ0aO5SEE9uAKwMJkhyjE8kIKgBDTyQ7g7JAfCHiMGesT7+2ma+qfwYsFzQGYcRuwb5zh9RZ1CaY7/uTP1rsptwJXjnF4QgikAAgxrcQFgXaGfi0gAIeH0GPmX4hesXA9iShVMARuorcfQCBlEcixMjQee4ay0SYV1Jg49w1mds3IZ1QI0YMUACGml4vx1XGWbD4AOC7x+y4SRXTMqwEeGP26nVQ/AOhVKkJoloCfMbCQs9k1wFlZxwiBKwjh1lFNohAiGykAQkwv1+OCM0sBWIErAPFnu+gqCyHAoeaZAtDrHqhMFYtARaXBgEvxgkStjEP8MniqohBijEgBEGJ6uRkXnH2YW+2PJPLz4wI+rgYY8ADBjdFn+6iQCZAW+FUb+mQdJw5ejGjjiszqjKJDO4GzUQVAIcaOFAAhppe9wDlkrd4NA44F1kTvzOMr/ViQzoVurYBKCkCo+X53KKU7zuNtjg/NKGt8C3DZGOZSCJFCCoAQ00swswvwVXKPnI189kfg3f/AhfweM4s3bNHNBNiDKxNe+nfYg+z91ZLh/9G5tuPujAMzdr8atw4IIcaMFAAhppsLiQoCZQjuw+n2BJgHdobeJfZJwAbcMrCTSFYnTftZykBZbwCr8Vnwt7ZE59+P/vTAy/FeBUKIMSMFQIgpJoSwlchEnmGKXxPFAYArANcAC4mA/qNxK8Ee3NSel4ufOmezsVr0/5QCYdH4V+PuiuTRFwzORRUAhZgIUgCEmG62AxdkvB+AVQHujAvZNrCVrq8/4A2BTsTrA+xM7myJjfKo6ypw7SKkFYgFfJV/GDCbOv4uPMhRAYBCTAApAEJMN23gl7gZPy2TDbcArIh+3xFtH2+3CncDQNclb/EvHVNAhs3fqCaVC90B/uFe3AJweMau24CLJjOtQggpAEJMPxfgzX7SGB7od0D0+y66Ff5iYX8svvLuuvz9/x35HjJs/kXCP1TcLgoAuAl3TRxpvec1YDNutRBCTAApAEJMOS0XlFmR8gE4FDf1g5v526H7meHFglaTKMNrOVI7lbtfi6yAwuCnug5f6R+U0DMCRghwUfDYBCHEBJACIMSU0/aCQJen3zdf7e+P+9fBrQR7enflcDz9bjuR5b8o3z/54ZDSBa+ODrXWYqXEMALzeK+D2hUKhRDDQQqAENPPbjxavqddbuTHX4fX/ceMbVifq2ADrgTcWvekdSLzQu/2Sd3hSjz6f13X54DhpX8vqHRwIcRIkAIgxPTTBi4ho6EPHgB4ImAhcBuBHfQG+a/F3QCxBSCPns+augJS7DVvaLSBqGJh4rBbgavGPZFCiC5SAIRYHFxO9ip+Frg7sNLMdplZ0gVguIJwV7rWgzzR3ldpsIwK9YLuCJ4BsCkaZ3zYuDvgjROaSyEEUgCEWCxci5fT7ZG7kV/9eGB9CGGeEPam9mvhPQHmGHK+fYWD3Yyv9E+gm4kQ6KY2bh//NAohYqQACLE4uAW3AvQtvKNqgEeYsQfrRNUntzsSrwlQ2hCoDmUWAIMrzOwWul0JY51hH97kaB9CiIkhBUCIxcEuEoGACSd/iAIBjwTmQ+hzEwRgg2GHMSQFIK+HQPq8AS4IIbSIghQT3I7HNAghJogUACEWB23g57jZPJ3Kvxa4Twi0SRUMigT1+kC4B/1/741cAuluPp1z9WoFe4CfAiuB9XT1BgNuMAUACjFxpAAIsXi4FI8DSNPCewLMWrfpD/gPAS8EdGe6fvgkWbK8NskSg7gucKv5Kv8Qg/2tt0LhFVGFQCHEBJECIMTi4QY8qj7LAn8ScEDIzhQwPAiwyHI/kBLgRYSSpf64PngFwyNxC0Vy0wuD1wEQQkwQKQBCLBJasDPKq88S1hvwssC7GXKwX0Ouwn39R4SoWVE06D3AL0OqqJEQYvxIARBikTDjUfPnW3/0fAAOAo4zzwJoKlwbWwEyTAsX48rIscBcIv//tugzIcSEkQIgxCJhHghuPr+Ffpm7Ehe2uyhOr8sU8oMW/ksddA9wIR5zcGjqNFvw/gBCiAkjBUCIRUIkZK/AiwJZ6qMZ4E4hsAvYS81gv5D5YzGW//Z2XAFYg8cAWOLDS1vqACjEVCAFQIjFxU3A+TmfHYOvvuNywBVT9vto5ApInOjaVostePrfwYnjtQOcH9xKIYSYMFIAhFhc7MHL6Gb5+Y8F9sMj7JOCfyi9fdIHSWsJid+vbLe5ERf++yc22Y37/6chSFGIZY8UACEWH+fQn0YXcH/7oWSssLOW9HW0glSefxYh8W8cALgRr1IYotPdZHDRUBsSCCEaIwVAiMXH1XijnXQcwDq89e+OKgcp6PjXJ+nTef6JDZOxBcGMeayzyt+EByfGx9gS4LpJT54QwpECIMTi4xo8GLBDJLHngMOp0WWvaZBATEolMAK3EbgUD0o8im71QcMtAwoAFGJKkAIgxOLjDrzMbmf1nRDEx+Hm98ZkKQQZ7oLMdgDBqxVeiRf/OR5XBMBjFi5DHQCFmBqkAAix+NiLdwacz/jscNz8ng60s87/UiSK9Bj9jYZ8m54qv4VZApcC2/AUwLgGgJmP+UKG0HdACDEcpAAIsTi5AC+1m44DOAA3u2cpB30m+1DPC1AmvANumbgDOBBXRuLz3I67LoQQU4IUACEWJ1cCN2a8fwAufMtS7YaRGZg+4F66aX7ro1esNGwmFbcghJgsUgCEWJxsAy4HLOWgX4mb3ssEfN02wGXbGnCbdev874cHJcbnOR8FAAoxVUgBEGJxsoPYpx5CUtrPAEfgboDM9P/4fzVNAKWbB7gBs83Rr0cAq6MxLOC1CwYKThRCDBcpAEIsThZwBWAv9Eh6wwVvLLCTSkBHiI8oEu/yEMK26OdNwKro5+149UIhxBQhBUCIxctFeHvduv78ONq/yX55nwSMi4Cd+HPlkMT2N+ExC0KIKUIKgBCLl83A9eQL5kxL/4DFf7J3Dey2wPl49sEq4OjEtpfj9QGEEFOEFAAhFi834cI1i1wZXzf6rwIGbA/dscRtgOPTXEqN6oRCiPEgBUCIxctOPLp+0t31DLgW71EAnomwX/TzPvKLFgkhJogUACEWLwu4cN3N8PL6mxoIrqKb5ncQXgMAPFvhsslNkRAiDykAQixuLsQLAg29sE8N2rglIm5RfBhdBWArKgAkxFQiBUCIxc0WKqywbXjqQZZ1YKfBL+i6ItbgRYAAtpjZTZOdIiFEFlIAhFjc3AqcRYnZPtQ36oeM3/MKC91kZpck3ltJ1yJxWQhhx6QnSQjRjxQAIRY346iy1yP4rfdnM+OaEML1ibc34RaAebxWgVoACzGFSAEQYpFjxkWYFwQaciBAsITwzyotGPx/1+Dd/sBLER+FKwC78O6AQogpRAqAEIucELiSwJXUb++bheW9keNFaAe4IMCe6PcW3o3QDG4xzw4QQkwhUgCEWPzcTn4gYK73v0BLsIpbWtQC+DK6AYArgQ3Rz1fglQqFEFOIFAAhFj+78HoAtQoCFWkGFkl9j/zL3zJ4W+LzE+/tj6cBhgDnBw9SFEJMIVIAhFgaXEg3Dz+J9f2QtZElfAehoxzkuhPMOu9vxqsAxuyPWwB2A2eiCoBCTC1SAIRYGlyC9wYo7AFAow87ikDnlUgrvAC4ObHt/ngZ4JtQC2AhphopAEIsAcy77TWquDdAxGCc5pdc5R+OKwBX49YBIcSUIgVAiCVAKA4ELNu351WDnXgNguRuhwArgIuB2yY9L0KIfKQACLE02Gducu8pujPCBgGG1/m/OvX+wdG/v6SbGiiEmEKkAAixRAjuj9/R/bV8RV9XQUgGAuDC/7rEx7NmbMSDEc+e9HwIIYqRAiDE0uEi4Bp6a/ckLftpK38I/YX9cl8WbR+6751PV+EAmMVbAW9FLYCFmHqkAAixdNiKKwE95Xuj+sBZgj7v90xSO8zjCkDS5TATAuvwlEQVABJiypECIMTSYRfuBugpCNSgE2AZhgcdXpx6fxUeA3BeNBYhxBQjBUCIpUPbjF+SEL7Dl/2AKwC34O6GJPuZsdqMC6lZlVAIMX6kAAixhAiBS+gtzFOKVXqrj2syznNACCwEb0wkhJhypAAIsbTYghfgqRHgb1m/JMIHMrmR3gBAcPP/blQASIhFgRQAIZYWt1IhAj9Z5L+g2U/eJwG4P/B4YE3i/fVmXG/GLZOeBCFEOTOTHoAQYqgsACcCD6dEwc9Z3VuJ6SD+eD3wSOAewFo8K+AewB4zvs7Iwg+EEEIIkccTgNvMlYG6r3bqVbiNuaC/A7gUONfMnj3pixdCVGN20gMQQgydG4FdwTvzDUqVWII1wAkG14QQzpv0xQshqiEFQIilxxXAl3CTfFKAJ83y8fuxmyBe1YfE+/E28cof3G04E38W/IcQYEeAz+F1CIQQi4AR9goRQkyCFcBe98vvR+JvPPohYEYAiyoEGWYQQqCrAMQZABb6ywlbz8uwaKPdePe/hQpDFEIIIUQVqmrqVvKZS3bDkqF+OWF/Vc7ZmoG1M9mmRK0uhJhu9DcqxHSTXHGno/r76vlb53+pTL+Mg4a+93wt3+MnMCwqJWyJ3UL8QSg5bNZ5UucECIGgyoFCjBnFAAgxvRwIvAA42WA1MBcJ06SvHrom+nmMhUj49/jqSXUEDPldAnvkfwi08OfEbHQszwwIHYGdFVcA0IqEf3qcyfGHQGgBlwB/C2yf9IQLsZyQAiDE9BLwXPtHxb8UYeQ3/jGzyM1fdLJ6qftlW9c42mfqbS6EGAZSAISYXnbiNfdDqGBaL5KgZcJ/WJSZ/HN2uSi6ViHEGFEpYCGml324cKwVWT/KwJ6yYzdQM/bgLgDFAAgxZqQACDG9BPMKe3v6PsjZoRMEOLIBWRUFIxmAmLtB9M9OKvQuEEIMHykAQkw3lwPbqLiwD53/ZX80MKFupEDBOJ1twHVDGZsQohZSAISYYgJcC1xPTs/eGvS0+c35vehF2fZWYeWfMabNwA2TmV0hljcKAhRiurkNuBh4YPLNklX47fjKek+0aSvxssS/WcI9eYq4OmD8Su6brhAI/jw5lN4WwUUEvGzxrklPshDLESkAQkw3u3EhWRwk1w2/bwP/BfwL/QpA1RV+lvDP6hGQfN+CVyH+S+Dp0XvFNYB8/1+SEeMghBg9UgCEmHLM7EJgVwhhde5GId6Wmah4z4WUZA8Upew1SOcDWFVzewUACjFBFAMgxPRzVQhhBxX868GrAJ5ABTN8aPhZAeuB47MOkTFwA27GsxyEEBNACoAQU04IIQ4ErMqRwMETGOom4DAy9IccheJa4KYJjFMIgRQAIRYDNwFXUy3CPuBC+LBxD9KMw4EDqG5AuAi4ZdzjFEI4UgCEmH524ZkAnUBAK1AFDNZhHVP82AiB4ymJA4jzBfH4hCvwaodCiAkgBUCI6ScWlvMAWH7TH/yj1QROHvMYZ4GTgLmijTopA57dcD5qAiTExJACIMT0E/Bo+Ts6v+WQKLF7NJ6WNy7WAXciw02RfiMELHitgmvGOD4hRAopAEIsDq7FiwIVxgEE65jY7wTsP8bxHQIcG/3cM8YMfcXw8r9SAISYIFIAhFgc3IALzeJAwK603ch4AwGPIiPzoGCwVwK3jnF8QogUUgCEWBxsx+MASon69RwKnDCuSl8GdybD4pDjrWhj9ktUAliIiSIFQIjFwS7gQkuVBM7q0hOxEjfJj7A5cIfZACdTEgCYGMheQriMsvLGQoiRIgVAiOmiBRxIfwBfAK4IHj3f82by5+j3YDBrcNe2jaXc9364AmBZEYDxm4GOErADuCrjOGuAtWMYrxACKQBCTBbr/H8D8HDgb4D/AO6RsfWlePR8eUlgMIxj2tU78w3CgXgVwJBZAjB0Bxz9eBOwpW8qzB4J/CvwYuBejGfsQixb1AxIiMkxh0frPx74TeCuuDDdB/wv8NPU9tdGryrBfYHAsRiH4NkDo+RoPOiwh2RbQev+bnj0/019m4dwV+B3gCfhpY9/CHwG+A71SiELISogBUCI8bMOeABwKoHfBI7B/xZjeRkrBi16/eQ34abz+5Cw/idW1z0EOIjARkbfcOcY3A3QM4SM8cTjvQzYnvp8ZfBrnomu++jouI83ODvAp4Av4vvOj/h6hFgWSAEQYnwcAjwUeAbwENzsn1woE/0+Q7eq3p7E/nsMLgup4LmEbz399v64b/57I7ymFnBvvARwbomieIwB5gNcbv0lgNfgqYSx0hPPyZoADwLuD/wh8FXg08DPiAsjCSEaIQVAiBESCb0jgMcCTwfui7fNhV7Bn+YQXKgmFYB5vIHOPKm/3dRBYqViBa5IpC0Jw2QN3n44PmfuPETsAi6ehZDSAA4miiPI2D22itwZtxI8Hfg/4EO4ciNFQAghxHRgHvq+Efhj4Aw88n0hfln0IvvVBs6FzIY+jwJuNqNN/v7xK+Cr5VFG1h+L1/SvMp42sNngfhnHeShe7Khdsn/8bxvYCnwYeMyIr1EIIYTIJ9HpboOZPQ/4PrAzyt2fp1xAJl/XAw/MOM1JwCUYIWOftlmfAvBz4MgRXvaDorEWKTTJ8fzA4PDeQ6wA+H18JV86NxnK043AR3FFYHWqHoIQIgelAQoxPPYn8GTg9BDC+82F48qQdtNXk0774UFwaW4DtuUY20MqDy/gwvaIEV7zyUQujZxYhDRXRo2AErQNONJgrsrUZPhNDgKeirsEPhjg/gYz3QxLIUQWUgCEGJwVwCPwHPZ/Bn4DWB28IE8/1RrgrgFOmJnpe/82PBK+CgE4gGxFYhi0cDdFpwJgyaW1DS4kVcwI5mfxOIJBYpICcJDBcww+EuCvAhxvBKkAQuQgBUCIBhgw4/b+44G3AacHeDLRajgvNa/mKY5st/uE4l7gcqJlcwVW0A3SGzargLtQ/TmyL3gToHRA4mpgY1FEZHJSCgjRMY4L8BcGHwvwXFwJEkKkkAIgRDPWtAnPwAv2vNSi4jyxAIv+re2Ott4fTzbrC24LwNkGO0PGfhknm8XjBvptCcXnzzuev+8frKW6e8Hw7n8XZ3x2IJ4CGEr2t5BVbrifAMwEuI/B+wP8C55GKGOAEAmUBihEfU4J8HILPM2MA4B21IEviWX8XGoQSG1wcLvNavrb5l6F+9HXpPfLOcF9gd/Co+znya7REzL2t9Qrua3haXnHlV1XXAHQ4BYzbmj3b30QqVbCqQnrEdyhJOUwuWnwOXoqXjzpb4HTgVsq7CvEkkcKgBDVWQU8Efhz4F4BjJCZX5+7cI7+rSS8cHfCwcB1qc+uxcvpbqSnxk6fZIx/vQvwn7j7IG1p79EdEvtnGRXSgnclXmyo8HoSJ7jC4OaMTQ4nqiRoBav0jGtLnyKPNu4GeTveb+GdszP8eH5hEA+NEIsfKQBCVONI4DTgObjJOrkSTtLIzJyxpDXgQDM7JPS32Lk9eA58uopgnoCcodgP3qlCmFe+1z81LDJ1JIZUR4he3Q6ZRXsOw+MALH1AM0hZV5qa8du4AncqcK/5Bd6JZw3saHg8IRY9lfyCQixHImdzC4/w/1vgKfR2qBtY+CdqB8Q7x3E5lwH/1YIvB9ie2q2Nm7QfWHBcS58ng5C9a/7nAzjR53GB++OMz3bg/RGOiP5tMXA8YCEH4ZaATcC51u9iEUIIsZwxYx3Gy3Bze1zMp6igT7vsZd2fk4Vt2ubm790GZ+Mtge8CtAqidF+ElwluPBb6q+71jDOvWmFBFcPOMa3//dvwcsh5rAR+FXgfcAndWIU2xdfWPz6rVJQo3vc70XmFEEIIwE3+f4dXp6tS5rZU6Fq/4Iqb3twBfMeMF+Gldausbn/d3A3QrjMWq6gYWMZxKwjVogqAFwOnVLiuWbwt8uuBX+BKTrLqYZEC03RsFwK/S6KegRBCiGXGO/yf+wFfwTvWNREypcLWXPDcire4fRZwaE2b9gnALylRAKKeAb6NWf8q30auAMRKzndw03sdjgVeirsNYkWgsQJQYrnYCrwSd0FUyjUUQgixdDA8Xe5c6111Nn1lCdeA+7w/D/Ykup0B67Ie+BLlzXNyzfwVXrWFfqoXQfKc/0pU9L8BRwOvwBskxav2QgXASn7PGeMO3Oqz0YA3NhysEEKIRUK02JvBzcBXU0H4F3Xzs2zhEvA0vO8DvwccMGBZmlngH+iPJxhEORnIvF4idP9yCF/VScCbgCsSczqokpZ+zQOfMu9xoEppQgixlGl5CtpL8K52jYRKiXl5HjfXv9LMNnXP3FwDmJ0FM15uxl4KhHDZ+wwg/KsqGwY7DJ4+vK+Le+PKT9w+eBixAOkxf8e8gJIQQoglyjrgr3B//LAFSRtXKt6DR/WbDcm5HDUJOhVPEcw3hVtpVPwwVv+Z+yTcAdcBDxjy97YS+E3gC9QL1FyouG0AzgQeMuRxCyGEmALWA+9kCALEev9t4+b+rwOPwayp77uM+wKb6U2XqyPQK6cqAgvk+PctYx/rnYuzcD/+UIlUqQ3A/6MbEFkWvFhHwYkzBB6L+giIJYgKAYnlymHAW4AX4BXi8grPGNk18fs38k9b5qbpD+B+71/gwmQUzJq3Hj7Q6HEFzKde+1L/Jl8Lyc/MO/bto/81b5a5X3L/zOMb/MCMD0e/D5udwE+AM8ytOSfg1oGi7xOzUoEef74B+BW8A+MlIxi/EBNDWq1YjhyO14X/PWDGksLCesrclv19pIXMAvB9g7cE+DajEXjdwZnNAXcPIRyI+8Znon+zqvll9QtKKjUBL0YUX35ec6OsJkcx7azPzNjSanHuwuhr768DnolnDByfcb3pMZd1H0z+fDnwMtzl0EYIIcSiYwOekraPEp+25ZjHcwr63AS8GzhqXFq1mRHHFAzjnNV7F9c7m1knZmEs0wI8CPg8sJvmcR1Z6ZtX4M2gtHASQohFxoG4ab5SCd2KCkAALsBXnqsmfYGiw+F4yuCNVEzrpFgBiL/rS4HHTPrihBBCVGc93tBnF/VWfpkKQKJQ0LdQLflpZaV5lcVLaJ7ZkK6MGPCAw4dO+uKEEEIUENlq98fN87spXv2VFsWJotuDwR6D0/GgMzG9GJ7K970oJbJqjYOi0sgBD+6U4ieEENNIJPxX43n+OynOVa+qALQNbsY79h086WsUlbkL8Gl6syXqWIKyUgR/DNxbAQFCCDFFRKHwMwZ/BNxCTn54XCiHVPBfTiOfYHCDwR/jqWZikRDFSm7Ea/3voL4SkPf5N5AVSAghpodV/sz/LfPa/rXa+Vp+ANhV5sF+s5O+PtGYA3DrzW0Mr/Lj6cAhk74wIYQQzr3N/bR1a/vnCf8LgCeg/jBLgTXAXzAcJaCNZ5W8E9hv0hcmhBDLnU14Hnjmw93qKQABb0P7yElflGiGkWmyWYUX9tmW08K4rhJwO95QStYhIYSYEPsB76Uk2KtiJ7sAnE+G8J/xjP91KBZgMXBQC9ZlBOvNAS/EGzYVBYdWVRivAR436YsVQojlyAwe9HcbzVZx6d/jlX+/7DCOA/4Q9ymLKcbgLgYvsmwT/SyuBNzIcFxFP8EzDoQQQoyRXwcuo6hbn7EA1rfaM7PkPm3gPOAROefZCPw78GxUFnYxsB/wj3iPgKzOjCuA0/CW0Ml6D7WLRUX7/Cdee0IIIcQYOAb4P5oFdbWtoxzQxivHPYZs4X4Q3kvgx4ygxe0UMMcSU2qii3kicBHwXLK7oK4G3oDXiyhzG7VLXtvxVFF1WxVCiBGzCngX1Yu8ZD7co/S/a4GnkS0E1wFvw1eKb2DpZAQYHjj5VODvDF4N3Iel1dvgYOCLuIXosZs2ZW6zHrcUlN1HWaWh066Ai1GlQCGEGB1RX9YnAVsZPJL7ZuAFZEdyrwRehRcVugQXkIudFcA9gdcAZ9CNndiLd777N+CxwIGtSNWxxWsbMPy7vR34GXC/nO2OwCsGVo4BsHxLwOeAQyd94UIIsSQxb7/7HUpM/xWiuu/ASwZnrXpncNPxDXjO9wdZ3NH/a4GHA3+PKzN7yPd534ivnJ8PHDUzs6jdA8cBP8VbQX8TONksK76Tu+AKUdE9VeYGWMB7T7wGpQYKIcTQWYG3fG1s+qe74v078gO3fhO4EpjHU70ePOkLr0u0gD8Q+G3go7gyk5X90B8fYQTcN34mXkDnFBanf3sGeD0umPcBH8fs0LQOsGIWDB5sxkVUUAKs3xKQ/Hwz8IjFOFlCCDHNPBr32dcO/Eutdr8MHJVzjrvhqV0LuALwX3glucXERoNnG3zJ4GYz2smueBVz3mPf9l68He7bgAew+OIE7oX75+eBXWa80SzTmtMC/gC4ifqWgPTnXzK5AoQQYmjEQV11S/2mH84XAg/MOcfhwKdwITkPbMPLAU8v3dXsLHAS8GLgu3gDnICv6KsWQsoTcgEXoFfhcQKPYvHUQ1hp7vqYj143Ak8nO+hzFa7o7CFbcayiACwAu4A/YekEjQohxMQw3Cd9ByWrWCM3p7uNB709n+wH82rg7fjDfz7a5+vAhklffAn7AQ8F3oMXMspNa6v4Sue5J1sjx1aRrWZ8FngWsHFmZroN3ubV+rbR/V7PIz8ocBPwVepZAdKfBzP7uRknTvrahRBi0RJJ6mOAH1HR9J+z2p0H/oHs6nBGZP6NBN48vop7KdObI78/8ASMjwDX0RVu82a2QMXStlYe4FYkBHfgwXMvwQPupnXFewjwf5FiGM/TF/ACT1k8GLicAmtT5FLJnSMz9uKpowoIFEKIJsy4AH4ZHsjVdFUbcAUib0V2P7z7XzshEM9mOvu+Hwb8LvAZPI2xnRJsC2a2YGZV56Ysuj1XCUjUUtiFd2J8A+5zn7Y4AQNebLDLuq6AvXhHv9UZ288Af0rC4lRz7uJ77lLg3pO+eCGEWKwch0ej53b6q1DG9Ubgd3KOfyguTJPH34enCE7Utm1msflhFg9O/HPcv789PR8GiVV/ZeFfqgDUbJKzz3zl/B/AqUxXINwxRPeRmcXK0s3AM8m28hwI/O8Acxdbnd5LdjliIYQQBczgVep2kVjh1nztwx/CWavSFbigT1oX4tLA95j0xZvZGoMHmVc9vAhfteYrQlarq10l90kNS0L6dVtUr+H/kZ9xMU5auEsnaQWIe0DcK2ef++MZBHlWkDKLSRu4yiw36FQIIUQOpwDnW9c0X7baTz6U459/hkfHd4idsuar1Bvof2j/LV4jPxdL/Wy5vzbiADz74MPAFmA+OQdkCf+OAmCFQZKUz99QXtF4A668/QR4ZfR9DhonMAsY1miSjzX4Od3VeawEfILsYM8Z4LUksgKopwDEr/dRcj8JMQ6mO1xXiC4t81a/TyHxrM976JtXrU3L5R3AG/GmQR2icsJ3wS0DJ0ZvxYL7BuBv8NK4WczgPQI2AsfiQu0BeGrhfXFBciMuNKpfbKtFCGEjcKq5VeKleGzCWqKKvKHG8YahhQyBEM3XEXjnxsfipvjtwDZzxaYOhsdlPAp4qMGd8JiI1biAjVMW2zn73x6N5UGpKToedwf8JLVvwFMffw04Mmc8VcZ8GPBt4PrRT7kQ+SgiVSwWjgi+Qp8l64HelYgG/cLRDELgm7h/P6R2OxAv2XrvjGN/B7caGO422B8X6kfi8Qh3BU4wN2uvDy582gY/CfAR4Hxc8ahKCzg+hPbj8KZE946OGciR+RWUAUt8XkdvKD5o84O1cUXgJDyg8xl4qt3peHBm1fmKBfIM8PTgufaHRvtvw6vwbcOLRW3GGwFtxov73IG7g74CPA+v+RCzCu/m9z2DM1PXeDXeMOhulBSEypmfgHeRfDKepjk/lC9DCCGWMM+jWk57lgk24M2CHpM+qLnweAmwIx09j7ELeDfwQrwgzMeAH+LR3LfQjUUIQDB/72vAc+tUfouWjSuA+xm8AzgfY3eyWh8p837Ze9QzScf+/XiuQnK7LPfBoLEF8fgssUo3/44+iQfideIEKloFZvA4jdcA38eF/F5gHk/B2xndAxcC38ALGL0S7/Hw87RLJfr9Y3j75zQHAp/N+H6qznUca3By1XtECCGWKwfgedpVqv71PHwTD/V/ImPFZmb3xEvbprePAwa30/X5JlPs9kXbt3E3wceB3zHPMadV3Za91uAR0fiuinz3mdH2ZfEOqc8rp/JZV+DfiDfJiTsDxspA45iBvDFnjTNRS38H3rTntcBdWjBjVrkToeHumCcT9TxICPf5xDkXcAXhdvIVy53Ay1rZOsgTcCWjiQKwYB5oOs11JYQQYip4DP0P23iVXqgA4A//S+jPv16Dm+8/TPWMgmSg2D48Ev9d5oVi1kD50zwhyA7HTd+fja6tZ9Vd91WxRG06IDJE13E+8Fb8OtbhZZYfDfwzbmJfoGbJ5RKhn6WspLeJyw1favA+M37NrHY9gf2ARwL/g/vby4oZZc3hlXjcySGpY6/DrRXJ+axaNCm+vm9kHFcIIUTEKuBfqf/g7qziDf7GjBZuZj8BeA4e6X2VZXQSLDCnB9wacB4emHcKFRf7kdBvmXX83j/AV5hpwV+14E6VlXieAhCAHWacAbwc7ESYy7qMOTwl7o3AOfiqNW+8lawDZa6KROGluLqeu1eMG/AYgccD662iOSBiNfAQPJvjYrrpk1XHfisem/BGvI1y7Bb4bbrNguoqAG08PuExCCGEyOSuFOdelz1kr8Yf1E/FV7Tn4b772G+fva+xgPUIzO3A94CXAyfWzDpbgWcEvCU6/16yV/y5QiR2CTRI2UteQ8DjFD4H/D6dwDejJBvP8Mj4P8UVlzsS489qgxuPtb+QUH1LRVL5CsCtZvZFPE6gG2dRTSGYje6n1+EKTd73kLdiX8CF9reAvwR+C88oqawAZFz/e1BKoBBC9GF4AF6Dwj+dgjW3mpvqb6ffOlD2wA/46u9zeMe4w6lIJI/WAb8B/AtuSp4vOX8tQVJRGYgVnevN+F8zHk+ic1+9hTSGZz88B2+hnIwTyBLaVa6lyXYB2G7G/+HR+sdj1qqR6tiim4HwQzIsMYn5nc8Zyz68JsO1BddRRTn7BZ5NIoQQIsFaPJAr70Fc9ZXfxCXf1L8VjwJ/Ip76V4fDzfg93L+/jXoCoU7d/aLjBOvGKbwXz11fXVPgZxIdYj2elvkpPGe+owhYvWspC1ZMWxCSsR1xYaHzgHeb2cMsau5kZtCqVGPocNya8CW6Ck0y2DPvvksHFFZ33/TGrdwRnV8IIUSCu+EBfE0Ff10lYR+eK/4B4GGU5HmnMHwl96f4qjI2k5eeuyByv9R/nnovFvy78Tr3Lzdf6Y6yK99avBDPP0Vzt49ei0CT1X9VJSBtrdmGZ2M83sz2j7+UiqzHI/v/E7fW7Osvg9wjvPMUg7quqgD8N9PXMEkIISbKcynvwDbIK17t7wLOwiv+3Yt6BbLm8AyDv8bNuXuoETFvBQKkSt39RAe+OE7hB8BpwNGt1lhzzOaAu+P+9bPoDRhs5ygvjRSACt/nLbj15fcs4bapZhBgJV7z/614emgcJxB1VewI/0EsUukxX4RXMRRCCIGviP6dAVLjKBcUtwFfB15E/f71q4FfM3g/vvKNCwKNw1rRuY4oUj6uQ/AMYBPU9u0Pk9gS8mK8U+EO3CrRH/BohYK9iQKQ/n534EWBXg6c0mpVL31u3Y6LrzUvCXxH4tzzwHyy18KAr53Asyb2jQkhxJRxHHA2wxGqyfz9BeA6vLXrk4CDawrL9Xj09//QGwA2VsEf/XsNHmD4CCLf95RxGJ5t8EU8mDIZaJed7VDdNVDHxL4PzyR5B26tKY26t+6/hlclfB4e8X9HzfNXsf608VRXtQkWQgg8de82aJT6liUwd+MFb96JN39ZXWUQ1v3nSOD5eO34W+kNFqtj4i8T6v3H6PU97wEuwIXZA1gcQmM9rmx9HPfTZ2UNZM1HqRJQJRsimr/4nFcC/4A3I1pX8zoOwVfqX6A3/79OVkbWvRHwfhNH1hqNEEIsQVrAW2o+UPNMyLfhnddOw2uvl5r5W11n8Uo8JuC1eGnankI4yba7NcZVtl1aqYjN2TtxU/SrGU4b3UmwH1745kN0rSdFFp4qAYF1BW8yy+NTeAT+ppp1HQ4AHh/1CrgxcdzkvVDXUnGTeZEhIYRY1qzHu8PVMf+nhcM2/AH/dODQigFgAJjZWnyF+I908/cLx2JWWo63dOyWeNEfp/BCvIvcUmAN8GCMd9CtMDjUNMmKxwq4Sf8HeJzAnYDZGlUG98cVmn/AA/niANBqY+yNH9gH/NmkvxghhJg0d6dbg77Ow7yNryz/C38w183fPxj4Hbz2QF/t+Djoq+KKs46g8m28CVAype0TeFObDbRYim1j4pbAr8QtLHGFxr6CPCWxAYO6iAIe7X++mb0dd62srHIBiU6Od8M7Ef6crqWosMqg9Y9B6YBCiGXP06me/hc/vC/Ey6o+iIoP0YQ8PRL4Q3ylfTsFD+4BavBXuY55g8txy8OjqO+jXnQkvoNj8GyMbxNlDpBIH7TB5raOItA2YzMelPcIvM5Bncs5BrfWfI1EYSGqKQA/JcriEEKI5YgBb8IfikW51m1cUPwQX0GeQr38/RnzxkAvwxu9dMrB1mi2U8dfnbmPGcGsU7HvbXjMwXKuDX8onjnwJTyfv3aJ4aKYDKv2/cWr97ga5KnAhjlqGWEOwq1JH8PTNKsoLNfjFRuFEGJZsg6vvZ/lc48fnlujbf6ACiumVPL3GtzE+yY8zbBW4R6qC/yyVxzYdyYeZHg3XCkRzoF4JsiH6Q0YLFWyrED4W7XvNO1auhX4JvAS8ziBOfDCQhViS9biLYn/md54krQiMI+7Dp4/6YkXQohJcQReSa7nQRw9uK/CH6SPBtbXzN8/GBco/xkdZx+DmY+rlKvNEvoBr53/JTy3/GigtQT9+8NiLd7K94P0FlxKzbel57zO6j9LycxyD+zG+w68A3igwUqzykWXVtGtMHguiYDBVNOh91DPkiWEEEsDgwfSu+KbN7jCvKFN5eCsBEfg/v2vkW1SHokCkPPaigcYPgHPdBDVWYG7R95Ir+VmGMWC6loFFoCrzfhXMx4N7N/pRFhuEZgBTsQrJX4DuCXZ4Aj4NPXiDoQQYsnwJDwA8A48ovpNwH2p5xdv0e1fn2z3OqxgsaoKQHzOzXQr9unhPhgtPHbjpcAZJAIG6bfA1I0DqBPImUw3/TRRuuldK1yA0dETNgCPxwMOr8CtUj9DBYGEEMsQw32gX8IjqY8FWjWs46vwUq9voLchzTAFf6ECkGjMsxcP7Hs38KsovWsUbMLjQOLKfMmWxKVWgIoBgXlunZ44AYPbDb6Fr+xPoF6hplXAfYC/MrOP46mRQowceR7FNGH4Q30vXmGtKgfh6X9PwqupHW3GTAgEuvd4aDIeg5De0RI/hNDzN2S45eJcPEjxs3g7432TmtBlQvz9Pxn4DeAIDCN0FIJ6+L5NMLqlmj+Ff/8XmtneEMoPaGatEMIheCrqronMpBBCLAIMD6B7Ht5s5mYKTLVVVoTkrwCLto2FzB14s5hn43EHUq7Hz2rgVw3+Dne7JN0wpSmClFgAyLYE5N1ze3Hl7wPAw6jYrKlGFUIhBkZ3m1g0RMvxGdzEeirwFOAu+IO/Z4ll0RsGVrD2yvrIstf9ZBkC4lzxHxh8KnhQ1w2TnifBStyk/mTgsXjQ3Qq82mLPDRFwoZtaoec+F7Nvjc6h+jane498G/gk8B3qWbeEGBlSAMRiYY0Z9wmB38Yf6ifhgYGFttUSBQCyBXvmdtHTvIWnbF2Jdwb8OB6suGPSEyT6mMWDQR9nxqkhcC+61RVDR0nsF+pNnosh3jHjfouPtx2v9vcJPCvlStxiIMREkAIgpp0NuH/3KXhBlcOJnrNdc2nIXpX503hY97jhQYUXAp8BPmNmF4QQ9k56gkQxc8A+v28eZvCUAA8FDkkJ6/hHyxHiuUTbV90ljhO4GHddfRqvLSCfvxBC4A/Jo/CMgK+R79/Pre6W6M5XpaVsWeGe7bgJ9yW4+2EG5K9dLKQqQe6PK5L/ZnCdpTIHCu6FsnulSRbJPrwo1X8Aj8PbDAshxLKkBZwMvAovkZuZv2+9bVT7lQDL7Mtet0xvwAsHfR54Bl6jXixyrPvvautWGLycRIXBEiWgTi2BOgGHN+GWpacCG2YQYvRoCSOmgTngrnga35Pp1ltvD/EcVe51i865Bfg/Mz4RAmeY2S0AVVK5FglNUyMHSamcKuLKfW0PDrwLfu+dCpxixooMr1JZrEnXh9B8ggy3Np0J/C/w5Vm4bn7SkyWWLFIAxCRZB9wP75r2WDytb5bRCBgr+Ww38EvcL/t54Dwz27WEhH7yWk/EsxVur7nv4cA6g0uW3Ky4p+BY3BT/ZDyLoBMwyAiVngyFoYVbv36Ol47+Cl4pUAGDQohFzwze0OfjeN3/ora/TWu2932eNutGrXhvM48z+EO8l3ungtsSdfGvwtvtbqy7o8E9DZ5tfW71JYXhis5TgY8A19FVAGqZ/41MN1TdioS7gHOAt+NWsqV5Vwohlg0PxKOgB23YkuevzXsg9/V6N+NUjIMnPSFj5ADgNTRQAPBudm/EzebLgTXAg834OzOuTNw/lYR/WgFI3Kt17/P4nv0kChQUQ0RtJ8W4MTwN6zj8YVi6osnLrS5wSJtFxVwTFvxWlKp1DV47/iNgP8PCjryDLFEOxCsVNo2vOAoXjMsh/XEn8P0Q7EwI/2ZuFXgCXoNiBdVcA537e4BbrI1bpu6BK263TXpixNJACoCYBCup0Swl1HwfOoI/jvXah/v3v4DnXf8CYy8BwjDDDBcHBwGHm9FqEN7QMuMwM1vbbodbJ30hY2Svwc+DtyH+N+DxZjwlBO6NK0MhXUuoQR2BKsxSryumEIVIARCTYBhiN67klmVBiAX/Trwr4Cdx4X85cSBV6Pxv2bAC2OsKwP7mFpFamGHAYe0QNuCWlGVCiO+UBeBSg/eFwMcNHhngacCvBp9XqHFvW+d/ndP0fZ4sVBRVtVQMgBgaUgDEJBhCxlSm8E+WXP0RcDrwVeD6oiLuy4VDgC3uetmvyVREnQ8PwIPkljPBYMtci//e2+ZzeEzLU/BMliOibaopAtUbVRhgZmZLMDNFTAgpAGISZFder/5c6ygO0a5xvf+teE/2DwPfxysIRsfWQ/NG73N7dIC5GqVrO0Qr0JXAkZO+lkkST9xeF/G3Al8149shcA+8aNQTcEVrhoJ5rvsFpINahBgUKQBiEsTR1C7Jo2daFXNAou664QJpATftfwlvsvIzVFc9k72EFWYcFVm0m0gSw33QJ+LCTXnpXfYAP8FdTv8K/DZeXOhuRHECNCu81DS0QIhSpACIiVH36Zaw98eFUs7By6d+Hk8rVNG0YvYLgaNJKGB1CN3Yio24IiAFICKxMJ/HA04vAP4LeBheWOghuBcGiufeSn4XYmhIARCTIF6914oBiJb9ew3OCPDfwDdoce1QCwYvbfbHexrsoplgiffZBOyHV08U2QSDa4OX9P0C8IAojfBxwKaC4NVCBgqaESJF5VQsIYZEbL6PqSOI9gZ4D/AMcwVAwr8G5qVuD8PN902q+cXJlUeYsWHS1zPtJAT1duCbwEsD/EHw9r9NVvom4S+GiRQAsZjYjtdFv1EPwvoEj97fD/+7b2xaNjiA0El7E9XZiwennk3z+ZdLQAwNKQBiElSS37HDOfFrkAm0MYb3Ooi7LDYNAiQE1oVuupuoSDThgyhfZrZEO1SIiSAFQIwdM9pVHmNx2HSkCMSleyT/mzEHnEA3er+p88RQKuCgZN39IfFhfOuH9MaqASCGiRQAMQlC6BRXqybQVQFtYFbiLoBB5rGV+Hcjen6MhNQfhES+GBn6AxZjJ4Se1acE+3hYj0fvB5qboeesu++RLJ+ugOOirO1F0/oNQmQiBUBMA4XCKPRuJ4WhGWvxMr4BT/9tkgWwInSfGetxq4KoT5n7xTJe8X7KexFDQwqAmAR1gwCt/y1Rkw14HYAAzJhZk7/9WbrzfwiuVIj65N3/VvJmQAqAGCJSAMTYMWhZ5tt9v6e7n0kBaIjBUXgKYPRrMxcA0XdnZgeb2f6Tvq5FSue521nip9JdcpALQAwVKQBi7IRuK9qih1nIifiXAlAfi2oAdHrJN4wmn42OZSGEdSGE5d4VsBEGM0kNLFAc6RcKfxWiOVIAxCTI64JeRbgP5QG4zLSIWboNfKD5HK7AnxkBWIdXFhT1sFgBzljOB5CEF+NDCoAYN4OY8YdhAp3BO7SdSGJFvJQxWIWXAO7EUjT8ApIxALNmbGTJ61LG3NxKgAOBB+KZFIMyyD28xOdbjBM1AxLTQM8DsaDa3zCCoB4KvD+KLfgK8DG8NOueSU/CCFmHC65YeLRCM+U/KXxmQuB43CqwVOfOIBy1b9+ex+Ltfe8FfBn4M+CWhscMeMfAppUYpQCIoSEFQEyCRisgK3eX5tIC2nBX4K3A3QzA7C4hhKfhD/XTgTNZmh3uDsNjAJLT0USQJJWGZC2ApaYAzADHA78DPAW3GK3C779nAFcDb2t43QHYl/NZ33di1gnXSKcECjEwUgDEJKia959+v7ELILiwejNwf6DtztYAHh3/AuCJwOeA/wDOYgkJtQAHGewXupWVWzSrA9Aich9Ex9ofWI03aVoKrMKF/ZOBxwMn426ipOVpFfCnwGbgP2lmkWqDT2SBNtu5RUu2E6IxUgDE2ElGP1cg3T64yaPwAOC1eC/29PHiB/hhwB9F23wN+ATwIyJT7yJvQrQpwJr4GryrUiOp0oIeReyw6LV10hfYGJ+U/YD7GPx+gMfijY4io1Hf1x7weIDXA9fg90pdPJsiZB67TzlOfU2yAIihIQVAjJ2yhj7WkbZG6AZGN5XBK4H/F+BZFK9642MfATwXeBJwBh4j8LWweIWckUgBHFB6JF0HATjAjAMX8er0UAKPwHgSgYcAh1l0n8XWkqybzox2CBwDvAnYApxf45xGcQnlULKvEENDCoAYN6XiIkTi3vpVhcougFYL2m0M9+O+DDfd1hnfgcATgEfgsQH/g8cKXA/d5eEiYBZ3f8wCgXjh30xqR6ETnVlaGdwCsHgwjMARwG8BvwvcL7IAdDLzksWnsmYpmro2cF/gr4CXADdUHYHBTNnsF2i7UgLE0JACIMZNpWAm6zcTxA/oSnK37Vv9OvAGYIN19YrKrocoAGs18HDgAcDPgI8CX8QDwRbD2nclnq/vl+7SLV1hsRJmzIaAhdDRAVYROJHF4yE5gsCTgd8H7o7HL3TM/A07Tv42cBPwGuDmKjtUmag84R99d0IMBSkAYuyYWYsQy6LsZ13OQ65SMxRfpnLPEHg7cFJyn6Ii7H0O2e4bbVxYPBR4oMHzAnwc+AxwKbAw6TktYA1uzUj6UmaqrEL7CMwCrcRkzdBtMTytcinOVvgt4JnA/XClqPBeqhEiMQs8z2BncGvAjioD6ql+VeVcvtNMaBa8KUQmUgDE2AkhpNPJ+uoAdLZN7UpZ/IBvcDSBt+AP+3bfA9ayD0xHd8iOUzCzdghhLnjA2N1xgfJZ4JPAecC+KZSEBxOlACZ6yjbKAoiEj6UucBPuXtk56QtNMYNH8T8eOBW4J7DaPKykXfYd5QjkvPjVuQAvxN1D7wP2lsxj94DVFA1LWG5UvE0MDSkAYtyUmv9D8b6U7HsQHqH96PhQfQ/Ygoe7FagAifr5IXglvLuGwCm4L/kLwMeDpxBOjTA042AC6wOEhHISpwJW5uFmfDuEuIeDJY5zLJ5lMdFrTkjmGeDOwNPx+I8TgTmDEMxCCKGvu1Qc7Rd/vZZIvk8dPuN0nX/XAH+OKwGntzpeqEy6FqnQe8yUQtDJCphCxVIsAaQAiElQy9eaeCi2KBZcq4DTcB9v/nbZT9PQ/X/oN9OS6SKIH9DH44FgTwW+AXwIzyCYuCIQAkfj7ovk+MvmsY/bN22Ca681QkgbaNYz8bbABoQ5fJX/VNwvfzyuDATrfLfdrziWqiEhwrvfcWVRm7wtAt5y+fXAFcy0vs9CpgoQjHwLRF7KX+gOV3qAGBoyJ4mpI60dJB6KRYKrha/EX4z7eHuO1WN2aBBeXdCxKCkENuLphh8C/gHPIFgzmVnscDywOmPMtVwAZ2/dSugV/vG07E9vlcFxswrCrwR4VxSX8Qo87iNuWmRYPak5QN59GzgB+KvQDkcXHH6+wbFjm9QiST4RiwEpAGLc9D3EskyyGRiw2Ywb0x/MeVb1w4HX4SvSrq0+9W/ZwMqCDKz4vXj3Q/D4gNOBf8T90AfNtMb+5zaLKyVJkz00iQHYtw+LYwB6WWdeO2HcHAA8BvigGR8D/gQ4hpTO5+b8/p29pXGvTpixWX9p3kpeKB4G4bXm7qg0C8Av6SkH7Me08hZNwUxJAGJ4yAUgxk3Ag6Ti1VnH3Vrw+DPgRuDtIXBF+sN9e7knXuP/OAqK3NVJAywoR4yVbxu/dRiuCPwW8KN2CB8Fvr5qNdft2T368q4G+0Vz0lO2IDSwAETXnKXBrAhuZRi5mzo6wUG4svcM4GHAwaFzWf3nD9mTXFHn7P+6+4v39ZRGjpkJgWcB2/BiQUlXUBtXDB+GVx3sVmboH2tGVUDJfzE8pACISdBd/SSeZ4kfky5awxWGD+K1+tNPwGMM3h484j876I/MczSmxjGSRYUeG0J4GHDWnt18MgS+AFzOCE26wX3/h2Z8VDsIMGpfl6WjzeAZEauAXaO4jlmD+cDGAI/Cg/t+FbcA+GWGZk1y4hV3wrUR4vfrCNqeDBLrxIasxK0S1+FWoGQDoC0GrwmeQXEvihWQeDwqACSEWBKchsuUBWDBon+jV7vvZfYJ3KyeZj3wT9Gx2vQeJ33c3PfG+GrjQWB7zDgH709wJzwvfxScAlycmps2XrXuwXUOFJkL/jpjnoMZXzdj/9FcAofipZm/g+fYZ33PffdM1nsVXwtmVnw/VjhGYt/rgaeRraA83ryfQN81ZbyCwdUG9x7RPItliCwAYhJUve8M+Ckh/DX0+f5XAi/Fg+4yzbipFWunEE4Gsam3lY7QLolJqLRMtN6eBgGYDYG74QL6dw0+E7znwPkMt6jQ0XhkenqcscCpzEJiDi2xXo5q564H1gG3D2ncLdx18Vi8He/9cHdGVnOeeBgpU31zotV2HKsySOGdgLuB3oQrAt/tuUizLwfCW6OaFevoTdXMOpjaAYuhIgVAjBsjdd8VCNirDF4bvMhOkha+qnop3T7tWfunf8/absGMT4TAZvNOgCfjzVraJWPr+aG4wmDo2TwKUgj4yv8uwJ0MnhK8oNBH8SCxeQZg1g+wkUQGQMrb0kTRyHKxxKmAB+CNcQZhBo/g/x08ne/OVKjaR4lQTHzxoWSf+L2r8b4PNwAvwoV4U52iHV3Tm4Hn4xaZeDALIfCfeObAi6PrL1M6pQAIIRYtBrwGY8Es30wO3Ar8kWWvwB4JXIYVmk6LTLPJbb4IHIWv/k80eDnwC7yqX6hw7ELTrWXsY0bbzBaITM0WmbHN/cSXAO/B/dyrm07yrM/z64B5S43D4Foz7t/gsK9PX7P59VxnxgMHuCdWAPcH3g5cQDdItPI8k+MGsPxjJN8P5vfS1cD7zez+ZrYS76D4cmA7zVwA6ddHSLmyImvKYbgFqNAFgLsL7jvAPAshxEQx3PfdiQGg/6G8B4/qX52x3Lk78GMrEf5W/mAOwNnAvWOTdpyMBRyP8Qrgp9FYAoMpAHWERPzZNcB/4xUN92swz3PAv+eM/TrgVxoc86+TYzc6Stzt+Kq98h0QTfkqvL/CPwFXpa4/T7BnzXETwdy2rpJxOa503R9Y0Wq1WLWq0zxyLfABXDmrolAWfbe7cSUnqzbEycD36I4p69ibzbhPg+9NCCGmgiIFIH6gn25ewz7NkcDnKRG65K8Gk59fi1eMK+JovMLfD/AI9z6LQI4Vo2w8lQMGMW40Xx2eimcTVGU/ulkT6WPfADykwff2N+njRde/N5qnqkeKc/j/A7jOcgR0+vujwnZUUwACLtB/CbzZ4J4znmyQxxF4qee632HWd3o7HgQ7l3Geh+AWoCwloA1sBikAQojFS2yazjNzngGcnPEw3h/4O1zY1DH7u8m9+0Bt4ybd0yz7IZzFkcAf0y3vm7dKyzL991kBamYixPvdYsYX8NiHg8oGbHCUwc/JVgC24nnodb+3N1r+6vSNlJZyYC0eZ/EJ86DOeCXeVKBXFfodUz9u0TkLeDUehDnTF5SSNXKPvj+bfLdQne/zerxqZU8qppm1DJ5t3l64x9KCFAAhxBKghfuSs4T/5cDD5vrF8krcanBHcp/U6ruqQNgDvBPYr2Y0leErwecD36JAESgT8JY9/qrC4zY8QO0PyM7xj7kHLjCyBPaNNlwFIAD/TIZCFc3xwWBPxS0ZW+M5sIw5yEzpMxs0FS/g5vczcEvF8dSvgmrAk3DLUakCWHI/BLyN9CNmE5pHVJdgFW5p2Z1xHZvNTDEAQohFSwvvm+6rP+s8sG8F/ij6PCmbZ4DnkFoVlb7yAww/hQddNcZ8/+cA/4fnpucLhApCvqrCkLqOHbgi8myyFYGH4qvsrHFtNeOh9S+bN5KvAHwGT2XrfMl05+nruOLSjq8nSwFI3Av+spo5/ZYp+HfiNQT+CC+8M8gXP4tbgm5hMAUgHt9PzRsYpTkIj9+YT20vBUAIsahp4cFkyVX7XuBdeHBUnOpkUfj/bwBXpnz45Q9dy7QQ/Azj7oMMfo4e7WQDXpL2i7hQ6FMEegRc1XGnhEeBAAm4VeR7wAvobcrzDFIWk8TreuDXal56mQJwRjQfABvMi/d8D9hpHmVfx91R17TfcfVESkDAfe1fo9xSUpeVuAUrb27rWnS+gLuY0hwV3VcLdAtdyQUghFjUtOjGALTxh9uH6a7Kk7nOdwd+RGLlSA0FgN4H7WbgN0d0TQfiUfCfJkcRiMfUQBBWue7kSveP8SI6ryI/0+I68zTDypinR7wJX2lnnf8i3OrwXLwlcmwZqePqKBT6lvF7wj0QF1m62eCzwFOxzEDSYX3fn6CGFaDgtQ8vFXxAhkvq3ni8QnyNV+Glg4UQYlFieABWnFb1VVxgxZ9Z1DTvCFygDvqAjQXUWYy+a916PFo/UxFIKwDJ1X2Omb9MOGbtsxuvY3Au+UL2WqhXB6DVapmZvZmEUpK4ljaugFyKr4ybBso18fV3BD/eDvhUi7MlLFG1cLjM4L0phqEAtIFdBq82r4fQnXP/5/F4fYI2cAXZLgMhhFg0/Bm+Oj0TD1ZLcwDwD1SP+K8iVMZpPt0f7wD4UTx2IRZS1S0Y1YRjkcKT93kbr9h3vzoXZB6h9mbyFY82vcV7qlzTIApAPKfbcAvSY6J5H0epvDW4lWHQjIBkhP9WPDMg3alwBq9GeAuuANwDIYaESgGLSRCAy4A/B85JfTaL+7P/IPp5WP1P15HdUGgU3I77b78FPAj4fdz9cDj+UG9XmaAK5FWNLT1+fbqnKShVW+u76tZT7nTfy+q2nLfbNuArwH/SrdNQfxDNWAPDcS8kShQfgkf/b8FjJ2IWgP8CjsGtS+oHLIaGFAAxbgx/eL8G91l3aIG13eT5CrwMblGJ/dwPUjvFQmU1XnN9nOzE/eHfNbhPcEXgcQbHBLfw1nmYp4XjIIIgXllW38G73lsIzU8ccn7va9pgmS2d46/2ejyr4L/wwMPdA8xDUzYwWH+ALNp4z4B3AH/YanF+u905/i7g3dG/CxO4XiGEGAqGpzllFeG5J+XFVnLN4HEEfYE//a3Uz/8ezkW7lJvDA7veYnAh7gbprayXER8w5FdciKZWEGD0vb2VarEJVd0ymSZx6zf1z+NBhu/B2xg37pEwJH4Fr6ZYuwZEhTlpA58wy8xc2J9mZaGFyEQWADFu4oCtDtHSbhPwBjzyP8+EXWgeDvnrsYAL/mPxNK5djJlobPvwYMRzAnwI+D3g6XQL07QDuSvgYdPUVT6Ii71nXzOzEHqvNPRuG/DSuB+JXhcxHSvgQ8mxUA3wtSV3fUIIXI2nG+5IvD+sdstCAFIAxISJJMJ+wCvx/u9DF32RJAl4bf/9mYACkGIBr0P/euB0XBF4Gq4IzIZu/+CQvIApIaR+Nui48cu6I/ceyGV/5+oMLOp5v4BnFHyUruAfQVxDMwyODq5Ijoo5PA5mC/B+XHEUYuhIARCTZi7A84DnWXQ/DirrsqRQJGUOxhWAGyZ90RFt4AIzXg98iMCpwQO97oGXhPXLCJELIaOpvV9cI5NBk2kOGft69F4w0oOIhmyJn/MwXPjvwdMXP4GnUl7CNKk+0VgDbMSF9KjGFvBAw1fhuf+fnMJ5EEKIgYjrq1+Dr/pyOwRSre572et63Ic8XUT56mtcczkS+H94AaS4A+Ew8s2T83gdzWIA3oKVV2S0ku/M+lP5dgM/xuv0HzXpr6OEVcD/MIQUwAqvAJyHWa2UTSGEWAw8CDeFxxUBGysAFYOvbgeePOmLrsiReP36b1HWb6B+rn3tIEBLBAGWBShmKQDpwD4zC9F1fRM3dx9ZZzwT5CC8B8Q4FIB4Dr+Gx68IIcSS4ATg2/QK/zoKQJOiK3uAF0/6wstIRdkdAvyeecXE20lXFywX+lnd8WorADNupHh7eu4rnjtWAuIV/23Al/AAyINbE8nLaMzReKbKMK0yZa99wL9RoQ20EHVQDICYBAfi/QAeTG9wV1+EedKP3PtWzdg433g2CuBqMUVBZWlS13Qj8OHgLYAfgdcSeBhxudsmc9GAKPR+oAyA4ArMt/DiPd8yuC0A7an9JjI5BJ/7ptPd5Ktq4YGiVwNvwxVZIQZmceneYqnwSNz3n8TSv2Q8KQ0P4LveDKv6FI0jzPB9DiO7BsHUEk3MLXgw2LPxKokfxwsq+SapovfWfQVLTGP83qiK5OdwIx7Y99xo/J8hEv6LkIPwrJUmw1/Ag/qaRPWvxDNFFourRCwCpACISXAWXip3Lxn9WjKi+OMfbwfeasZXEilnfaQ/6ISu+z5H4xHWi4aUpNmOz93zgWcE+CfgyiinrvTv2c0FjYV/345pKRgdOtY/rgX+Ba9x/1zgU7j5fzFzEKmmPRnXn/kR/t292eC71LOmGB4o+Q26Sp8QQixaDsaby9xKNX/qHuCduPD+C4rjBYp80ufS7T64FFhh3iL2bXjaXFEDpfh1nXk1uzoYPv9VvqvrcMH/ILOR5suPG8NT83bTf/95MGp+6+MAXIyX+/01vM5BUcOmZKbENtxldsCkJ0AIIYbFKuDleMe8IsHSxs3fh0X7PYduXfS6CsA11GyFO+1ES8kZvJTy5ykX0k3TAN+JuxTKFLU/IyqUM15Pw8iZBf4WN+H3KwBWOC8BX/kfEs3l83G3TpECEPAOgH/AInNbicWBXABikuzG+6r/GXAl2fKihdfNfzPdAj5baFbNLzDeroBjITLDL+AplVvGcD5LR2WmuIUoUG0MJY3HyUq8ZHWnuFE8BRZNTM58xNyAN4gKeAvjf8UViSTJ3X+CKwr/g6oBihEgBUBMmr14Z7cXAj+PIvTjh6DhLoJ34HEDMdfj8QBN1pdzdC0JS40VdLMDRkrI+RmYMeuscpcaa/EqgEl5nzUHWQRcyY27F+4C3ot3NoyJYyfmcUvO8+nWHBBi6EgBEOPGcD9+sh1tG38QvgivDRDXmN+H+5I/Su9DcBuuBFjZiTJYiRdVWYoCahYvdVyEWVfQ1MaIWwPn7t8KgY3UbDe8SDiAroJlqX875EjrBTwociHx3rXAm4DL6H4nt+P1/1+Ix6skWY1cAWKISAEQk+BuwBPor0PxU3zV81/4Sulc4O/pN/ffjvuxC0l1lotpAUewNO/9NXhwZSFhAAUg0Gnik4cBG1hiCkA0WRtp7j7ag1sA0vwEr4uwgAcJ/ineJOr61HZH4X0i1A5YDA0VAhLjJg5sejFwDPDP9Ar4y4HTcL//WjxoL80+fPVUxTSaXKnFlehOxJWAqyc9GUNmbfSqMy+DYEDI6EW0miWmYBm0ggdZrmu2OzvoF+rggv9jeCfI/wDO6NnR2yyejGcBfB21BBZCLAGegQes/Q2wPkMarcRXXFmCxPDsgeJUQOtLqYo/223Gl4HfYGmZVO+DrzLLSvPeQP2mSAa8Myos1NeHIZEZEAy+QrkrYlEQ3ZeHAa/AFdd0+eMqPSkC3tL4TjmnmQXWHZ59+l/Hswe+h4oACSGWAmZ2MF7edhfwd8ChNQ/xDKqlAvYpAOb52m3civBW3BKxFHg4cKOVz8X1eCOmOhgejBnob/KTFnZn4haWxUlX5Vxp8BhcodlJ+b1WpAB8hwrumQQzwFPN7CL8Pn85S8yqIoRY3jwNj/LfjftBK69wDB4CbKVaYZq+baz7/l7g+8ATgZW2uBPXfxs3EZcpAE3rALzdzIJFgt+yrSsBd+PcZdKT0YQWnX7EJwHvjuZq0MY/AfgI1StQrsSDALdE5/4JS6t4lRBCcACeD72AC+IvAHettKdxPG5WzWjLak0KBG0F3mNmJ016UppiZs8C7qCaAvDAuofHXAGgd+Wf121wUfawN1hr3n3xp3isSZmLqer99WaqreDXAq/GM10W8NX/S1iaWStCiGXOg/EGKfHD8ju4L7sQgw1RTfVh9WWP2xL/BO+8tqj6BUT8GeWlgGPXxwPqHNg8ffBtVj7fbbwQ0G9MejJqYniQ37+Zjz++H4ahAOyjWhvqQ3CrQ2zFaeNpsRsnPTliaSKfkpg0Z+Kd4kK0xHkwHhNQKKDMuC14/vRQsO4/98OrE74LuLMtnr+QOL2xk9mTs2SM57lWcZk4py9U228ViysG4EDc5H468ByM/enWosgnYyYs9YrYY9kZAEk24ffci+mm+m3Hs2RKU16FaMLiebyJpcpe/MF7Veg+Mx+IKwG/lvcEbgfm8TS+gaukpc7RBtYDLwBOD22ew+KIaG9F4+5cTs7ENOlHH1evsXQBgYxOjgH3YR9e6cCTZQaPJflnM95hcGdKyxzUwOL/2BGKU06PxKsC/j7drJQW8E3gS5OeJLF0kQIgJo6ZnYf3iO907gXuC3wwwMOy9mm1CHhq1E0MeB9HxQHSlV0N77L3flwZuevMdAcIrqBijnoT+RbNkYWS/RNFhlZPekJKONS8q+SHgFNDYE2Iv/caX3NW6+nQ+4EB5+AphFkcB7wHeDLRfRwpDTfjVTBvnfRECSHE6DDD3O9/Mb3pem28wc2js3ZrGWsMXosrAYW+6VSuev52lrv/WXjq4bTGBhxi8F2DYGZFbWnb5tHldTsiVm0HHHexey/TucCYBR4BfNG6aaQ9vn5PE60WSFqScjkP/AB4iGW7E+4BfBXYl8qoCLhioqp/QoilzSrAYM7gDSQirw3mE0rAo7L2tVZrNS6Yf4w/cAdN2cp70LdxReMfccvAtAm34/HqiX2KUEr5aRQESAUFIJFaGQw+alMkwCLpezR+j11NfaGelfKYt30AbsRbB5+YM6T74OmnyQJCsfC/nsUXRCmEEM2IHtAn4+bSePUUvxaAC/CiLD20WrHVlBOB95ixzbrFaoauCETjuRB4JXDoFHkF7oJXAcwUUBkKQO00QIN3GLQLrCSdFazBt1pmB016UiJWAU/FBe6enHkps2qkX3nb7cNX/U+KzpvFfaNt2hn7L+BBqNPuQhFCiKHSwkuuxg/ptBJwMV6wJ2/1vcqMU80frskH6rBfbbyc8JcMHsl0lBO+Hy7YqygAjQoBGbw9rQCklIGkCfsnTEfb5eNxd8S29NxUVADaVFMAAu5aeTPFRXt+Fc98yTvGRbiFSQghlh1HAT+i3woQm/evxCsIZnebmzHM2/2+EzelDkUJyBEW8Wr6LcBRE/YJ/AZwkxWNv9sboWkp4LdRYAGgVwE4h05RvYmwH36f/BhflRfeB1Zd8GcVPtqNF7H6dYqVwYcAvygYyz7gr1CTNiHEMsWAF9EboJVWAq7GU6b6lIBZOu6ElcDj8UIqexmtNWAPXsDo8Xg0/iR4JqneCJb98yDNgN5OxiqabAXgCuDuE5qLu+KxGjclx1u02jfrUfL6BL6ZtaP+EenXZXg2Qa61o+U35K8CPyP/PgzA2XgJYiGEWLYcbsa3zXoD2lIP8M14xb6yhfcx+Ar9OlKxATX8v1VXjDfgldxOnGHstVtfQlnp2u5rKznplQXEzYCKFKmkAnA98GvjnQIOwus3/IKyKn7NTf/x9e0GPo1bUmZKxvVgXPj3jSkRN7EHd39NW3CpEEKMj1kwM3uOeSW0ooCrq3Azb9lDcwWeRfBl/EFbWj7Yeh/OfX7fAuVhH+7/frqNL5DL8H7xXQFjZJaqtW7fgyYKwDup5gJo43ns44pkn42u51PkNEOqqOxVuQcCrnz+BbChwtgeia/sO7EsGVaTAJyBqd2vEGKZE0nzQ4DPUyys28BVBk+nZBUWrcYPBf7C4OoKmQI9LW+LlIGsfaN68v/IeLrizeHFispS1OKx32BWe3WebAdcOGfRXO3AuxOOmqPxwLstdF1Gw3bxJFf9nzd4aKt81d8CfgvPGEm6srKOvwN4Nmr4I4QQHZ5Ayo9Lv4CLYwKeQflDmWibhxl82dwa0C6IBq8aCJb3mseD4f4Q73w4KtYCnyVbOGeN+1qaFQIqigFIB8btAZ43wmuexdNCv0u3kM4o4jvakbJ4Gd5saYNReqMZngZ4KeXjCsD/4cqpEEKIiP2Bj1OtuM1mcgID00S1ag8ztwZcXiMfPC1Qc03H9D7gdxh8FC++M4pV3oHAt+haNcr815uBezc4z1sNy7ru5Mo//n0f3tZ2FNd7JPA3uCITqPf91XEJBGC7wenmaZZV/POGB4NeQjWl5A7gOSOYIyGEWPQ8kQwrQIbQbuNm4OdTIS/fpZLN4AVxPoTHG1SNDUiveKu+LgVOw5v2DJPD8dzyOgrAvRqc5y051x1FyvcoAG08ZmCYKW0rcbfCt3BzfKFQL4hVKFMA4vGfi99PB1TUYlq41aqnpHXB+QPe8GcxNE4SQoixsw4X0EnhlveAjwPcXowLixIseY4X4NUGC2MDylaOFQTLTuAjwL1nZqp4LCpxcmrsZa8t+Iq2Mi2frLdSoAAQuVPoVgP8F7OhpUWeAvw9XmK31NdvJQpAwSvgDXj+Ce8OWNWEMYMHpF5OBeUwmqftwLOqn0IIIZYfD8dT7PqUALKF0c3Ay6ikBPRwDxLWgCaR4zVeF+I96IdRLvd+wDVWIvgTn19Hg1LARIWAILcCYPJ7CXhxnEFbKe+H1ziII+l7hL+VCNma5X7ncUvK06mXwdGK9tlMdctQwONQ5PsXQogCjsaD6UoVgMQK9BZqKgFRXf91wHMMzhrA1N87nvyV6HZcSD6WwQoI/TruJkkL4yzh36gU8Ix5KWBKLACJ3wNekrmpedtwhexf8RV57e+hhgIQojl5O3Bcg+X446i48k/N2RtR3r8QQhRyb9xsnTZxF5ng23hp3NNoIFwN7mzwD+bCpzQ2oGgsJabouIDQO/GiRU14Cp5KlqsA0K8A/EqdE7RapYWA0u8HvIVyk2vaH/hjvAtkpql/SNaZOFjxG3idiLo9HVp4TELH51/D4hCAD1Atc0UIIZYtj8MLvCSDzUqDrMxYMLNteJW8ypaAFp1MgdXm6YU/i47ZU0VwiC6C2Pz8Q1ygzLWqrwsN+DMzT4Wz4pV/Mg2wSTvgskqA6Wu6kHqlbQ1X9k6nuAjUMOY7RPPw18CmmnMBXbP/VSQUxKL7IiM75EsMPyBUCCGWFC8jf3Wbv/Lurh5vxtv31qrMZ3TssyfghXZuJZF2NoIYgbiE7nPNKq8MZ8y73WUGAA5VATDeadWtIXF9hnvVOMMjgPMHmcOK5v5dwOfw6oFNVuAG/E50fX1piFUtAAa/MDNV/xMTQ/4nMe0Y3mil8r0auv8a/qA9AHgN7g5YU+c4bR/AZXgRmBfh3eXaASxUPVDqYgpoR9f6KryhTZXjGQVFhkLubg3+9utdcMALFFVtCXwQgZfhkfdNpjZviJZ4gWdLvArPvf8OLowrER1gFrcKvRuvR9BOn7fi4EOAg0MIhzS9ViEGRQqAmHbW4D3dwZ+tPS+zTvBeHhb9bx1ev/3l1FAC4pPiq8aPAL+LB4ttIfX3k5QyJccqog2cEAKPrnA4grs24jz15NzknjpSGmqtfKPj11V6VuBFiqpwN7w6YWPhnz9sDLfe/IuZPY2ZmffjVqFaBBf+z8KF/zF1x2p9h2N/4IghXq8QtZACIKad1cDG5BvJp3oI/kov85IkJOJa4M+j135NBmNwJe43fibuw52PT5uWvFYqvnOZwQVDlb/P1cDBGeMMidOH5L+hmq7SezyzJsnqs7jiVYUD8e+kSKjWGXe8bcBjOF6Iu5LOY6Hyoj95uJZ5nv+b8SqStRWVjB1W0Sz+QIihMMwqXUKMgkPxVLLO8zOk/k3+XEE6rMXjAVbghW221xlMdJ553Hx8AV7n/0XAUaR0gNBgLRubKwjVVtvmQvPg9Lahf4rSp6klz4O5rlVT7M3iTZ1qT0HJ+7FgLzvOTXgZ3w8Er8JIaPKlwAyEpwV4m0X3YvJ+G8BkMQsc58ev7ooQYljIAiCmncPpNyPnCrAKD+OAr5pPwy0Bg7Ts3YoXx3mmeT7/HmoK1qzBuaStvP2aUL5yTk5cMOuoGdXH1Q4WnaGOvGvh1okq/RmspsXEyDb8GJGCZvBcgz+PhX9DDO/q9w7gyFBDr7PU+DIur2WwyeqnHwoxFKQAiKklujk34UI6a5HfVNgG3Pz6HLzE7CC0ge8GeC7wWlzY1F5hp7FuNmIZB1PDneEKxjBj7DrjzWM9FSyNwbABvf9xYOP1eE2FZ+LtpPcMdFS/956JB/z1jbBgyOkp6bHoWHf/Y0LNmBQhhoUUADHNtPAAwBrV/Cz1e+6mAX/wHsxw2Aa8B/g9PFhwBxWVAIvGmRx7qK5AHEyvglSFOMGhDn37VBigAeusiqvRXR5NwybiVf//Ac8FewNwTV40ZE1WABuqDCBrwvI2C8TWGA41G0o5aCFqIwVATC1tN40eQ/c+zXrO9ryXXt2WLHZnGcwFkCYAP6UbcHZpPEAr2Slj7FVl4VoyTMglOzdRAOL9eoRYBQ4K9Sox5g29d3J6t7oR71T4LOCreHW/YTFLyQq9b6lvndCAKlN0COoGKCaEFAAxzawjozZ7k1Vixj4B903XbRhUhe3AvwHvB+arSILmVnkOIOFjT5iWi6YiAKFhDdq+Q1tOSHw0loOoZuJ2PalYW8oLsPwEHotxbenV12cWV7ByDxp9vx1/f8l3mby6EAJrQlAmgJgMUgDENHMgcFja+d+zDK1Ijjl2htFmwtxkBSvtIfSAnTH3TXdkeUXRN2uwqmbYeYucWIOQM7lRLONqq2FlCeXaUrDEK9r6JmDvwLOZf90jqdcfXeYq6pVLFmJoSAEQ08wxeCW5PpmfkhFpWboPuIRyodBitBHYhYvBEmFdRZbPBLcA1NElAh6Y9zyDwyuG3reARwOPqXOSxBirKFl9QynyBaT0hFGm0K0g4cIomK3NwB2JYVUNBG0Bx5gpJVuMHykAYpo52mC/CmbtJAbcBnwSbyBkJdtOJAWrcFDVQ+HqV/TzY7cCPC14RcNNJQ+BGbwAzgfxnghDta8XTUmNEw0p3i+TtfgqvWhM+/D7bQslQj/HW3ICXhVQiLEiBUBMKy3g+AArGjzZdwA/woPDyhSAYQYBlpOo2ZtHFAxY5W9zHi9pW6lmkHXqFQJRTftAeHcwjs7ZZw74A7z07fG5B844UUKH2QXsrDK+AeIgBk67LGANCQUg59y78E6OV5aNI+cSN4VQuWKiEENDCoCYVlbSmwFQRnLdvB1/GF+RuWHvj+PNwa4m5Ko261nAmxNVSjmMyyYnmCHwlBB4L/QpAXPA8/Hguo1lI09KYFdgOrVvLqJa3f3M8ZcZQzyFcoCiy+Wswe/FZC+F9D10I976+PqSecr77AC84qUQY0UKgJhW1uIKQEyArkBI9gPo2cDfuhb3yV5ExkM38YbhptfR/R3E47W+t/J38Q0qFQJqtVpnmPH9KtvmbNMCngi8i+58z+GFjd6A58AXCv+sDkSRFeMOvF/CjlpTlvpSUxX1+mJBQgijfI6tI5UpkuFvuAy/38oUgL5LpRuTcdwIr0GITBR4IqYS8/Sxw9NVceMVbFY/gAQ34MLnPLwSXFEe+jpcCDbJiy8jEMxL6EdVbqqU+Y2usdKqtt1ub8Mr390J9yW3M+rTlx2rBZyKm7pfj3E/Am+kQgGcFMnzLGB8pGV8tl1zZpPXn9fOOPalj8rxn7igVaFYQQzAL3Gr04V44OnKnO3i6wo9P/j9qVRAMXZkARDTibEJOLCubdfcL34h/u9VROZxs0wpaLjQG5UJuZ2sbzuAj7uM7wJ/hrs86rbsjWkBjwM+SuAtlDTxSdVjTq/MF8z4X8NeB9xS8fzpdsVlG4/S7J9kRTQ3ecGZe3FFcwG4jkTmSYaroOc6Q9eYMIOXpFZPADFWpACIqSQEjgrG2uDlUqGiiTt4RPZl+IN1C16i1wpW3isqHrs2Bm2sM/5R0gY+hysBV9H/d92x0qcbKWRk3p1EBbN/gXN+Afgo8BfBwnV1V/918xkT1z8qVsfDyumhsB2fc3AF4BbyrRdFl3c0oylKJUQuUgDENGLAUQRfEdVYORue+rcl+n0bcHXJ9nOMSAEIWFbgXfLcvarNYJpCewY+g3c43Fz1mkL2W6UzHhJ2+lQ+/seiMVzbVCyP2qxfcyxFMSKGC/042HQrHhDYdy0V4hQ30d/1UoiRIgVATCOzuD+7dgU2M27Bg7HAV2e/JBXBnRKNc4zs7yDkPvXNOlVvu16CZr0AumfzlfCngFdHc9BKH6hMuNbVQZKrcINPtuAvgGtH6O4YJ2bGWhK3TUqQG25t2hb9vgO4PrMxUOi9BdMf4/0A1BNAjBUpAGIa2Q8vcZukNHYOIARuoRt1vg9XAPb1btSz3ypG93eQl59uA7TkzSVacC/g3QhfgwdDtvLOlFyddlP4Kl6U9fwagE8DrwxufWhMUZlno6e+wDhUjFYIrCV5f4SQHF8b9//fEf2+C7ikQpyndTtAdq5lrcERY7gmITpIARDTyAZ6UwBj8szTyfeuwFf+MecBt5IvV0apABQet8zWPsCgFoD/oWsJKC5OE0LtXsKJQ7bxKnivMNg8BKmcG64RomyKDEYVZdHCXQCWbO+XUFJ2AefSjUFYwFNQS50fIb7Q7vWsCuoJIMaMFAAxjRyC+0PLFq9Z71+Fp/4BYMZmin3iqxhhOmzFEnWZZuEBI9vmqaEEVLqW5PLbJVcb9/m/HLh6wPGOK6q/3iXDmhybveGK5WWpj7YAu6lvoZgBjmJEjYeEyEIKgJhGTsFXXnUfonvoZgAAEALb8IJAeaykXr/6OnQWeOno+87P+U73YZi454EPAa+i0yq3nPwR9ZZkAD6OZx5cM6wJazy20Z1uLr7YjM+20D+v1+Cljy1rt5JK0CfiBbCEGAtSAMS0YXhVtDpCOV5o76J/RbYHOIf8jnGrGF36VSfkIKTfjH/Od7oPy8c9D/wv8Jd4TECmYKp54oCb/T3afziUjmuYk1JjTHOJCpPpApSX4VaAJDfizaiajP8IUE8AMT6kAIhpYxW+EsquDU/uKtDwldetqfcDcDFuliXjs1mmsyLmMDvczQMftl53QOVjJyvYRPP/eYNXMvyVf60FfmLjUekFM6FfOYxP2wbOov++2oqnntZtUBSAg1EmgBgjUgDEtLEfcGyF7ULqBb4avSFj2yvwhjRZFvcZRvd30Egw2Wja28bugFdHc1T5mlPWi68Ar7Ti+grNSJbNqyA6Q+aPQ2UF2Z0A45bTv8g49x3AjQ1dFQegksBijEgBENPGBgrK0JZIxuvINr9eH72yWs62GK0CEBLpXpV3YgTV7YK7QU7HUwS3Um+FasCXgdOAS0dQei+z50PJeEbNnFmvApA46XXAJRn77MODTtvUU0wCbm04akzXJoQUADF1HEGVUrT9BHxVujfjs1uAC3L2m2XENdjDKNbzzYmzA15rxrZECYA8sRObsr8KvAzPcx8R1lTyjeo5tiIEVud8djHdAkBJ2sCVwec5/0Kz35zF41+UCSDGghQAMW0cjptdS/vPp35fwIOysh68e4CfAfus/7ir8Z7vo6DjB061IK7CKFWGeeA/Q+DVRL0SCs4YcLP/n5K94h3eXHk9grq+c2i2TxVW4i6prDm5gG4BoDTX01VEK3+P0bUfg3oCiDEhBUBME4a3tS3NAAj9v8+TqsOe4hfAbalFZsCVjWmIvB632Xce+O8Q+Cu6DWyymgZ9EXgJvuKdVkY1dytICePovtuNBwDmCfcteE+Kvg6AOb8nORZYP6LrEaIHKQBimpjFV0BF92XWai9uAnRVwX5XAtf0VnIF3Py/H6NhEME0DoVgH/DvwBvoVQJiCRWb/S9rdPT6F1v5mlMbjuo5Nke/e8jwubqiYL+b6a1GCdUDOzegpkBiTEgBENPEAWSXAK7CLRTnpG8j24RtkOvnHQXTEw3g7AH+CXgD5pkS0fvfBF7BGIR/k0lJuVRGpSzthysA6eFdTbGyeSvF1qiiyzoAOGxE1yNED1IAxDSxHk+DqioPkoVZrsaVgDx2AWfjpu/k8VuM3+eauRrMaLIzLvYA/4inCF6Fr/xfSn7g5LQxqrlaS3aA6Pm4xSmPHXQ7UqYpurcDrowqFVCMhWksgCKWLxtxJaBS57/Uv5dR/FAO+IP7DrzMcIwxIgXAzEKIfA7pC4pLwiaqzIWE7X2Uq9o89hL4D+Cn+Op1y5jPb2bVuhEm90n9O2xW0R+RPw+cY7CnYKh7cGtUztdeeH+vAI6nZrEmIZogC4CYJo6jPCAv66HYxovbLJTsexGe/56kRXaxl8EJIVjOQzxlAsjaptUavxKwgAdLjlv4Q3aNhsr7jmhMq/FFUnJktwHnlQx1AbiURBvqGrTwWgAjTU0VAqQAiOmhBZxAIgMgWRiO4of8HjzIr4zr8Adz8lidlq8juKZkQF3PxVQ423L722xUBjgRPDiK728NvRYAM7jBrNK9dg2JrpQ1x3cCvVYqIUbCcnvIiOllJf7g69yTCfN4GXvpX9lnsQO3AiQX4C3c1zt0AZLl6E+H2WfQkW0jqLa3ZIj6EozaRL6afhfAJWBVAvyux91NTe6rTSgTQIwBKQBiWliDxwAA7hC2qExdyRPU8JSrGyhnHlcAkkVa4iyAkZiR022AK3bao9qmy5uEglW37G5V1tD7FbYDXEQIOyvsu5XeoNSQsmilSd7qygQQY0EKgJgWNhgc0YmSCsFfFD/Zozr7t+K516UYXEhvkRbof9APC8trA1yB5aYANCiW2Nmvia+9Csn7IuCK44WUx5qAW5tuJeHxCf3Nq4x+90WcCnjsiK5JiA5SAMS0cHDwB1+W4Os8NHMsAlsp6MHeg7GZ/kY4KxnN34KVfViwwXJTANp0Vsm1L32+yU4lpF1DcQGgiyueaDseTNnn8anQxngONQUSY0AKgJgWjgPWhZKyqaH/DcMDru6gAiGwDa/i5mn3/ohdwegasOQ+xNPXUqdj4BJk2hSeFn5fJBWALRQXAEqyFw86bXKhM3hJbKVpi5EiBUBMA3ETlNIeABn7tQlsoboZeCdwoUE70aUnrvg2tovNIoSej5ebOhD78ft0vLKJsBG5b+i/Jy4Abqq4/wKuMJS5C/L0gSMYXYlqIQApAGI6mAOOxWqtwmP5PY+v6KsGzc8D5wTYG0maOAhw6KutPBN/KN7FfzCstYz+Os38+8vz/xQRRqcAJBXSBbyS5O6K+wfgcrLbU5ddYgCOBg4ZwXUJ0WEZPWLEFLMGOJrQMcnXYVeoX7gmXsnFZ5tjBH8LVbu/pInnYIDCOIuOKbzWZIEow4P6LqTeV3oDsLPiLZ22emwwb40txMiQAiCmgU7aU6i4nDMPGDM8+O/aCrskuRpfncWZeSsZo7+1LLUxBIgSIJYT6WdRnesfxVzN0M0CMLyZVN3GSDcCt9WwUHRcIAH2C14XQ4iRIQVATAOHA4dS4UHeaZjTrQKzjfqd126m2889bsAyihiAzAd/X/Bfd8Pk2+1lpgQMYsYfxTzFTaLiY19CfoOfPG4hkQpYkxW4G0CIkSEFQEwDh5MIeOqNjM94doYek/FWKmYAxMy5P/csuv7cFYwoBqAK6b4Ayy36D3ID+fIEe1qHGpUCEMekBOA8PLWvDjuJClQ1+E4NTwWsGxgrRGWkAIhJY8BJwJqs0q4hwzmceucy3D9bmShd4Jf46gx89T90C0BoKJji8oTLiVD8UfrVw4jSJ42uArAL+AnVCgAluQO4mJIQh4Lxn4TXIhBiJEgBEJNmFjd1zsS+0kL/eO+vVVOtsrgKbyAUp3uNpiNgQ2r0QVgqeFHHBlc8ogDCGbpWoa14AGBd2vj9WZKhknvRG4GDRnJ1QiAFQEye1WackDQB13ie78WLADXhVroP9RkmbGq1Sm8taabtemdwxdDMFcWm99lVuAUh/yKzNZiApwEeM+mJEEsXKQBi0qwLgcMb5HKbGXto/mDeg8cBzNN92E8Ey25rt9z+Ni0Of58S5oiCAAP8Au8f0YRr8FgAoHadgzXA4aMqUSnEcnvIiOnjCNzUWfvRHwK3U70yWxbn4paAOTwTYJx4s0PrF3qRJtRi+lbFU0EnE6RL05ILRazCBfAuM36CK4pNuJmawYOJrJAVwMltPafFiNCNJSbNIcA66j/ADU/L2jrAuS/DV2jjVgC8iqGLrb64h2Xo/69NSmmq0DW6Nqui19YQOGeA49yExwFUHl9CmzG8FoB6AoiRIAVATJoTcFMrUPtJfiP1U7PS+5/LqBUAs94Va3ZmY4W3lifp6RqTu2QFfl9eQv1Kk0l2EKUCNrzkI4IyAcSIkAIgJkkLT3Wag24KQEXJF/AUq6q12bPYDfwYzyJYOcBxcsdoZv15/YkLLGkHvOyUgJSeZESxASVa4SisJSui1wUMpmTuxYMIO5kANZXcTSgTQIwIKQBikqzCYwDK8/+S+HYLuAm/SQpgkp/TjQMYNiG286cvzjobFOy7vEg0Z+ybAItcJZa502gUgDnc7/8zmvv/wQX/JWbdY9TU7PaPXkIMHSkAYpKsB45JP72LnubdJSF7yOm3XpPN0WskwdZxZHu6oFGIfAKjcF4vcbKUgFEoS3O4//78IRzr5hAaKREBN/+rJLAYCVIAxCRZBxwYV/aNmuDkPs2t98dbcdPqoNyM+3lHoQBkyXZLCv3s0nYjq243zQwixEehAMziOfxXD+FY11HPjZC8nlXAkSO4PiGkAIiJchTeCbDSAzxRC9Zg4BTAmD3AOZRWaxsabgvotQj0iHsLU5UPPy4al00OZqP47mbw+v+3DuFYN+L3ax21Lr7dZ4DjUCaAGAFSAMQkORJvAlS7AY7BdTZYcFZMAM4mUa1tWFiBhT/d8MgShoHQv4noJWlFCYSwwPDnK24AtG8Ix7oNV1ab2HUMVwDGXadCLAOkAIhJ0cItALPQDZOr0UFva0hUWBuQS/FUreEa3rMr2/cnBYRAiAsCdD9ffk6Aiph1QysjRmEB2M5w/P8AtxlcZma1lZToJjgaBQKKESCzkpgUK4A74SbOBehbwpWlf9/McFZn4MJ/z7AvMNS04/dYBaBljM8vMYXkKkAZ09pm+BaAy6jZZrqAvQGutRDaVFTszDrxMAHPlDmKweoRCNGHFAAxKVbhOc5ZD+6yh+Q+PDhr0BTAmD3UL9ZShToJDj0EMGu1oL18VQBjogWShnk/BGBz8Pu2UtOphJITZwIcMqbrFssIuQDEpDgUVwCyKHvI7wUun/QFDJuUw8Da7faydgPEN0HZJNjicJdswe/bJqwEjq0wFULUQgqAmBSHAAeTL+xD6pVkwYwdk76ABuSH/uOrvpKKwcuJTgHAEtcQwd1I0z5dO2husZrFleVpv0axyJACICbFcUQZANR/sK0JgaexBEukJoTdssoEzAuXLJsDMwwXkNMsHA8Gnorf79Xmo//Xo6joPhCiKlIAxNiJTLbH46bNJg/uFvAM4G+YbiWgsP37chLwZYSQEciXP0FeObp750xzLNMhwJuAZw04zk3UUCCEqIIUADEJVgDHMNj9Nwc8H3gjvsKaRgaJTg8jKnE7rWSZxwuvP6ocOc0WgE3AO4DnUnP1nrrwNnAYXjRLiKExzZqzWKIEbBWETYMfiRW4EgDwOjw1cDFQ6vaYRmk2YgZRdqZxIXMMLvxPpaDMdE6mg39mPX6g/ZEFQAwZKQBiAoS9wLVDOtgc8Dx8lfQ6hlO6dVi0aCjLl9PSvyFG1FNpCoMljgbeDfw2Aygn8XWZV4e+Hi8nLMTQmEbNWSx9dgHvB35IVPAmSR2Jad44J7YEvB44cIpWz0VD6clysH6T/xRdxlho1IwpBALTVS/pSHzlX0n4V9BdLMAVwJvxrpVCDA0pAGJSnA28GDgjlf1WffUbF4P3HVYCf4wHXB046YvrHWE5iVzH6VvPjofG1hKGVxBqUI4B3gP8DsN5trbwjpcvBz7HdCk6YgkgBUBMkp8DfwKcQZOHf3/XvBXA8wO8AVg/6YurQrL/wXJb8qcYpB3zNEzdscB7KfH516CFtyN+BfB5JPzFCJACICbN2QanAWcSp3cx0BN9BfCHwKuBdRO+tsLVfJzGFqpsvPRpagEY8HYZjOg7PM7gvQZPZLBnanwtLeCK6O/is0j4ixEhBUBMnFn4GfBS4My4rOsAwjDg7oA/wZWAtRO8tPI0tvyPp2FVO04Kn0VWvu9E5isETgDeF+DxodoYrOAVf34ZcNqMhL8YMVIAxMSJWvqdCbw4wI/DcO7L1XiMwauYlCVgMJG03AwCofGHEyBa+Z8A/C3wW5Tfs1UsFbHwfxnw+fb0XbZYYkgBENPET/GV+w8YfEUXgDW4GfV1TCImIKeIfZS5MIRLXFIsUF3gpftDjHUizb+8E4D3AY/t+zxjlyqHBS7Fhf8XgKClvxg1UgDEtPFz82j+ZoGBXeJ91wAvAd7GhFuqdnz9neDF4MLEcjdfThpCprzL6BEQJur0d07C01gflzWUBst2Ay4zeGkrEv6TvTyxXJACIKaRc3ChnWkJsOpP/7jQ2gq8HOvb8DbEYydvyKEkEGAZkTkLWUV+4uW/lew7bKLz3Ql4fwj8ZsXzVjH7XwG8PMBXZPYX40QKgJhWfoEHBv6IdJ2AUFsJAK96+Sy8gdC46gTktf8tHb3VusTlSaJuwiA9F+qc7y7AB0MIj6a6Wb/s880Gr8RT/ST8xViRAiCmjvgpaF4n4MV4xcCMDqm1mcUtAeNUApLXlI72toLtW8tVGuQpSpbxXsQ43OV3B/4OeET9y4je6NXqjKjIj7X4NBL+YgJIARBTS/REjJWAHktAaFYAPuC9A17AhJSADKmfpwQst7/NzLDI5O8F3/iohWcs/H+9aPyWSOnL+lITg4wD/v4U+GTUClmIsbPcHjJicXIW8BKDn1Az19rM0jsklYA3AwePytSeJejT4esFu00st31CZM5PKNg2tdnQlYDoJPcA/h54MPmWhr7aFdkBDYC3L74Yd299nsa6rBCDIwVALBZ+FnzF9DOyTcOdn5PLr0CwkC0wZvEGQm8IcNAoBlyxMEzyEizjveXCINc7EhEaXPh/EHiwNTtHsuETeGOf8/BU16+MatxCVEUKgFgUGDDjboCX4PUCuu4AIqFvkdANqQ/98ywBEysBf83kGwgN0hRxKVD3ekc9Px3hD7QbVGxM1ykwXPi/ZMXc3DeQ8BdTgBQAsSgIdFq+/QhfQfW4A0KqnV7S356wz2Y9rFfg7oA3AQdP7AKXm7jPnoGmszAzwL5Z3B34AC78SwV1xolDxiYXGpy2fuPGb+/dt2+IQxWiOVIAxGLkJ7gl4OcUR9JnkbX9HN5A6K0Mt1hQZwil0k3rwSzKZiWe1tlhnKzlX9A98YC/h5ScP6VbZo/ZvGzgL4GXBvjmrddfP6apE6IcKQBisXImHkjVFxOQJO2EjchzBzwHtwRsGOZA45NlSZNkvIKMAI0ZigUghI7wfzBRxcEM6lgqLIRwDm6x+np8EiGmBSkAYlESPYV/gD9cf0r9qHnLeGMGeDaeHXAIwMxgnd0LOxua9X5YtJJc8gxS9mg4mtM9MD4IPIgcXa3imZIBnT8H/qQ1O/vt4U2UEMNDCoBYlCRW9WcCL8fLBxu9i/6y9DBLHxN3BzwbLxu8cWGh+RhTOex944irAGekKS4/KibDpfSEEP1/0Dz6OwPvCaFX+CcKUtVVMVr4ffn/gDPa8/OjmjUhBkIKgFgKfB93B5xL9sO6shIQMQc8y+C9wFFNB5WTflg2uGXpCbB8ZS0U/Fb8btk5fabvjHf1e3j2sLCabQcNj1H5E1wJEGJqkQIglgrfwQMDz2Y4QnQGeDLwDmBTkwM0WDmmdl8+DNgSqVkhoNAR/lnlfS17l0IMj0mJY1OEmGqkAIilRJESEMhvJZv3sG8BT8GzAw6vO5hQsKLtSVHMZln9bZpVa+iTcJmExFtNlIc7Bxf+j6T3a2iajhgL/5fgqapCTD3L6iEjlgXfxx/CZ5Hdq71uHHYLeAYeE1BbCcgiFfvX+1l3xMuqFHAIVvlrGUID5bvief7plX+t+Y6+q3gsPwT+OPpXiEWBFACxFImVgF9QvxxvFjPA71HfEhCKAhIyl67dyoW0ltFfpxkW5cx3rr+novNwzgFwCh7b8XAGVLAiTdLM+IF1i1MJsWhYRo8Yscz4gZm9BM8O6LnPi+q6W/4HMwa/D7yTijEBZhaqFviN7c4d5SBAexn1iAshWE8iQP4yvzxQMPcc3An4W9zsX4uCr+1HIfASM84a64QJMQSkAIglSwjhDOBlwAUk7vUiaZFrmneBNGPwu/gK8phKIwiVothH085ucTHqZ9HdcLP/b1TdwY/6g4wAAAisSURBVIpNEHG0/2nAWe1l/uWJxYkUALHU+TYelX0+3fu9tuk3YbZv4dkBpUrAgEXfKgXFLSF6nkWJHPxkNkUngDJF2TzdFfiA9Qf8JenrMFnSAOhM4MUo1U8sYqQAiKVOAL5hxkvM7Jd07/mKredzswaeSElMQJNw8sT2y8gBAFSrkZAnmIsUgDvhytpDc2v7Vunn1zuEH6I8f7EEkAIglgUHbuBbhPBS88YsBh0BXWp9L2gqFKcIHkr+Nk2RAlD2Qe8mWZudgvv8H1FwIAshM1skj28BL8TLTwuxqJECIJYFt98Kq+Cbwc22vyAhnLOkdMXVezI74LD0h8FDB6ySzbm7T/LH5eQCyA2/SP5cY0JOAt5r8CizamZ/PGujqAnQd+lWnBRi0SMFQCwL5vd1ltTfwmu0/zQk7v/MqkHVDj0LPBOvE5BpCUiXki3qDlj9tEsOS/1bh3Q3wGOAdwGPwlf4dcna49u48D9vkpMkxDCRAiCWDXu6P/4Qzw74RYBWkbA380RvK+5WN4tbAjpdBPNYbsv6qkSr9CwloDNdBdUTkwrAJtwi81gKLAYZVoEQ/y+kzgt8BXiRmZ0z6XkSYphIARDLlTPwFd3PKVh1huCN6sqa1RnMGjwLeBOwoft29mErjK9pSdpFSahQMSESzmmhbrgCFnDh/w48NqOokXPaKlD0fXwVv08uqtiwUIhFgxQAsWyZW7Xqey2zPzH4MUMQtsG7CD4HeAvlSkAe8fat5SP+o+sd7Ds4Ci/S9FRKhH/F4xnwDTzP/9JJT44Qo0AKgFi2zO/ZQzuEH2H2UryoS2MBlFgbxkrAO4Dj6h4nsexvLTNfQaNYzCiL4xBc6Xoabg2oc46s92Ph/1LgoklPjBBCiJFxEMAD8NiAACw0fLUTr73ANcC+vG2td/vk78HgI8CqSc/MGHkusCs1h3mv5DzOAzcDu6n3/WTNe/z6MnDypCdEiFEjC4BY9szM3EyrxZl4cZcf0NwcnUwhm8V90rl/YyH3dyMsI/9/HhUnwID1uOWl8eESH34ZX/lfPOnrF2LUSAEQy56FhU7jnZ8DL8JTBRsReqoGNzXihwH3X5QUFj4qUQZCze2zdg7A5/EukpdMejKEGAdSAITo5VxcCHybCnIkJzswDLB8j4XZcqwEGNJv5NDIOlN0oODC/zTg8klPhBDjQgqAEP2cD/wp8B0KKvkNQE/f+8yfJz0DU0K6TXLVeQlkfnEh540v4XUhrpj09QoxTqQACJHNucBLrMwSkF/Oz0jUESKnjk0ytTzZOng52f4dq1z3oLJyFMDM0vOentqv4Ct/CX+x7JACIEQ+5wF/jBeDyaSgUVDn80Lbcz7L7G8z22uS1bIx+r23fW92j2ArKN7TBj6FB34qz18sS5bZQ0aI2lwUPCbgq1Sv4Jda5ueUtatyIFGJDDlfVFegDfZxw2T2F8saKQBCFGD+F3Ipnhr25diuX5eOD9sSr0lf3HQxVK9HgT9hHjgdwisgbJ70RQsxSaQACFFAuxuLfylwWoAvp+vWJ4RNj+k/C+8tEL3o2SlkbLqcaFNfCcit7JfjemkDHwb+Arg2cMCkr1mIiSIFQIjqXIa7Az7XiSyLlvIDJPwHUg7w6NjLTP4PjSzlLDL78xEzXg1c55/eNumxCjFRpAAIUY8rcHfAZ8CiToGNjtMT8R+yPlheJKsvBoZUCCk6yDy+8v9zOsJfCCEFQIj6XI3ZaYHwSSoW7JG/v5S+Dn4J10ieQpD+PZ3zZ3gvhv8GXglcu9z8KkIUIQVAiGZsxovHfBhvNFNIKPy1dPvlQJNEibLj7QP+A/f53zDpCxRi2pACIEQDovzyLbhZ+UNUUAKqIEtBdTISKeIFvgXvDvgPwGuAGyc9ViGmkdnBDyHEsuYGfIU5Dzwb70qXaZpOvGksy0V+IXEWQOV5Cfnv7wLeB7wVuH3SFybEtCILgBCDsxX4S+BfgD0Zn1d2PS9jrWAYl2648P9b4M1I+AtRiBQAIYbDNuB1wN/j5uc0y1i2D4Ws2j4h9flOXPi/Bdgx6QELMe1IARBieNwCvAH4gBk7Mz7PjGaX3x+AUFJhMT13WcL/vbjZX8JfiApIARBiuNwOvCkE3gFsj9+My/+KIqz0jYgs4f8uM96GhL8QlZECIMTw2QG8C/dD3wZmcfnfLAKZkm65qQvpzn1Vrt/wuX6HwTuBOyZ9EUIsJpQFIMRo2AV8AAgQ/hJYT43OwHG/oEpVhpYABq1Q2MOnL3XC8Fq+bzd4X4BdirIQoh5SAIQYHbuBD+Ipgq8FDiJDCejLGSTqZT/p0Y+XLGtkyPnFgFsM/ibAP5EddCmEEEJMnBXAH5lxHZ7vvlDyCsBHgVWTHvgYeT5uNYnnJ2+e2sD1wAvxmgtCCCHE9GLGLF4oaAvlSsByVACegwfztS1/XmLh/3xkvRRCCLGImAGeAVxJiQJgy08BeCaw0/IVgDZwLfA8JPyFEEIsQlrAqcClJAScmXV/Xp4WgN83j+LPE/6bcSVBwl8IIcSixczsicAldFe88/S6AD7G8lIAnkW2AhAMrgZ+F6UtCyGEWAK0gMcB59FVAGIlYDkqAM/BYwBiK0g8D1dh9rTZ2dmZSQ9QCCGEGBYGPAj4Pl0FYJ7l6QJ4HgkFIJqDK4CnAK1WS4t/IYQQS4+7AV8H9uEKQJvlpwA8l64C0AYuAJ6IzP5CCCGWOKeY8UVcCWgDHwFWTnpQY+RZuAIQgJ8BD2b5lUMWQgixTDkOF/x7Df6X5aUAPAMvBHQm8CuTHowQQggxFl7wgs6Pm8zsnw3+neWlAPwu7ga576QHIoQQQkwEMzaY8TAzVkx6LGPkzsApkx6EEEIIMTFmZtz1bfKACyGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQggxRfx/OmMZc+if1DoAAAAASUVORK5CYII=") center/contain no-repeat;filter:invert(1)}h1,h2,h3,p{margin-top:0}h1,h2,h3{font-family:"Arial Narrow","Helvetica Neue Condensed",Arial,sans-serif;text-transform:uppercase}h1{margin-bottom:.4rem;font-size:2rem;line-height:1}h2{font-size:1.6rem}.login-card>p{color:var(--muted)}.field{display:grid;gap:.35rem;margin-bottom:.9rem}.field span,.group-label{color:#bac0c4;font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.field input,.field textarea{width:100%;min-height:46px;padding:.7rem .8rem;border:1px solid #394046;border-radius:0;outline:0;background:#0c0e10;color:#fff}.field textarea{min-height:100px;resize:vertical}.field input:focus,.field textarea:focus{border-color:#8d949a;box-shadow:0 0 0 3px rgba(255,255,255,.05)}.btn{min-height:44px;padding:.65rem .9rem;border:1px solid #444a4f;background:#171a1d;color:#fff;font-size:.75rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.btn:hover{border-color:#777}.btn-primary{border-color:var(--red);background:var(--red)}.btn-danger{border-color:#74333a;color:#f0a4aa}.btn-small{min-height:36px;padding:.45rem .65rem;font-size:.66rem}.login-card .btn{width:100%}.status{min-height:1.4rem;margin:.65rem 0 0;color:var(--muted);font-size:.82rem}.status.error{color:#ef858c}.status.success{color:#77c99c}.topbar{position:sticky;z-index:20;top:0;display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:.75rem;min-height:70px;padding:.7rem clamp(1rem,4vw,3rem);border-bottom:1px solid var(--line);background:rgba(8,9,10,.96);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.7rem}.brand .helmet{width:30px;height:38px;margin:0}.brand strong,.brand small{display:block;text-transform:uppercase}.brand strong{font-size:.84rem;letter-spacing:.06em}.brand small{color:var(--muted);font-size:.58rem;letter-spacing:.24em}.topbar a{color:#c8cccf;text-decoration:none}.layout{display:grid;grid-template-columns:220px 1fr;min-height:calc(100svh - 70px)}.tabs{position:sticky;top:70px;height:calc(100svh - 70px);display:grid;align-content:start;gap:.35rem;padding:1rem;border-right:1px solid var(--line);background:#0b0d0f}.tab{min-height:44px;padding:.7rem .8rem;border:0;border-left:3px solid transparent;background:transparent;color:#aeb3b7;text-align:left;font-size:.74rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.tab.active{border-left-color:var(--red);background:#171a1d;color:#fff}.main{width:min(1040px,100%);padding:clamp(1rem,4vw,3rem)}.panel{display:none}.panel.active{display:block}.panel-head{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px solid var(--line)}.panel-head h1{margin:0;font-size:clamp(2rem,5vw,3.5rem)}.panel-head p{max-width:500px;margin:0;color:var(--muted);font-size:.86rem}.section-card{margin-bottom:1rem;padding:1rem;border:1px solid var(--line);background:var(--panel)}.section-card h2{margin-bottom:1rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.wide{grid-column:1/-1}.repeat-card{position:relative;margin-bottom:.75rem;padding:1rem;border:1px solid #363c41;background:#0d1012}.repeat-card h3{margin:0 0 1rem;padding-right:90px;font-size:1rem}.card-actions{position:absolute;top:.7rem;right:.7rem;display:flex;gap:.4rem}.toolbar{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1rem}.day-card{border-left:3px solid #4a5055}.classes{display:grid;gap:.55rem;margin-top:.8rem}.class-row{display:grid;grid-template-columns:135px 1fr auto;gap:.5rem;align-items:end}.class-row .field{margin:0}.photo-form{display:grid;grid-template-columns:1fr 1fr auto;gap:.7rem;align-items:end}.photo-form .field{margin:0}.photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin-top:1rem}.photo-card{position:relative;border:1px solid var(--line);background:#0c0e10}.photo-card img{width:100%;aspect-ratio:4/3;display:block;object-fit:cover}.photo-card footer{display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.6rem}.photo-card span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c3c7ca;font-size:.76rem}.empty{padding:2rem 1rem;border:1px dashed #3d4348;color:var(--muted);text-align:center}.lead{display:grid;grid-template-columns:1fr auto;gap:1rem;padding:1rem;border-bottom:1px solid var(--line)}.lead:first-child{border-top:1px solid var(--line)}.lead h3{margin:0 0 .3rem;font-family:inherit;font-size:.95rem;text-transform:none}.lead-meta{display:flex;flex-wrap:wrap;gap:.3rem 1rem;color:#989ea3;font-size:.76rem}.lead p{margin:.65rem 0 0;color:#d4d6d8;white-space:pre-wrap}.save-bar{position:fixed;z-index:30;right:1.1rem;bottom:1.1rem;display:flex;align-items:center;gap:.7rem;padding:.55rem;border:1px solid var(--line);background:rgba(8,9,10,.94);box-shadow:0 12px 40px rgba(0,0,0,.4)}.save-bar .status{min-height:0;margin:0}.notice{margin-bottom:1rem;padding:.8rem 1rem;border-left:3px solid var(--warn);background:#171715;color:#d8d3c8;font-size:.82rem}\n    @media(max-width:760px){body{padding-bottom:66px}.topbar{grid-template-columns:1fr auto}.topbar>a{display:none}.layout{display:block}.tabs{position:fixed;z-index:25;top:auto;bottom:0;left:0;right:0;width:100%;height:66px;display:flex;align-items:stretch;overflow-x:auto;padding:0;border:0;border-top:1px solid var(--line);background:rgba(8,9,10,.98)}.tab{flex:0 0 92px;min-height:60px;padding:.45rem .3rem;border:0;border-top:3px solid transparent;text-align:center;font-size:.62rem}.tab.active{border-top-color:var(--red);border-left:0}.main{padding:1rem 1rem 6rem}.panel-head{display:block}.panel-head p{margin-top:.4rem}.grid,.grid-3{grid-template-columns:1fr}.wide{grid-column:auto}.photo-form{grid-template-columns:1fr}.photo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.class-row{grid-template-columns:100px 1fr}.class-row .remove-class{grid-column:1/-1}.save-bar{right:1rem;bottom:76px;left:1rem;justify-content:space-between}.save-bar .status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lead{grid-template-columns:1fr}.lead>.btn{justify-self:start}}\n  </style>\n</head>\n<body>\n  <main class="shell">\n    <section class="login" id="loginView">\n      <form class="login-card" id="loginForm">\n        <div class="helmet" aria-hidden="true"></div>\n        <h1>Website Control</h1>\n        <p>Modern Spartan Self-Defense</p>\n        <label class="field"><span>Username</span><input id="loginUsername" autocomplete="username" value="modernspartansd" required></label>\n        <label class="field"><span>Password</span><input id="loginPassword" type="password" autocomplete="current-password" required></label>\n        <button class="btn btn-primary" type="submit">Sign in</button>\n        <p class="status" id="loginStatus" role="status"></p>\n      </form>\n    </section>\n\n    <section id="adminView" class="hidden">\n      <header class="topbar">\n        <div class="brand"><div class="helmet" aria-hidden="true"></div><span><strong>Modern Spartan</strong><small>Website Admin</small></span></div>\n        <a href="/" target="_blank">View website \u2197</a>\n        <button class="btn btn-small" id="logoutButton">Log out</button>\n      </header>\n      <div class="layout">\n        <nav class="tabs" aria-label="Admin sections">\n          <button class="tab active" data-panel="basics">Main Site</button>\n          <button class="tab" data-panel="programs">Programs</button>\n          <button class="tab" data-panel="pricing">Pricing</button>\n          <button class="tab" data-panel="schedule">Schedule</button>\n          <button class="tab" data-panel="photos">Photos</button>\n          <button class="tab" data-panel="leads">Requests</button>\n        </nav>\n\n        <div class="main">\n          <section class="panel active" id="panel-basics">\n            <header class="panel-head"><div><h1>Main Site</h1><p>Update the academy information and the main wording visitors see.</p></div></header>\n            <div class="notice">Changes go live when you press Save Website.</div>\n            <div class="section-card"><h2>Business information</h2><div class="grid">\n              <label class="field"><span>Academy name</span><input data-path="business.name"></label>\n              <label class="field"><span>Location</span><input data-path="business.location"></label>\n              <label class="field"><span>Location note</span><input data-path="business.locationNote"></label>\n              <label class="field"><span>Display phone</span><input data-path="business.phone"></label>\n              <label class="field"><span>Phone link</span><input data-path="business.phoneHref" placeholder="+19184701458"></label>\n              <label class="field"><span>Email</span><input type="email" data-path="business.email"></label>\n              <label class="field"><span>Instagram handle</span><input data-path="business.instagram"></label>\n            </div></div>\n            <div class="section-card"><h2>Opening section</h2><div class="grid">\n              <label class="field wide"><span>Small heading</span><input data-path="hero.eyebrow"></label>\n              <label class="field wide"><span>Main headline</span><textarea data-path="hero.title"></textarea></label>\n              <label class="field wide"><span>Supporting text</span><textarea data-path="hero.text"></textarea></label>\n            </div></div>\n            <div class="section-card"><h2>About the academy</h2><div class="grid">\n              <label class="field"><span>Small heading</span><input data-path="about.kicker"></label>\n              <label class="field"><span>Headline</span><input data-path="about.title"></label>\n              <label class="field wide"><span>Story</span><textarea data-path="about.text"></textarea></label>\n              <label class="field wide"><span>Coach quote</span><input data-path="about.quote"></label>\n            </div></div>\n            <div class="section-card"><h2>Community seminar</h2><div class="grid">\n              <label class="field"><span>Label</span><input data-path="seminar.label"></label>\n              <label class="field"><span>Title</span><input data-path="seminar.title"></label>\n              <label class="field wide"><span>Description</span><textarea data-path="seminar.text"></textarea></label>\n            </div></div>\n          </section>\n\n          <section class="panel" id="panel-programs"><header class="panel-head"><div><h1>Programs</h1><p>Add, remove, or update the training options shown on the website.</p></div></header><div id="programList"></div><button class="btn" id="addProgram">+ Add program</button></section>\n          <section class="panel" id="panel-pricing"><header class="panel-head"><div><h1>Pricing</h1><p>Keep membership prices and descriptions current.</p></div></header><div id="pricingList"></div><button class="btn" id="addPrice">+ Add price</button></section>\n          <section class="panel" id="panel-schedule"><header class="panel-head"><div><h1>Schedule</h1><p>Change the month, training days, class times, and class names.</p></div></header><div class="section-card"><div class="grid"><label class="field"><span>Schedule month</span><input data-path="schedule.month"></label><label class="field"><span>Schedule note</span><input data-path="schedule.note"></label></div></div><div id="scheduleList"></div><button class="btn" id="addDay">+ Add training day</button></section>\n\n          <section class="panel" id="panel-photos"><header class="panel-head"><div><h1>Photos</h1><p>Upload academy photos. Landscape images look best.</p></div></header>\n            <form class="section-card photo-form" id="photoForm"><label class="field"><span>Photo</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label><label class="field"><span>Caption</span><input name="caption" placeholder="Krav Maga training"></label><button class="btn btn-primary" type="submit">Upload photo</button></form><p class="status" id="photoStatus" role="status"></p><div class="photo-grid" id="photoGrid"></div>\n          </section>\n\n          <section class="panel" id="panel-leads"><header class="panel-head"><div><h1>Free Class Requests</h1><p>Contact requests submitted through the public website.</p></div><button class="btn btn-small" id="refreshLeads">Refresh</button></header><div id="leadList"></div></section>\n        </div>\n      </div>\n      <div class="save-bar"><span class="status" id="saveStatus" role="status"></span><button class="btn btn-primary" id="saveButton">Save Website</button></div>\n    </section>\n  </main>\n\n  <template id="programTemplate"><article class="repeat-card"><h3>Program</h3><div class="card-actions"><button class="btn btn-small btn-danger remove-program" type="button">Remove</button></div><div class="grid"><label class="field"><span>Name</span><input data-key="name"></label><label class="field"><span>Label</span><input data-key="tag"></label><label class="field wide"><span>Description</span><textarea data-key="description"></textarea></label><label class="field wide"><span>Who it\u2019s for / details</span><input data-key="details"></label></div></article></template>\n  <template id="priceTemplate"><article class="repeat-card"><h3>Membership</h3><div class="card-actions"><button class="btn btn-small btn-danger remove-price" type="button">Remove</button></div><div class="grid grid-3"><label class="field"><span>Name</span><input data-key="name"></label><label class="field"><span>Price</span><input data-key="price" placeholder="$100"></label><label class="field"><span>Suffix</span><input data-key="suffix" placeholder="/ month"></label><label class="field wide"><span>Details</span><input data-key="details"></label><label class="field"><span>Highlight this option</span><input type="checkbox" data-key="featured"></label></div></article></template>\n  <template id="dayTemplate"><article class="repeat-card day-card"><h3>Training day</h3><div class="card-actions"><button class="btn btn-small btn-danger remove-day" type="button">Remove</button></div><div class="grid"><label class="field"><span>Day</span><input data-day-key="day"></label><label class="field"><span>Extra note</span><input data-day-key="detail" placeholder="Specific dates"></label></div><div class="classes"></div><div class="toolbar"><button class="btn btn-small add-class" type="button">+ Add class</button></div></article></template>\n  <template id="classTemplate"><div class="class-row"><label class="field"><span>Time</span><input data-class-key="time" placeholder="6:00 PM"></label><label class="field"><span>Class</span><input data-class-key="name" placeholder="Adult Krav Maga"></label><button class="btn btn-small btn-danger remove-class" type="button">Remove</button></div></template>\n\n  <script>\n    const state={content:null,photos:[],leads:[]};\n    const $=selector=>document.querySelector(selector);\n    const $$=selector=>[...document.querySelectorAll(selector)];\n    const escapeHtml=value=>String(value??"").replace(/[&<>"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[character]));\n    async function api(url,options={}){const response=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),...(options.headers||{})}});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.error||"Something went wrong.");return data}\n    function setStatus(element,message,type=""){element.textContent=message;element.className=`status ${type}`}\n    function getPath(object,path){return path.split(".").reduce((value,key)=>value?.[key],object)}\n    function setPath(object,path,value){const keys=path.split(".");const last=keys.pop();const target=keys.reduce((value,key)=>value[key],object);target[last]=value}\n    function fillBasicFields(){$$("[data-path]").forEach(input=>{input.value=getPath(state.content,input.dataset.path)??""})}\n    function collectBasicFields(){$$("[data-path]").forEach(input=>setPath(state.content,input.dataset.path,input.value.trim()))}\n    function renderPrograms(){const list=$("#programList");list.innerHTML="";state.content.programs.forEach((program,index)=>{const card=$("#programTemplate").content.firstElementChild.cloneNode(true);card.dataset.index=index;card.querySelector("h3").textContent=`Program ${index+1}`;card.querySelectorAll("[data-key]").forEach(input=>input.value=program[input.dataset.key]??"");list.append(card)})}\n    function collectPrograms(){state.content.programs=$$("#programList .repeat-card").map(card=>Object.fromEntries([...card.querySelectorAll("[data-key]")].map(input=>[input.dataset.key,input.value.trim()]))) }\n    function renderPricing(){const list=$("#pricingList");list.innerHTML="";state.content.pricing.forEach((price,index)=>{const card=$("#priceTemplate").content.firstElementChild.cloneNode(true);card.dataset.index=index;card.querySelector("h3").textContent=`Membership ${index+1}`;card.querySelectorAll("[data-key]").forEach(input=>{input.type==="checkbox"?input.checked=Boolean(price[input.dataset.key]):input.value=price[input.dataset.key]??""});list.append(card)})}\n    function collectPricing(){state.content.pricing=$$("#pricingList .repeat-card").map(card=>Object.fromEntries([...card.querySelectorAll("[data-key]")].map(input=>[input.dataset.key,input.type==="checkbox"?input.checked:input.value.trim()]))) }\n    function classRow(item={time:"",name:""}){const row=$("#classTemplate").content.firstElementChild.cloneNode(true);row.querySelectorAll("[data-class-key]").forEach(input=>input.value=item[input.dataset.classKey]??"");return row}\n    function renderSchedule(){const list=$("#scheduleList");list.innerHTML="";state.content.schedule.days.forEach((day,index)=>{const card=$("#dayTemplate").content.firstElementChild.cloneNode(true);card.dataset.index=index;card.querySelector("h3").textContent=`Training day ${index+1}`;card.querySelectorAll("[data-day-key]").forEach(input=>input.value=day[input.dataset.dayKey]??"");day.classes.forEach(item=>card.querySelector(".classes").append(classRow(item)));list.append(card)})}\n    function collectSchedule(){state.content.schedule.days=$$("#scheduleList .day-card").map(card=>({day:card.querySelector(\'[data-day-key="day"]\').value.trim(),detail:card.querySelector(\'[data-day-key="detail"]\').value.trim(),classes:[...card.querySelectorAll(".class-row")].map(row=>({time:row.querySelector(\'[data-class-key="time"]\').value.trim(),name:row.querySelector(\'[data-class-key="name"]\').value.trim()}))}))}\n    function renderPhotos(){const grid=$("#photoGrid");if(!state.photos.length){grid.innerHTML=\'<div class="empty wide">No academy photos have been uploaded yet.</div>\';return}grid.innerHTML=state.photos.map(photo=>`<article class="photo-card"><img src="/api/photos/${encodeURIComponent(photo.id)}" alt="${escapeHtml(photo.caption)}"><footer><span>${escapeHtml(photo.caption)}</span><button class="btn btn-small btn-danger delete-photo" data-id="${photo.id}">Delete</button></footer></article>`).join("")}\n    function renderLeads(){const list=$("#leadList");if(!state.leads.length){list.innerHTML=\'<div class="empty">No free-class requests yet.</div>\';return}list.innerHTML=state.leads.map(lead=>`<article class="lead"><div><h3>${escapeHtml(lead.name)}${lead.freeClass?\' \xB7 Free class\':\'\'}</h3><div class="lead-meta"><a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a><time>${new Date(lead.createdAt).toLocaleString()}</time></div><p>${escapeHtml(lead.message)}</p></div><button class="btn btn-small btn-danger delete-lead" data-id="${lead.id}">Delete</button></article>`).join("")}\n    async function loadAll(){const [contentData,photoData,leadData]=await Promise.all([api("/api/content"),api("/api/photos"),api("/api/leads")]);state.content=contentData.content;state.photos=photoData.photos;state.leads=leadData.leads;fillBasicFields();renderPrograms();renderPricing();renderSchedule();renderPhotos();renderLeads()}\n    async function showAdmin(){$("#loginView").classList.add("hidden");$("#adminView").classList.remove("hidden");try{await loadAll()}catch(error){setStatus($("#saveStatus"),error.message,"error")}}\n    $("#loginForm").addEventListener("submit",async event=>{event.preventDefault();setStatus($("#loginStatus"),"Signing in\u2026");try{await api("/api/login",{method:"POST",body:JSON.stringify({username:$("#loginUsername").value,password:$("#loginPassword").value})});$("#loginPassword").value="";await showAdmin()}catch(error){setStatus($("#loginStatus"),error.message,"error")}});\n    $("#logoutButton").addEventListener("click",async()=>{await api("/api/logout",{method:"POST",body:"{}"});location.reload()});\n    $$(".tab").forEach(tab=>tab.addEventListener("click",()=>{$$(".tab").forEach(item=>item.classList.toggle("active",item===tab));$$(".panel").forEach(panel=>panel.classList.toggle("active",panel.id===`panel-${tab.dataset.panel}`))}));\n    $("#addProgram").addEventListener("click",()=>{collectPrograms();state.content.programs.push({name:"New Program",tag:"",description:"",details:""});renderPrograms()});\n    $("#programList").addEventListener("click",event=>{if(event.target.matches(".remove-program")){collectPrograms();state.content.programs.splice(Number(event.target.closest(".repeat-card").dataset.index),1);renderPrograms()}});\n    $("#addPrice").addEventListener("click",()=>{collectPricing();state.content.pricing.push({name:"New Membership",details:"",price:"$100",suffix:"/ month",featured:false});renderPricing()});\n    $("#pricingList").addEventListener("click",event=>{if(event.target.matches(".remove-price")){collectPricing();state.content.pricing.splice(Number(event.target.closest(".repeat-card").dataset.index),1);renderPricing()}});\n    $("#addDay").addEventListener("click",()=>{collectSchedule();state.content.schedule.days.push({day:"New day",detail:"",classes:[{time:"",name:""}]});renderSchedule()});\n    $("#scheduleList").addEventListener("click",event=>{const card=event.target.closest(".day-card");if(event.target.matches(".remove-day")){collectSchedule();state.content.schedule.days.splice(Number(card.dataset.index),1);renderSchedule()}if(event.target.matches(".add-class"))card.querySelector(".classes").append(classRow());if(event.target.matches(".remove-class"))event.target.closest(".class-row").remove()});\n    $("#saveButton").addEventListener("click",async()=>{collectBasicFields();collectPrograms();collectPricing();collectSchedule();setStatus($("#saveStatus"),"Saving\u2026");try{const data=await api("/api/content",{method:"PUT",body:JSON.stringify({content:state.content})});state.content=data.content;setStatus($("#saveStatus"),"Website saved.","success");setTimeout(()=>setStatus($("#saveStatus"),""),3000)}catch(error){setStatus($("#saveStatus"),error.message,"error")}});\n    $("#photoForm").addEventListener("submit",async event=>{event.preventDefault();setStatus($("#photoStatus"),"Uploading\u2026");try{const form=new FormData(event.currentTarget);await api("/api/photos",{method:"POST",body:form});event.currentTarget.reset();state.photos=(await api("/api/photos")).photos;renderPhotos();setStatus($("#photoStatus"),"Photo uploaded.","success")}catch(error){setStatus($("#photoStatus"),error.message,"error")}});\n    $("#photoGrid").addEventListener("click",async event=>{if(!event.target.matches(".delete-photo"))return;if(!confirm("Delete this photo?"))return;try{await api(`/api/photos/${event.target.dataset.id}`,{method:"DELETE"});state.photos=(await api("/api/photos")).photos;renderPhotos()}catch(error){setStatus($("#photoStatus"),error.message,"error")}});\n    $("#refreshLeads").addEventListener("click",async()=>{try{state.leads=(await api("/api/leads")).leads;renderLeads()}catch(error){alert(error.message)}});\n    $("#leadList").addEventListener("click",async event=>{if(!event.target.matches(".delete-lead"))return;if(!confirm("Delete this request?"))return;try{await api(`/api/leads?id=${encodeURIComponent(event.target.dataset.id)}`,{method:"DELETE"});state.leads=(await api("/api/leads")).leads;renderLeads()}catch(error){alert(error.message)}});\n    (async()=>{try{const session=await api("/api/session");if(session.authenticated)await showAdmin()}catch(error){setStatus($("#loginStatus"),error.message,"error")}})();\n  <\/script>\n</body>\n</html>\n';
var PUBLIC_RUNTIME = '(()=>{\n  if(window.__modernSpartanAdminConnected)return;window.__modernSpartanAdminConnected=true;\n  const escapeHtml=value=>String(value??"").replace(/[&<>\\"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'\\"\':"&quot;"}[character]));\n  const phoneHref=value=>String(value||"").replace(/[^+\\d]/g,"");\n  const one=selector=>document.querySelector(selector);\n  function renderContent(content){\n    const {business,hero,about,programs,pricing,schedule,seminar}=content;\n    document.title=`${business.name} | Eufaula, Oklahoma`;\n    const meta=one(\'meta[name="description"]\');if(meta)meta.content=`${programs.map(program=>program.name).join(", ")} in Eufaula, Oklahoma. First class free.`;\n    one(".hero .eyebrow").textContent=hero.eyebrow;one(".hero h1").textContent=hero.title;one(".hero-sub").textContent=hero.text;\n    const call=one(\'.hero .actions a[href^="tel:"]\');call.href=`tel:${phoneHref(business.phoneHref||business.phone)}`;call.textContent=`Call ${business.phone}`;\n    one(".hero .facts span:first-child").textContent=`\u2316 ${business.location}`;\n    one(".about .kicker").textContent=about.kicker;one(".about h2").textContent=about.title;one(".about-copy p").textContent=about.text;one(".about-copy blockquote").textContent=about.quote;\n    one(".cards").innerHTML=programs.map((program,index)=>`<article class="card"><div class="card-num"><span>${String(index+1).padStart(2,"0")}</span><span>\u25C7</span></div><p class="card-tag">${escapeHtml(program.tag)}</p><h3>${escapeHtml(program.name)}</h3><p>${escapeHtml(program.description)}</p><footer>${escapeHtml(program.details)}</footer></article>`).join("");\n    const seminarBox=one(".seminar");seminarBox.querySelector("small").textContent=seminar.label;seminarBox.querySelector("strong").textContent=seminar.title;seminarBox.querySelector("p").textContent=seminar.text;\n    one(".price-list").innerHTML=pricing.map(item=>`<article class="price-row${item.featured?\' featured\':\'\'}"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.details)}</p></div><div class="price"><b>${escapeHtml(item.price)}</b><small>${escapeHtml(item.suffix)}</small></div></article>`).join("")+`<a class="btn btn-primary" href="#contact">Claim your free class</a>`;\n    one(".schedule h2").innerHTML=`On the mat<br>this ${escapeHtml(schedule.month)}.`;one(".schedule-head>p").textContent=schedule.note;\n    const table=one(".schedule-table");table.setAttribute("aria-label",`${schedule.month} schedule`);table.innerHTML=schedule.days.map((day,index)=>`<div class="schedule-row" role="row"><div class="day"><i>${String(index+1).padStart(2,"0")}</i><strong>${escapeHtml(day.day)}</strong>${day.detail?`<small>${escapeHtml(day.detail)}</small>`:""}</div><div class="times">${day.classes.map(item=>`<div class="time"><b>${escapeHtml(item.time)}</b><span>${escapeHtml(item.name)}</span></div>`).join("")}</div></div>`).join("");\n    const first=schedule.days.flatMap(day=>day.classes.map(item=>({...item,day:day.day}))).find(item=>item.time&&item.name);const snapshot=one(".class-snapshot b");if(first&&snapshot)snapshot.textContent=`${first.day} \xB7 ${first.name} at ${first.time}`;\n    const instagram=`https://instagram.com/${business.instagram}`;const galleryInstagram=one(".gallery-head>a");galleryInstagram.href=instagram;galleryInstagram.textContent=`Follow @${business.instagram} \u2197`;\n    const map=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business.location} ${business.locationNote}`)}`;\n    one(".contact-list").innerHTML=`<a href="${map}" target="_blank" rel="noreferrer"><small>Visit</small><span>${escapeHtml(business.location)}<br>${escapeHtml(business.locationNote)}</span></a><a href="tel:${phoneHref(business.phoneHref||business.phone)}"><small>Call/text</small><span>${escapeHtml(business.phone)}</span></a><a href="mailto:${escapeHtml(business.email)}"><small>Email</small><span>${escapeHtml(business.email)}</span></a>`;\n    one(".footer-links").innerHTML=`<a href="tel:${phoneHref(business.phoneHref||business.phone)}">${escapeHtml(business.phone)}</a><a href="mailto:${escapeHtml(business.email)}">Email</a><a href="${instagram}" target="_blank" rel="noreferrer">Instagram</a><a href="https://kravmagaassociation.com" target="_blank" rel="noreferrer">Krav Maga Association</a>`;one(".copyright").textContent=`\xA9 ${new Date().getFullYear()} ${business.name} \xB7 Eufaula, Oklahoma`;\n  }\n  async function loadSite(){try{const [contentResponse,photoResponse]=await Promise.all([fetch("/api/content"),fetch("/api/photos")]);if(contentResponse.ok)renderContent((await contentResponse.json()).content);if(photoResponse.ok){const photos=(await photoResponse.json()).photos;if(photos.length){const grid=one(".gallery-grid");grid.style.height="auto";grid.innerHTML=photos.map(photo=>`<div class="photo"><img src="/api/photos/${encodeURIComponent(photo.id)}" alt="${escapeHtml(photo.caption)}" loading="lazy" style="width:100%;height:100%;object-fit:cover"><span>${escapeHtml(photo.caption)}</span></div>`).join("")}}}catch(error){console.warn("Using built-in website content.")}}\n  const form=one("form.form");if(form){let status=form.querySelector(".form-status");if(!status){status=document.createElement("p");status.className="form-status";status.setAttribute("role","status");status.style.cssText="min-height:1.4rem;margin:0;color:#a9adb1;font-size:.8rem";form.append(status)}form.addEventListener("submit",async event=>{event.preventDefault();const button=form.querySelector("button");button.disabled=true;status.style.color="#a9adb1";status.textContent="Sending\u2026";const values=Object.fromEntries(new FormData(form));values.freeClass=Boolean(form.querySelector(\'input[type="checkbox"]\')?.checked);try{const response=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to send your request.");form.reset();status.style.color="#78c99b";status.textContent=result.message}catch(error){status.style.color="#ef858c";status.textContent=error.message}finally{button.disabled=false}})}\n  loadSite();\n})();\n';

// admin.js
function onRequestGet6() {
  return new Response(ADMIN_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(onRequestGet6, "onRequestGet");

// _middleware.js
async function onRequest(context) {
  const response = await context.next();
  const pathname = new URL(context.request.url).pathname;
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/") || !response.headers.get("Content-Type")?.includes("text/html")) return response;
  return new HTMLRewriter().on("body", {
    element(element) {
      element.append(`<script>${PUBLIC_RUNTIME}<\/script>`, { html: true });
    }
  }).transform(response);
}
__name(onRequest, "onRequest");

// ../.wrangler/tmp/pages-0pR36Y/functionsRoutes-0.3616178517710962.mjs
var routes = [
  {
    routePath: "/api/photos/:id",
    mountPath: "/api/photos",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/photos/:id",
    mountPath: "/api/photos",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/contact",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/content",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/content",
    mountPath: "/api",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut]
  },
  {
    routePath: "/api/leads",
    mountPath: "/api",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/api/leads",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/login",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/logout",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/photos",
    mountPath: "/api/photos",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/photos",
    mountPath: "/api/photos",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/session",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/admin/:path*",
    mountPath: "/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/admin",
    mountPath: "/",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest],
    modules: []
  }
];

// ../../../../../root/.npm/_npx/e0df58cf71169f23/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../root/.npm/_npx/e0df58cf71169f23/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
