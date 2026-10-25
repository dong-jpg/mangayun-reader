// ==UserScript==
// @name         MangaYun Reader
// @namespace    https://github.com/dong-jpg/mangayun-reader
// @version      1.0.4
// @author       dong-jpg
// @description  云漫增强阅读器：横向/纵向连续、单页模式、进度记忆、章节下载（ZIP）
// @license      MIT
// @match        https://mangayun.com/*
// @connect      hamreus.com
// @connect      cdndm5.com
// @connect      ccavbox.com
// @connect      bgm.tv
// @connect      tuku.cc
// @connect      baozimh.com
// @connect      manhuazhijia.cc
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const KNOWN_SITES = /* @__PURE__ */ new Set([
    "dm5",
    "mangabz",
    "manben",
    "manhuagui",
    "manhuazhijia",
    "tuku",
    "rumanhua",
    "comicbox",
    "manhuazhan"
  ]);
  const RE_NUM_UNIT = /(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:话|話|回|集|卷|期|章|篇)/i;
  const RE_NUM_LATIN = /(?:EP|Ch(?:apter)?|Vol(?:ume)?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i;
  const RE_NUM_PURE = /^(?:第\s*)?(\d+(?:\.\d+)?)$/;
  const RE_SLOT = /(?:chapter_slot)=(\d+)/i;
  const RE_EXTRA = /外传|外傳|番外|特别篇|特別篇|特典|附录|附錄|加笔|加筆|短篇|单行本特典|\bSP\b|\bExtra\b|\bOmake\b|\bGaiden\b/i;
  const RE_PROLOGUE = /^(?:0\.)?(?:序章|预告|預告|开篇|開篇|前言|第零)/i;
  const RE_FINALE = /最终话|最終話|终章|終章|完结篇|完結篇|大结局|最後一/;
  const RE_ANY_NUM = /(?:第|\b)\d+/;
  const RE_FIRST_CHAPTER = /第\s*0*1\s*(?:话|話|回|集|章)/;
  const RE_VOLUME = /卷|Vol(?:ume)?/i;
  function mean(list) {
    return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;
  }
  function kindOf(name, category) {
    return RE_EXTRA.test(`${category ?? ""} ${name}`) ? "extra" : "main";
  }
  function unitOf(name) {
    return RE_VOLUME.test(name) ? "volume" : "episode";
  }
  function parseChapterNumber(name, url = "") {
    const r = name.replace(/\s+/g, " ").trim();
    if (!r) return null;
    if (RE_PROLOGUE.test(r)) return 0;
    if (RE_FINALE.test(r) && !RE_ANY_NUM.test(r)) return 1e6;
    const unit = RE_NUM_UNIT.exec(r);
    if (unit?.[1]) return Number(unit[1]);
    const latin = RE_NUM_LATIN.exec(r);
    if (latin?.[1]) return Number(latin[1]);
    const leading = r.match(/^(\d+)(?:\.(\d+))?(?:[.\-_、\s]+|$)/);
    if (leading) {
      const int = leading[1];
      const frac = leading[2];
      return frac && frac !== int && frac.length <= 2 ? Number(`${int}.${frac}`) : Number(int);
    }
    const pure = RE_NUM_PURE.exec(r);
    if (pure?.[1]) return Number(pure[1]);
    if (url) {
      const slot = RE_SLOT.exec(url);
      if (slot?.[1]) return Number(slot[1]);
    }
    return null;
  }
  function detectDescending(orders) {
    if (orders.length < 3) return null;
    const head = orders.slice(0, Math.min(8, orders.length));
    const tail = orders.slice(-Math.min(8, orders.length));
    const headMean = mean(head);
    const tailMean = mean(tail);
    if (headMean > tailMean + 1) return true;
    if (tailMean > headMean + 1) return false;
    return null;
  }
  function shouldReverseBySite(siteId, chapters) {
    if (!siteId || !KNOWN_SITES.has(siteId) || chapters.length < 2) return false;
    const first = chapters[0]?.name ?? "";
    const last = chapters[chapters.length - 1]?.name ?? "";
    return !(RE_FIRST_CHAPTER.test(first) && !RE_FIRST_CHAPTER.test(last));
  }
  function normalizeChapters(siteId, raw) {
    if (!raw.length) return [];
    const items = raw.map((raw2, index) => ({
      raw: raw2,
      index,
      num: parseChapterNumber(raw2.name ?? "", raw2.url ?? ""),
      kind: kindOf(raw2.name ?? "", raw2.category),
      unit: unitOf(raw2.name ?? "")
    }));
    const parsedCount = items.filter((it) => it.num != null).length;
    const coverage = parsedCount / items.length;
    let sorted;
    if (coverage >= 0.35 && parsedCount >= 3) {
      sorted = [...items].sort((a, b) => {
        const kindDiff = (a.kind === "main" ? 0 : 1) - (b.kind === "main" ? 0 : 1);
        if (kindDiff !== 0) return kindDiff;
        const unitDiff = (a.unit === "episode" ? 0 : a.unit === "volume" ? 1 : 2) - (b.unit === "episode" ? 0 : b.unit === "volume" ? 1 : 2);
        if (unitDiff !== 0) return unitDiff;
        if (a.num != null && b.num != null && a.num !== b.num) return a.num - b.num;
        if (a.num != null && b.num == null) return -1;
        if (a.num == null && b.num != null) return 1;
        return a.index - b.index;
      });
    } else if (shouldReverseBySite(siteId, raw)) {
      sorted = [...items].reverse();
    } else {
      const byOrder = [...items].sort((a, b) => {
        const diff = (a.raw.order ?? 0) - (b.raw.order ?? 0);
        return diff !== 0 ? diff : a.index - b.index;
      });
      const orders = byOrder.map((it, i) => it.raw.order || i);
      sorted = detectDescending(orders) ? byOrder.reverse() : byOrder;
    }
    return sorted.map((it, i) => ({
      url: it.raw.url ?? "",
      name: it.raw.name ?? "",
      order: i + 1,
      rawIndex: it.index,
      category: it.raw.category
    }));
  }
  const PROXY_PATH = "/api/image";
  const PROXY_HOSTS = ["hamreus.com", "cdndm5.com", "ccavbox.com", "bgm.tv", "tuku.cc"];
  const PROXY_SOURCES = /* @__PURE__ */ new Set(["manhuagui", "comicbox", "manben", "dm5", "tuku"]);
  function supportOf(siteId) {
    if (siteId === "comicbox") return "unsupported";
    return "full";
  }
  const VERIFIED_SOURCES = /* @__PURE__ */ new Set([
    "dm5",
    "mangabz",
    "manben",
    "manhuagui",
    "manhuazhijia",
    "tuku",
    "rumanhua",
    "manhuazhan"
  ]);
  function toUrl(url, base) {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  }
  function isProxyPath(u) {
    return u.pathname === PROXY_PATH && !!u.searchParams.get("url");
  }
  function isProxyHost(hostname) {
    const h2 = hostname.toLowerCase();
    return PROXY_HOSTS.some((d) => h2 === d || h2.endsWith(`.${d}`));
  }
  function buildProxyUrl(absoluteUrl, siteId, base) {
    const params = new URLSearchParams();
    params.set("url", absoluteUrl);
    if (siteId) params.set("siteId", siteId);
    return new URL(`${PROXY_PATH}?${params.toString()}`, base).toString();
  }
  function finalizeImageUrl(siteId, url, base = "https://mangayun.com") {
    if (!url) return "";
    const asUrl = toUrl(url, base);
    if (asUrl && isProxyPath(asUrl)) return url;
    let rawUrl = url;
    let unwrappedSiteId;
    if (asUrl && asUrl.pathname === PROXY_PATH) {
      const inner = asUrl.searchParams.get("url");
      unwrappedSiteId = asUrl.searchParams.get("siteId") ?? void 0;
      if (inner) rawUrl = inner;
    }
    const abs = toUrl(rawUrl, base);
    if (!abs) return url;
    if (abs.pathname === PROXY_PATH) return url;
    if (isProxyHost(abs.hostname) || siteId != null && PROXY_SOURCES.has(siteId) || rawUrl !== url) {
      return buildProxyUrl(abs.toString(), siteId || unwrappedSiteId, base);
    }
    return abs.toString();
  }
  function isProxiedUrl(url, base = "https://mangayun.com") {
    const u = toUrl(url, base);
    return !!u && isProxyPath(u);
  }
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const REV = /* @__PURE__ */ new Map();
  for (let i = 0; i < ALPHABET.length; i++) REV.set(ALPHABET[i], i);
  function encodeBase64Url(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
      out += ALPHABET[b0 >> 2];
      out += ALPHABET[(b0 & 3) << 4 | (b1 ?? 0) >> 4];
      if (b1 !== null) out += ALPHABET[(b1 & 15) << 2 | (b2 ?? 0) >> 6];
      if (b2 !== null) out += ALPHABET[b2 & 63];
    }
    return out;
  }
  function encodeBase64UrlText(text) {
    return encodeBase64Url(new TextEncoder().encode(text));
  }
  function decodeBase64Url(text) {
    const clean = text.replace(/[^A-Za-z0-9_-]/g, "");
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let o = 0;
    let buffer = 0;
    let bits = 0;
    for (const ch of clean) {
      const v = REV.get(ch);
      if (v === void 0) continue;
      buffer = buffer << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = buffer >> bits & 255;
      }
    }
    return out.subarray(0, o);
  }
  function decodeBase64UrlText(text) {
    return new TextDecoder().decode(decodeBase64Url(text));
  }
  function encodeComicParam(siteId, detailUrl) {
    return encodeBase64UrlText(JSON.stringify([siteId, detailUrl]));
  }
  function decodeComicParam(param) {
    try {
      const json = decodeBase64UrlText(param);
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
        return { siteId: parsed[0], detailUrl: parsed[1] };
      }
      return null;
    } catch {
      return null;
    }
  }
  function decodeChapterParam(param) {
    try {
      const text = decodeBase64UrlText(param);
      return text || null;
    } catch {
      return null;
    }
  }
  const READ_PATH_RE = /^\/read\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/;
  function parseReadPath(pathname) {
    const m = READ_PATH_RE.exec(pathname);
    if (!m) return null;
    const comic = decodeComicParam(m[1]);
    const chapterUrl = decodeChapterParam(m[2]);
    if (!comic || !chapterUrl) return null;
    return { comic, chapterUrl };
  }
  function parseReadSearch(search) {
    const params = new URLSearchParams(search);
    const siteId = params.get("site");
    const detailUrl = params.get("manga");
    const chapterUrl = params.get("chapter");
    if (!siteId || !detailUrl || !chapterUrl) return null;
    return { comic: { siteId, detailUrl }, chapterUrl };
  }
  function buildReadPath(comic, chapterUrl) {
    const a = encodeComicParam(comic.siteId, comic.detailUrl);
    const b = encodeBase64UrlText(chapterUrl);
    return `/read/${a}/${b}`;
  }
  const RESOLVE_IFRAME_NAME_PREFIX = "myr-resolve:v1:";
  const RESOLVE_IFRAME_MIN_GAP_MS = 1e3;
  function isResolveIframe(name) {
    return name.startsWith(RESOLVE_IFRAME_NAME_PREFIX);
  }
  function resolveIframeToken(name) {
    return isResolveIframe(name) ? name.slice(RESOLVE_IFRAME_NAME_PREFIX.length) : null;
  }
  class ChapterResolver {
    #bus;
    #lastLoadAt = 0;
    constructor(bus) {
      this.#bus = bus;
    }
    async #loadInIframe(src, token, match, timeoutMs) {
      const gap = Date.now() - this.#lastLoadAt - RESOLVE_IFRAME_MIN_GAP_MS;
      if (gap < 0) await new Promise((r) => setTimeout(r, -gap));
      this.#lastLoadAt = Date.now();
      const iframe = document.createElement("iframe");
      iframe.name = `${RESOLVE_IFRAME_NAME_PREFIX}${token}`;
      iframe.src = src;
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;z-index:2147483647";
      const wait = this.#bus.waitFor(match, timeoutMs);
      try {
        document.documentElement.appendChild(iframe);
        return await wait;
      } finally {
        iframe.remove();
      }
    }
    async resolveChapter(comic, chapterUrl, timeoutMs = 45e3) {
      const src = `${buildReadPath(comic, chapterUrl)}?_myr=${Date.now().toString(36)}`;
      const match = (ev2) => ev2.kind === "chapter-images" && ev2.chapterUrl === chapterUrl;
      const ev = await this.#loadInIframe(src, this.#bus.token, match, timeoutMs);
      if (ev.kind !== "chapter-images") throw new Error("unexpected-capture-event");
      const siteId = ev.siteId ?? comic.siteId;
      return {
        chapterUrl,
        images: ev.images.map((img) => finalizeImageUrl(siteId, img)),
        resolvedAt: ev.capturedAt
      };
    }
    async resolveComic(comic, seedChapterUrl, timeoutMs = 45e3) {
      const src = `${buildReadPath(comic, seedChapterUrl)}?_myr=${Date.now().toString(36)}`;
      const match = (ev2) => ev2.kind === "details";
      const ev = await this.#loadInIframe(src, this.#bus.token, match, timeoutMs);
      if (ev.kind !== "details") throw new Error("unexpected-capture-event");
      const siteId = ev.siteId ?? comic.siteId;
      return {
        ref: { siteId, detailUrl: ev.detailUrl ?? comic.detailUrl },
        title: ev.payload.title ?? "",
        coverUrl: ev.payload.coverUrl,
        chapters: normalizeChapters(siteId, ev.payload.chapters ?? [])
      };
    }
  }
  function createMangayunAdapter(bus) {
    const resolver = new ChapterResolver(bus);
    function readRouteOf(url) {
      return parseReadPath(url.pathname) ?? parseReadSearch(url.search);
    }
    return {
      matchReadUrl: readRouteOf,
      buildReadUrl(comic, chapterUrl) {
        return buildReadPath(comic, chapterUrl);
      },
      currentReadRoute() {
        return readRouteOf(new URL(location.href));
      },
      onComicInfo(cb) {
        return bus.on((ev) => {
          if (ev.kind !== "details") return;
          const route = readRouteOf(new URL(location.href));
          const siteId = ev.siteId ?? route?.comic.siteId;
          if (!siteId) return;
          const chapters = normalizeChapters(siteId, ev.payload.chapters ?? []);
          cb({
            ref: { siteId, detailUrl: ev.detailUrl ?? route?.comic.detailUrl ?? "" },
            title: ev.payload.title ?? "",
            coverUrl: ev.payload.coverUrl,
            chapters
          });
        });
      },
      onPageList(cb) {
        return bus.on((ev) => {
          if (ev.kind !== "chapter-images") return;
          const siteId = ev.siteId ?? "";
          cb(
            {
              chapterUrl: ev.chapterUrl ?? "",
              images: ev.images.map((img) => finalizeImageUrl(siteId, img)),
              resolvedAt: ev.capturedAt
            },
            siteId
          );
        });
      },
      async resolveComic(comic, seedChapterUrl) {
        return resolver.resolveComic(comic, seedChapterUrl);
      },
      async resolveChapter(comic, chapterUrl) {
        return resolver.resolveChapter(comic, chapterUrl);
      },
      supportOf
    };
  }
  class Cleanup {
    #items = [];
    #done = false;
    /** 登记一个释放动作，返回撤销登记（不执行）函数。 */
    add(dispose) {
      if (this.#done) {
        dispose();
        return () => {
        };
      }
      let disposed = false;
      const wrapper = () => {
        if (disposed) return;
        disposed = true;
        dispose();
      };
      this.#items.push(wrapper);
      return () => {
        if (disposed) return;
        const i = this.#items.indexOf(wrapper);
        if (i >= 0) this.#items.splice(i, 1);
        wrapper();
      };
    }
    addListener(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      this.add(() => target.removeEventListener(type, listener, options));
    }
    setTimeout(fn, ms) {
      const id = setTimeout(() => {
        cancel();
        fn();
      }, ms);
      const cancel = this.add(() => clearTimeout(id));
    }
    setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      this.add(() => clearInterval(id));
    }
    objectUrl(obj) {
      const url = URL.createObjectURL(obj);
      this.add(() => URL.revokeObjectURL(url));
      return url;
    }
    get size() {
      return this.#items.length;
    }
    run() {
      if (this.#done) return;
      this.#done = true;
      for (const dispose of this.#items.splice(0).reverse()) dispose();
    }
  }
  const CAPTURE_SOURCE = "myr:v1:capture";
  const RESOLVE_FORWARD_SOURCE = "myr:v1:resolve";
  const PAGE_FLAG = "__myrCaptureV1";
  function pageCaptureBootstrap(token) {
    const w = window;
    const page = w;
    if (page["__myrCaptureV1"]) return;
    page["__myrCaptureV1"] = token;
    const orig = w.fetch.bind(w);
    const send = (msg) => {
      try {
        w.postMessage(Object.assign({ source: "myr:v1:capture", token }, msg), w.location.origin);
      } catch {
      }
    };
    w.addEventListener("message", (e) => {
      if (e.origin !== w.location.origin) return;
      const d = e.data;
      if (!d || d.source !== "myr:v1:ping" || d.token !== token) return;
      send({ kind: "pong", capturedAt: Date.now() });
    });
    w.fetch = function myrWrappedFetch(input, init) {
      let url = "";
      try {
        url = typeof input === "string" ? input : String(input && input.url ? input.url : "");
      } catch {
        url = "";
      }
      const p = orig(input, init);
      const path = url.split("?")[0] ?? "";
      if (!/\/api\/(details|chapter-images)$/.test(path)) return p;
      let req = {};
      try {
        if (init && typeof init.body === "string") req = JSON.parse(init.body);
      } catch {
        req = {};
      }
      p.then((res) => {
        try {
          if (!res.ok) return;
          const clone = res.clone();
          clone.json().then((json) => {
            const data = json && json.data;
            if (path.endsWith("/api/details")) {
              if (data && Array.isArray(data.chapters)) {
                send({
                  kind: "details",
                  siteId: req.siteId ?? null,
                  detailUrl: req.detailUrl ?? null,
                  payload: data,
                  capturedAt: Date.now()
                });
              }
            } else if (path.endsWith("/api/chapter-images")) {
              if (data && Array.isArray(data.images)) {
                send({
                  kind: "chapter-images",
                  siteId: req.siteId ?? null,
                  chapterUrl: req.chapterUrl ?? null,
                  images: data.images.filter((x) => typeof x === "string"),
                  capturedAt: Date.now()
                });
              }
            }
          }).catch(() => {
          });
        } catch {
        }
      }).catch(() => {
      });
      return p;
    };
  }
  function captureInjectSource(token) {
    return `(${pageCaptureBootstrap.toString()})(${JSON.stringify(token)});`;
  }
  function getUnsafeWindow() {
    try {
      const uw = globalThis.unsafeWindow;
      if (uw && uw.fetch) return uw;
    } catch {
    }
    return null;
  }
  const RECENT_LIMIT = 40;
  const RECENT_TTL_MS = 30 * 60 * 1e3;
  class CaptureBus {
    #cleanup = new Cleanup();
    #token = `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    #subscribers = /* @__PURE__ */ new Set();
    #recent = [];
    #started = false;
    get token() {
      return this.#token;
    }
    start() {
      if (this.#started) return;
      this.#started = true;
      this.#installPageCapture();
      const onMessage = (e) => this.#handleMessage(e);
      window.addEventListener("message", onMessage);
      this.#cleanup.add(() => window.removeEventListener("message", onMessage));
    }
    #handleMessage(e) {
      if (e.origin !== location.origin) return;
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.token !== this.#token) return;
      const source = data.source;
      if (source === CAPTURE_SOURCE || source === RESOLVE_FORWARD_SOURCE) {
        const event = source === RESOLVE_FORWARD_SOURCE ? data.event : toEvent(data);
        if (event) this.#dispatch(event);
      }
    }
    #dispatch(event) {
      const now = Date.now();
      this.#recent.push({ event, at: now });
      while (this.#recent.length > RECENT_LIMIT) this.#recent.shift();
      this.#recent = this.#recent.filter((r) => now - r.at < RECENT_TTL_MS);
      for (const cb of [...this.#subscribers]) {
        try {
          cb(event);
        } catch {
        }
      }
    }
    /** 测试与 iframe 转发路径：直接投递事件。 */
    injectEvent(event) {
      this.#dispatch(event);
    }
    on(cb) {
      this.#subscribers.add(cb);
      return () => this.#subscribers.delete(cb);
    }
    /** 等待匹配事件；先查最近缓冲。 */
    waitFor(match, timeoutMs) {
      const cached = [...this.#recent].reverse().find((r) => match(r.event));
      if (cached) return Promise.resolve(cached.event);
      return new Promise((resolve, reject) => {
        const off = this.on((ev) => {
          if (!match(ev)) return;
          cleanupFns.forEach((fn) => fn());
          resolve(ev);
        });
        const timer = setTimeout(() => {
          cleanupFns.forEach((fn) => fn());
          reject(new Error("capture-wait-timeout"));
        }, timeoutMs);
        const cleanupFns = [off, () => clearTimeout(timer)];
      });
    }
    #installPageCapture() {
      try {
        const el2 = document.createElement("script");
        el2.textContent = captureInjectSource(this.#token);
        document.documentElement.appendChild(el2);
        el2.remove();
        const page2 = getUnsafeWindow();
        if (!page2 || page2[PAGE_FLAG] === this.#token) return;
      } catch {
      }
      const page = getUnsafeWindow();
      if (!page || page[PAGE_FLAG] || !page.fetch) return;
      page[PAGE_FLAG] = this.#token;
      const token = this.#token;
      const orig = page.fetch.bind(page);
      page.fetch = function(input, init) {
        return wrapFetchForCapture(orig, token, input, init);
      };
    }
    stop() {
      this.#cleanup.run();
      this.#subscribers.clear();
      this.#recent = [];
      this.#started = false;
    }
  }
  function toEvent(data) {
    if (data.kind === "details" && data.payload && typeof data.payload === "object") {
      return {
        kind: "details",
        siteId: data.siteId ?? null,
        detailUrl: data.detailUrl ?? null,
        payload: data.payload,
        capturedAt: data.capturedAt ?? Date.now()
      };
    }
    if (data.kind === "chapter-images" && Array.isArray(data.images)) {
      return {
        kind: "chapter-images",
        siteId: data.siteId ?? null,
        chapterUrl: data.chapterUrl ?? null,
        images: data.images,
        capturedAt: data.capturedAt ?? Date.now()
      };
    }
    return null;
  }
  function wrapFetchForCapture(orig, token, input, init) {
    const send = (msg) => {
      try {
        window.postMessage(Object.assign({ source: CAPTURE_SOURCE, token }, msg), location.origin);
      } catch {
      }
    };
    let url = "";
    try {
      url = typeof input === "string" ? input : String(input && input.url ? input.url : "");
    } catch {
      url = "";
    }
    const p = orig(input, init);
    const path = url.split("?")[0] ?? "";
    if (!/\/api\/(details|chapter-images)$/.test(path)) return p;
    let req = {};
    try {
      if (init && typeof init.body === "string") req = JSON.parse(init.body);
    } catch {
      req = {};
    }
    void p.then((res) => {
      if (!res.ok) return;
      res.clone().json().then((json) => {
        const data = json && json.data;
        if (path.endsWith("/api/details") && data && Array.isArray(data.chapters)) {
          send({
            kind: "details",
            siteId: req.siteId ?? null,
            detailUrl: req.detailUrl ?? null,
            payload: data,
            capturedAt: Date.now()
          });
        } else if (path.endsWith("/api/chapter-images") && data && Array.isArray(data.images)) {
          send({
            kind: "chapter-images",
            siteId: req.siteId ?? null,
            chapterUrl: req.chapterUrl ?? null,
            images: data.images.filter((x) => typeof x === "string"),
            capturedAt: Date.now()
          });
        }
      }).catch(() => {
      });
    }).catch(() => {
    });
    return p;
  }
  function gmApi() {
    const g2 = globalThis;
    if (typeof g2.GM_getValue === "function" && typeof g2.GM_setValue === "function") {
      return g2;
    }
    return null;
  }
  const LS_PREFIX = "myr:kv:";
  function createKV() {
    const gm = gmApi();
    if (gm) {
      return {
        get(key) {
          const v = gm.GM_getValue(key, void 0);
          return v ?? void 0;
        },
        set(key, value) {
          gm.GM_setValue(key, value);
        },
        delete(key) {
          if (typeof gm.GM_deleteValue === "function") gm.GM_deleteValue(key);
        },
        list() {
          if (typeof gm.GM_listValues === "function") return gm.GM_listValues();
          return [];
        }
      };
    }
    const storage = () => {
      try {
        return globalThis.localStorage ?? null;
      } catch {
        return null;
      }
    };
    return {
      get(key) {
        const raw = storage()?.getItem(LS_PREFIX + key);
        if (raw == null) return void 0;
        try {
          return JSON.parse(raw);
        } catch {
          return void 0;
        }
      },
      set(key, value) {
        try {
          storage()?.setItem(LS_PREFIX + key, JSON.stringify(value));
        } catch {
        }
      },
      delete(key) {
        try {
          storage()?.removeItem(LS_PREFIX + key);
        } catch {
        }
      },
      list() {
        const s = storage();
        if (!s) return [];
        const out = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
        }
        return out;
      }
    };
  }
  function fnv1aHex(text) {
    let h2 = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h2 ^= text.charCodeAt(i);
      h2 = Math.imul(h2, 16777619);
    }
    return (h2 >>> 0).toString(16).padStart(8, "0");
  }
  const DEFAULT_SETTINGS = {
    schema: 1,
    autoEnter: false,
    mode: "vertical",
    direction: "rtl",
    verticalWidth: 100,
    horizontalFit: "auto",
    horizontalGap: true,
    singleFit: "screen",
    tapZones: { top: "prev", left: "prev", bottom: "next", right: "next" },
    tapInContinuous: true,
    preload: { before: 1, after: 3 },
    background: "black",
    keepAwake: true,
    download: { concurrency: 2 }
  };
  const KEY_SETTINGS = "myr:v1:settings";
  const KEY_RECENT = "myr:v1:recent";
  function comicKey(comic) {
    return `myr:v1:comic:${fnv1aHex(`${comic.siteId}
${comic.detailUrl}`)}`;
  }
  const HORIZONTAL_FITS = ["auto", "height", "screen"];
  function clampSettings(s) {
    return {
      ...s,
      verticalWidth: Math.min(100, Math.max(50, Math.round(s.verticalWidth))),
      horizontalFit: HORIZONTAL_FITS.includes(s.horizontalFit) ? s.horizontalFit : "auto",
      preload: {
        before: Math.min(5, Math.max(0, Math.round(s.preload.before))),
        after: Math.min(10, Math.max(1, Math.round(s.preload.after)))
      },
      download: { concurrency: Math.min(4, Math.max(1, Math.round(s.download.concurrency))) }
    };
  }
  function mergeSettings(raw) {
    const base = { ...DEFAULT_SETTINGS, ...raw };
    return clampSettings({
      ...base,
      tapZones: { ...DEFAULT_SETTINGS.tapZones, ...base.tapZones ?? {} },
      preload: { ...DEFAULT_SETTINGS.preload, ...base.preload ?? {} },
      download: { ...DEFAULT_SETTINGS.download, ...base.download ?? {} }
    });
  }
  class SettingsStore {
    #kv;
    #cache;
    constructor(kv) {
      this.#kv = kv;
      this.#cache = mergeSettings(kv.get(KEY_SETTINGS));
    }
    get() {
      return this.#cache;
    }
    update(patch) {
      this.#cache = mergeSettings({ ...this.#cache, ...patch, schema: DEFAULT_SETTINGS.schema });
      this.#kv.set(KEY_SETTINGS, this.#cache);
      return this.#cache;
    }
    reset() {
      this.#cache = mergeSettings(void 0);
      this.#kv.set(KEY_SETTINGS, this.#cache);
      return this.#cache;
    }
    /** 生效设置：全局默认 + 单部漫画覆盖项。 */
    effective(comic) {
      if (!comic) return this.#cache;
      const record = this.#kv.get(comicKey(comic));
      if (!record?.overrides) return this.#cache;
      return mergeSettings({ ...this.#cache, ...record.overrides });
    }
  }
  function migrateStorage(kv) {
    const result = { migrated: [] };
    const raw = kv.get(KEY_SETTINGS);
    if (raw !== void 0) {
      const normalized = mergeSettings(raw);
      kv.set(KEY_SETTINGS, normalized);
      if (JSON.stringify(normalized) !== JSON.stringify(raw)) result.migrated.push(KEY_SETTINGS);
    }
    return result;
  }
  function exportData(kv) {
    const data = {};
    for (const key of kv.list()) {
      if (key.startsWith("myr:v1:")) data[key] = kv.get(key);
    }
    return JSON.stringify({ tool: "mangayun-reader", schema: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), data }, null, 2);
  }
  function importData(kv, json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.tool !== "mangayun-reader" || !parsed.data || typeof parsed.data !== "object") {
        return { ok: false, error: "不是本脚本的导出文件" };
      }
      for (const key of kv.list()) {
        if (key.startsWith("myr:v1:")) kv.delete(key);
      }
      for (const [key, value] of Object.entries(parsed.data)) {
        if (key.startsWith("myr:v1:")) kv.set(key, value);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "解析失败" };
    }
  }
  const MAX_COMICS = 500;
  const SAVE_DEBOUNCE_MS = 500;
  class ProgressStore {
    constructor(kv) {
      this.kv = kv;
      this.#kv = kv;
    }
    #kv;
    #pending = null;
    #timer = null;
    #listeners = /* @__PURE__ */ new Set();
    onChanged(cb) {
      this.#listeners.add(cb);
      return () => this.#listeners.delete(cb);
    }
    #notify() {
      for (const cb of [...this.#listeners]) cb();
    }
    /** 滚动变化时调用；500ms 防抖落盘。 */
    record(comic, anchor) {
      this.#pending = { comic, anchor };
      if (this.#timer != null) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.flush();
      }, SAVE_DEBOUNCE_MS);
    }
    /** 立即保存（页面隐藏、离开阅读器时）。 */
    flush() {
      if (this.#timer != null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      if (!this.#pending) return;
      const { comic, anchor } = this.#pending;
      this.#pending = null;
      this.#saveAnchor(comic, anchor);
    }
    #saveAnchor(comic, anchor) {
      const key = comicKey(comic);
      const record = this.#kv.get(key) ?? { ref: comic };
      if (record.ref.detailUrl !== comic.detailUrl) {
        return;
      }
      record.ref = comic;
      record.progress = { ...anchor, updatedAt: Date.now() };
      this.#kv.set(key, record);
      this.#touchRecent(key);
      this.#evict();
      this.#notify();
    }
    get(comic) {
      const record = this.#kv.get(comicKey(comic));
      if (!record?.progress) return null;
      return record.progress;
    }
    /** 更新标题等元数据（不触发淘汰重排）。 */
    updateMeta(comic, title) {
      const key = comicKey(comic);
      const record = this.#kv.get(key) ?? { ref: comic };
      if (record.ref.detailUrl !== comic.detailUrl) return;
      record.ref = comic;
      record.title = title;
      this.#kv.set(key, record);
    }
    setOverrides(comic, overrides) {
      const key = comicKey(comic);
      const record = this.#kv.get(key) ?? { ref: comic };
      if (record.ref.detailUrl !== comic.detailUrl) return;
      record.ref = comic;
      record.overrides = overrides ?? void 0;
      this.#kv.set(key, record);
    }
    #touchRecent(key) {
      const recent = this.#kv.get(KEY_RECENT) ?? [];
      const next = [key, ...recent.filter((k) => k !== key)];
      this.#kv.set(KEY_RECENT, next);
    }
    /** R-P6：超过 500 部时淘汰最久未读。 */
    #evict() {
      const recent = this.#kv.get(KEY_RECENT) ?? [];
      if (recent.length <= MAX_COMICS) return;
      const keep = recent.slice(0, MAX_COMICS);
      const drop = recent.slice(MAX_COMICS);
      for (const key of drop) this.#kv.delete(key);
      this.#kv.set(KEY_RECENT, keep);
    }
    recentCount() {
      return (this.#kv.get(KEY_RECENT) ?? []).length;
    }
  }
  const DEFAULT_THRESHOLDS = {
    tapMovePx: 10,
    tapMs: 300,
    longpressMs: 500,
    swipeMinRatioW: 0.15,
    swipeVelocity: 0.5,
    swipeHorizontalDominance: 1.5,
    cooldownMs: 300,
    viewportWidth: 400
  };
  class GestureRecognizer {
    #state = "idle";
    #thresholds;
    #cb;
    #start = null;
    #last = null;
    #activePointers = /* @__PURE__ */ new Map();
    #longpressTimer = null;
    #cooldownTimer = null;
    constructor(cb, thresholds) {
      this.#cb = cb;
      this.#thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    }
    get state() {
      return this.#state;
    }
    updateThresholds(patch) {
      this.#thresholds = { ...this.#thresholds, ...patch };
    }
    pointerDown(id, x, y, t) {
      if (this.#state === "cooldown") return;
      this.#activePointers.set(id, { x, y, t });
      if (this.#activePointers.size === 2) {
        this.#toMulti();
        return;
      }
      if (this.#activePointers.size > 2) return;
      this.#state = "pending";
      this.#start = { x, y, t };
      this.#last = { x, y, t };
      this.#longpressTimer = setTimeout(() => {
        if (this.#state !== "pending") return;
        this.#state = "longpress";
        this.#cb.onLongPress?.();
      }, this.#thresholds.longpressMs);
    }
    pointerMove(id, x, y, t) {
      const rec = this.#activePointers.get(id);
      if (!rec) return;
      rec.x = x;
      rec.y = y;
      rec.t = t;
      if (this.#state === "pending" && this.#start) {
        const dx = x - this.#start.x;
        const dy = y - this.#start.y;
        if (Math.hypot(dx, dy) >= this.#thresholds.tapMovePx) {
          this.#clearLongpress();
          this.#state = "pan";
        } else {
          this.#last = { x, y, t };
          return;
        }
      }
      if (this.#state === "pan" && this.#last) {
        const dx = x - this.#last.x;
        const dy = y - this.#last.y;
        this.#cb.onPan?.(dx, dy);
      }
      this.#last = { x, y, t };
    }
    pointerUp(id, x, y, t) {
      this.#activePointers.delete(id);
      if (this.#state === "multi") {
        if (this.#activePointers.size === 0) this.#startCooldown();
        return;
      }
      if (this.#state === "cooldown") return;
      if (this.#state === "pending" && this.#start) {
        const dist = Math.hypot(x - this.#start.x, y - this.#start.y);
        const dur = t - this.#start.t;
        this.#clearLongpress();
        if (dist < this.#thresholds.tapMovePx && dur < this.#thresholds.tapMs) {
          this.#state = "idle";
          this.#cb.onTap?.(x, y);
          return;
        }
      }
      if (this.#state === "pan" && this.#start) {
        const dx = x - this.#start.x;
        const dy = y - this.#start.y;
        const dur = Math.max(1, t - this.#start.t);
        const velocity = Math.hypot(dx, dy) / dur;
        this.#state = "idle";
        this.#maybeSwipe(dx, dy, velocity);
        return;
      }
      this.#state = "idle";
    }
    pointerCancel(id) {
      this.#activePointers.delete(id);
      this.#clearLongpress();
      if (this.#state === "multi") {
        if (this.#activePointers.size === 0) this.#startCooldown();
        return;
      }
      this.#state = this.#activePointers.size > 0 ? "pending" : "idle";
      if (this.#state === "idle") this.#start = null;
    }
    #toMulti() {
      this.#clearLongpress();
      this.#state = "multi";
      this.#cb.onMultiTouch?.(true);
    }
    #startCooldown() {
      this.#cb.onMultiTouch?.(false);
      this.#state = "cooldown";
      this.#start = null;
      this.#cooldownTimer = setTimeout(() => {
        this.#cooldownTimer = null;
        if (this.#state === "cooldown") this.#state = "idle";
      }, this.#thresholds.cooldownMs);
    }
    #clearLongpress() {
      if (this.#longpressTimer != null) {
        clearTimeout(this.#longpressTimer);
        this.#longpressTimer = null;
      }
    }
    /** §4.5：水平位移 ≥ 15% 视口宽，或速度 ≥ 0.5 px/ms，且水平位移 ≥ 1.5 倍垂直位移。 */
    #maybeSwipe(dx, dy, velocity) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ay > 0 && ax < ay * this.#thresholds.swipeHorizontalDominance) return;
      if (ay === 0 && ax === 0) return;
      const far = ax >= this.#thresholds.viewportWidth * this.#thresholds.swipeMinRatioW;
      const fast = velocity >= this.#thresholds.swipeVelocity;
      if (!far && !fast) return;
      this.#cb.onSwipe?.(dx < 0 ? "left" : "right", velocity);
    }
    dispose() {
      this.#clearLongpress();
      if (this.#cooldownTimer != null) clearTimeout(this.#cooldownTimer);
      this.#activePointers.clear();
      this.#state = "idle";
      this.#start = null;
      this.#last = null;
    }
  }
  const DEFAULT_RATIO = 0.75;
  const AUTO_RETRY_LIMIT = 2;
  const AUTO_RETRY_DELAY_MS = 1e3;
  class PageWindow {
    slots = [];
    imgs = [];
    #pages;
    #config;
    #cb;
    #ratios;
    #inWindow = /* @__PURE__ */ new Set();
    #retryCount = /* @__PURE__ */ new Map();
    #failed = /* @__PURE__ */ new Set();
    #retryTimers = /* @__PURE__ */ new Map();
    /** 已加载出真实比例的页；前几张一致时把占位比例统一为真实比例（消除加载完成时的尺寸跳变）。 */
    #realRatios = /* @__PURE__ */ new Set();
    #loadedRatios = [];
    #commonRatio = null;
    constructor(pages, config, cb = {}) {
      this.#pages = pages;
      this.#config = config;
      this.#cb = cb;
      this.#ratios = pages.map(() => DEFAULT_RATIO);
      for (let i = 0; i < pages.length; i++) {
        const slot = document.createElement("div");
        slot.className = "myr-page";
        slot.style.aspectRatio = `${DEFAULT_RATIO}`;
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.loading = "eager";
        slot.appendChild(img);
        this.slots.push(slot);
        this.imgs.push(img);
        this.#wireImage(i);
      }
    }
    #wireImage(page) {
      const img = this.imgs[page];
      img.addEventListener("load", () => {
        this.slots[page]?.classList.remove("myr-page-error");
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const ratio = img.naturalWidth / img.naturalHeight;
          this.#realRatios.add(page);
          if (this.#commonRatio == null) {
            this.#loadedRatios.push(ratio);
            this.#maybeAdoptCommonRatio();
          }
          if (Math.abs(ratio - this.#ratios[page]) > 1e-3) {
            this.#ratios[page] = ratio;
            this.slots[page]?.style.setProperty("aspect-ratio", `${ratio}`);
            this.#cb.onRatioChange?.(page, ratio);
          }
        }
      });
      img.addEventListener("error", () => this.#onError(page));
    }
    /** 前 2 张已加载且比例一致（±5%）→ 未加载页的占位比例改为该值，减少加载后的布局跳变。 */
    #maybeAdoptCommonRatio() {
      const loaded = this.#loadedRatios;
      if (loaded.length < 2 || this.#commonRatio != null) return;
      const [a, b] = loaded;
      if (a == null || b == null) return;
      if (Math.abs(a - b) / Math.max(a, b) > 0.05) return;
      const common = (a + b) / 2;
      this.#commonRatio = common;
      for (const [i, slot] of this.slots.entries()) {
        if (this.#realRatios.has(i)) continue;
        this.#ratios[i] = common;
        slot.style.setProperty("aspect-ratio", `${common}`);
        this.#cb.onRatioChange?.(i, common);
      }
    }
    #onError(page) {
      const attempts = this.#retryCount.get(page) ?? 0;
      if (attempts < AUTO_RETRY_LIMIT) {
        this.#retryCount.set(page, attempts + 1);
        const timer = setTimeout(() => {
          this.#retryTimers.delete(page);
          this.#load(page);
        }, AUTO_RETRY_DELAY_MS * (attempts + 1));
        this.#retryTimers.set(page, timer);
        return;
      }
      this.#failed.add(page);
      const slot = this.slots[page];
      if (slot && !slot.querySelector(".myr-page-retry")) {
        const overlay = document.createElement("div");
        overlay.className = "myr-page-retry";
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.textContent = "重试";
        retryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          overlay.remove();
          this.retry(page);
        });
        const reparseBtn = document.createElement("button");
        reparseBtn.type = "button";
        reparseBtn.textContent = "重新解析本话";
        reparseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.#cb.onReparseChapter?.();
        });
        overlay.append(retryBtn, reparseBtn);
        slot.appendChild(overlay);
      }
      slot?.classList.add("myr-page-error");
      this.#cb.onFatalError?.(page);
    }
    appendTo(container) {
      const frag = document.createDocumentFragment();
      for (const slot of this.slots) frag.appendChild(slot);
      container.appendChild(frag);
    }
    get pages() {
      return this.#pages;
    }
    ratioOf(page) {
      return this.#ratios[page] ?? DEFAULT_RATIO;
    }
    setConfig(config) {
      this.#config = config;
    }
    /**
     * 按锚点页与可见范围更新预加载窗口；窗口外的释放 src、保留占位尺寸。
     * visible 为当前视口内实际可见的首页/末页（横屏一屏可见 3~4 页）：
     * 窗口 = [min(可见首, 当前)-before, max(可见末, 当前)+after]，
     * 可见页永不因参考线翻页被卸载（否则露出一角的页会闪白）。
     */
    update(current, visible) {
      const before = this.#config.before;
      const after = this.#config.after;
      const lo = Math.min(visible ? visible.first : current, current) - before;
      const hi = Math.max(visible ? visible.last : current, current) + after;
      const next = /* @__PURE__ */ new Set();
      for (let i = Math.max(0, lo); i <= Math.min(this.#pages.length - 1, hi); i++) next.add(i);
      for (const i of this.#inWindow) {
        if (!next.has(i) && !this.#failed.has(i)) this.#unload(i);
      }
      for (const i of next) {
        if (!this.#inWindow.has(i)) this.#load(i);
      }
      this.#inWindow = next;
      for (const [i, img] of this.imgs.entries()) {
        if (i === current) img.setAttribute("fetchpriority", "high");
        else img.removeAttribute("fetchpriority");
      }
    }
    /** 当前持有图片的元素数量（验收：不超过窗口大小 + 2）。 */
    loadedCount() {
      let n = 0;
      for (const img of this.imgs) if (img.getAttribute("src")) n++;
      return n;
    }
    #load(page) {
      const url = this.#pages[page];
      const img = this.imgs[page];
      if (!url || !img) return;
      this.slots[page]?.classList.remove("myr-page-error");
      this.#failed.delete(page);
      if (img.getAttribute("src") !== url) img.src = url;
    }
    #unload(page) {
      const img = this.imgs[page];
      if (!img) return;
      img.removeAttribute("src");
      img.removeAttribute("fetchpriority");
    }
    /** 手动重试失败页。 */
    retry(page) {
      const timer = this.#retryTimers.get(page);
      if (timer) {
        clearTimeout(timer);
        this.#retryTimers.delete(page);
      }
      this.#retryCount.delete(page);
      this.#load(page);
      this.#inWindow.add(page);
    }
    unmount() {
      for (const timer of this.#retryTimers.values()) clearTimeout(timer);
      this.#retryTimers.clear();
      for (const img of this.imgs) img.removeAttribute("src");
    }
  }
  function resolveZone(x, y, w, h2) {
    if (h2 <= 0 || w <= 0) return "center";
    if (y < h2 * 0.2) return "top";
    if (y >= h2 * 0.8) return "bottom";
    if (x < w * 0.3) return "left";
    if (x >= w * 0.7) return "right";
    return "center";
  }
  function zoneOutcome(zone, config) {
    if (zone === "center") return "menu";
    return config[zone];
  }
  function outcomeAt(x, y, w, h2, config) {
    return zoneOutcome(resolveZone(x, y, w, h2), config);
  }
  function invertHorizontalZones(zones) {
    return { ...zones, left: zones.right, right: zones.left };
  }
  const TAP_PRESETS = {
    default: { label: "默认", zones: { top: "prev", left: "prev", bottom: "next", right: "next" } },
    paging: {
      label: "左右翻页",
      zones: { top: "none", left: "prev", bottom: "none", right: "next" }
    },
    reversed: {
      label: "左右反转",
      zones: { top: "none", left: "next", bottom: "none", right: "prev" }
    },
    menuOnly: { label: "仅菜单", zones: { top: "none", left: "none", bottom: "none", right: "none" } }
  };
  class ContinuousMode {
    host;
    axis;
    cleanup = new Cleanup();
    scroller;
    content;
    win;
    gesture;
    #lastAnchor = null;
    constructor(options) {
      this.host = options.host;
      this.axis = options.axis;
    }
    /** 子类可在尺寸变化（横竖屏）时重算布局（如横向适配切换）。 */
    onViewportChange() {
    }
    /** 子类可在页面真实比例变化时重算布局。 */
    onPageRatioChange() {
    }
    /** 页内容盒（含占位尺寸）的定位坐标。 */
    rectOf(el2) {
      return el2.getBoundingClientRect();
    }
    mount(root, anchor) {
      const s = this.host.settings;
      this.scroller = document.createElement("div");
      this.scroller.className = this.axis === "y" ? "myr-scroll myr-scroll-v" : "myr-scroll myr-scroll-h";
      if (this.axis === "x" && s.direction === "rtl") this.scroller.classList.add("myr-rtl");
      this.scroller.style.touchAction = this.axis === "y" ? "pan-y pinch-zoom" : "pan-x pinch-zoom";
      this.content = document.createElement("div");
      this.content.className = this.axis === "y" ? "myr-strip-v" : "myr-strip-h";
      this.scroller.appendChild(this.content);
      root.appendChild(this.scroller);
      this.win = new PageWindow(
        this.host.pages,
        { before: s.preload.before, after: s.preload.after },
        {
          onRatioChange: (page) => {
            this.onPageRatioChange();
            this.#compensateRatioChange(page);
          },
          onFatalError: () => {
          },
          onReparseChapter: () => this.host.onReparseChapter()
        }
      );
      this.win.appendTo(this.content);
      this.decorate();
      let rafPending = false;
      this.cleanup.addListener(this.scroller, "scroll", () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          const a = this.computeAnchor();
          this.#lastAnchor = a;
          this.win.update(a.page, this.#visibleRange());
          this.host.onPageChange(a.page);
          this.host.onAnchorChange(a);
        });
      });
      let lastW = window.innerWidth;
      let lastH = window.innerHeight;
      const onResize = () => {
        const w = window.innerWidth;
        const h2 = window.innerHeight;
        if (Math.abs(w - lastW) < 1 && Math.abs(h2 - lastH) < 150) return;
        lastW = w;
        lastH = h2;
        this.onViewportChange();
        const a = this.#lastAnchor ?? this.getAnchor();
        this.goTo(a.page, a.offset);
        this.#lastAnchor = a;
      };
      this.cleanup.addListener(window, "resize", onResize);
      if (window.visualViewport) {
        this.cleanup.addListener(window.visualViewport, "resize", onResize);
      }
      this.gesture = new GestureRecognizer({
        onTap: (x, y) => this.#handleTap(x, y)
      });
      const onPointer = (handler) => (e) => handler(e);
      this.cleanup.addListener(this.scroller, "pointerdown", onPointer((e) => {
        this.gesture.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      }));
      this.cleanup.addListener(this.scroller, "pointermove", onPointer((e) => {
        this.gesture.pointerMove(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      }));
      this.cleanup.addListener(this.scroller, "pointerup", onPointer((e) => {
        this.gesture.pointerUp(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      }));
      this.cleanup.addListener(this.scroller, "pointercancel", onPointer((e) => {
        this.gesture.pointerCancel(e.pointerId);
      }));
      this.cleanup.addListener(this.scroller, "touchstart", stopper, { passive: true });
      this.cleanup.addListener(this.scroller, "touchmove", stopper, { passive: true });
      this.cleanup.addListener(this.scroller, "touchend", stopper, { passive: true });
      this.cleanup.addListener(this.scroller, "click", stopper);
      this.cleanup.addListener(this.scroller, "contextmenu", stopper);
      requestAnimationFrame(() => {
        this.goTo(anchor.page, anchor.offset);
        this.win.update(anchor.page, this.#visibleRange());
        this.host.onPageChange(anchor.page);
      });
    }
    /** 视口内实际可见的首页/末页（横屏一屏 3~4 页时的卸载判定依据）。 */
    #visibleRange() {
      if (!this.scroller || this.win.slots.length === 0) return void 0;
      const s = this.scroller.getBoundingClientRect();
      let first = -1;
      let last = -1;
      for (const [i, slot] of this.win.slots.entries()) {
        const r = slot.getBoundingClientRect();
        if (r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom) {
          if (first < 0) first = i;
          last = i;
        }
      }
      return first >= 0 ? { first, last } : void 0;
    }
    #handleTap(x, y) {
      if (this.host.settings.tapInContinuous !== true) {
        this.host.onMenu();
        return;
      }
      if (this.host.isZoomed()) {
        const rect2 = this.scroller.getBoundingClientRect();
        const zone = outcomeAt(x - rect2.left, y - rect2.top, rect2.width, rect2.height, {
          top: "none",
          bottom: "none",
          left: "none",
          right: "none"
        });
        if (zone === "menu") this.host.onMenu();
        return;
      }
      const rect = this.scroller.getBoundingClientRect();
      const outcome = outcomeAt(x - rect.left, y - rect.top, rect.width, rect.height, this.host.settings.tapZones);
      if (outcome === "menu") this.host.onMenu();
      else if (outcome === "next") this.step(1);
      else if (outcome === "prev") this.step(-1);
    }
    getAnchor() {
      if (!this.scroller) return { page: 0, offset: 0 };
      return this.computeAnchor();
    }
    /** 前进/后退 90% 视口（R-J4、R-K4）。 */
    step(dir) {
      const rect = this.scroller.getBoundingClientRect();
      if (this.axis === "y") {
        this.scroller.scrollBy({ top: dir * rect.height * 0.9, behavior: "smooth" });
      } else {
        const forwardPositive = this.host.settings.direction !== "rtl";
        const sign = forwardPositive ? dir : -dir;
        this.scroller.scrollBy({ left: sign * rect.width * 0.9, behavior: "smooth" });
      }
    }
    /**
     * 图片真实比例与占位不符时的滚动补偿（§4.4）：保持当前页参考线不动。
     */
    #compensateRatioChange(page) {
      const a = this.computeAnchor();
      if (a.page !== page) {
        if (this.#isBefore(page, a.page)) {
          const before = this.#referenceOffsetFromViewport(a);
          requestAnimationFrame(() => {
            const after = this.#referenceOffsetFromViewport(this.computeAnchor());
            const delta = after - before;
            if (Math.abs(delta) > 0.5) {
              if (this.axis === "y") this.scroller.scrollTop += delta;
              else this.scroller.scrollBy({ left: delta });
            }
          });
        }
      }
    }
    #isBefore(page, current) {
      return page < current;
    }
    /** 锚点参考线相对视口的偏移（px）。 */
    #referenceOffsetFromViewport(a) {
      const slot = this.win.slots[a.page];
      if (!slot) return 0;
      const r = slot.getBoundingClientRect();
      if (this.axis === "y") return r.top + r.height * a.offset;
      return r.left + r.width * a.offset;
    }
    unmount() {
      this.win?.unmount();
      this.gesture?.dispose();
      this.cleanup.run();
      this.scroller?.remove();
    }
    isZoomed() {
      return (window.visualViewport?.scale ?? 1) > 1.01;
    }
  }
  function stopper(e) {
    e.stopPropagation();
  }
  class HorizontalMode extends ContinuousMode {
    #fit = "height";
    constructor(host) {
      super({ axis: "x", host });
    }
    /** 页间空隙（适应屏幕适配）：设置“页间留隙”关闭后为 0（零间隙）。 */
    #gap() {
      return this.host.settings.horizontalGap === false ? 0 : 12;
    }
    /** 生效适配：auto = 竖屏 screen（整页可见），横屏 height（无缝连续）。 */
    #resolveFit() {
      const setting = this.host.settings.horizontalFit ?? "auto";
      if (setting === "height" || setting === "screen") return setting;
      const rect = this.scroller.getBoundingClientRect();
      return rect.height > rect.width ? "screen" : "height";
    }
    /** 按当前适配给页面定尺寸（screen 用包含式显式尺寸）。 */
    #applyLayout() {
      if (!this.scroller) return;
      this.#fit = this.#resolveFit();
      this.scroller.classList.toggle("myr-h-screen", this.#fit === "screen");
      const gap = this.#gap();
      this.scroller.style.setProperty("--myr-h-gap", `${gap}px`);
      const rect = this.scroller.getBoundingClientRect();
      for (const [i, slot] of this.win.slots.entries()) {
        if (this.#fit === "screen") {
          const ratio = this.win.ratioOf(i);
          const viewRatio = rect.width / Math.max(1, rect.height);
          let w;
          let h2;
          if (ratio >= viewRatio) {
            w = rect.width - gap;
            h2 = w / ratio;
          } else {
            h2 = rect.height - gap;
            w = h2 * ratio;
          }
          slot.style.width = `${Math.max(40, w)}px`;
          slot.style.height = `${Math.max(40, h2)}px`;
        } else {
          slot.style.width = "";
          slot.style.height = "";
        }
      }
    }
    /** 基类在尺寸变化（横竖屏）时回调：先重算适配再恢复锚点。 */
    onViewportChange() {
      this.#applyLayout();
    }
    /** 页面真实比例已知/变化（占位 → 实测）：screen 适配需重定尺寸。 */
    onPageRatioChange() {
      this.#applyLayout();
    }
    decorate() {
      const start = this.makeEdgeCard("start", "上一话");
      const end = this.makeEdgeCard("end", "下一话");
      this.content.insertBefore(start, this.content.firstChild);
      this.content.appendChild(end);
    }
    makeEdgeCard(edge, label) {
      const card = document.createElement("div");
      card.className = "myr-edge-card myr-edge-card-h";
      const btn2 = document.createElement("button");
      btn2.type = "button";
      btn2.textContent = label;
      btn2.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.onChapterEdge(edge);
      });
      card.appendChild(btn2);
      return card;
    }
    /** 参考线 = 视口水平中线所在页与页内比例。 */
    computeAnchor() {
      const scrollerRect = this.scroller.getBoundingClientRect();
      const refX = scrollerRect.left + scrollerRect.width / 2;
      let page = 0;
      for (const [i, slot2] of this.win.slots.entries()) {
        const r2 = slot2.getBoundingClientRect();
        if (refX >= r2.left && refX < r2.right) {
          page = i;
          break;
        }
        if (r2.left <= refX) page = i;
      }
      const slot = this.win.slots[page];
      if (!slot) return { page: 0, offset: 0 };
      const r = slot.getBoundingClientRect();
      const offset = clamp01$1((refX - r.left) / Math.max(1, r.width));
      return { page, offset };
    }
    goTo(page, offset = 0) {
      if (!this.scroller) return;
      this.#applyLayout();
      const slot = this.win.slots[clamp$1(page, 0, this.win.slots.length - 1)];
      if (!slot) return;
      const scrollerRect = this.scroller.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const rtl = this.host.settings.direction === "rtl";
      const desiredLeftInViewport = rtl ? scrollerRect.right - r.width + (1 - clamp01$1(offset)) * Math.max(0, r.width - scrollerRect.width) : scrollerRect.left - clamp01$1(offset) * Math.max(0, r.width - scrollerRect.width);
      this.scroller.scrollBy({ left: r.left - desiredLeftInViewport });
    }
  }
  function clamp$1(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
  function clamp01$1(v) {
    return Math.min(1, Math.max(0, v));
  }
  const MAX_SCALE = 4;
  class SingleMode {
    #host;
    #cleanup = new Cleanup();
    #stage;
    #viewport;
    #win;
    #gesture;
    #page = 0;
    #scale = 1;
    #tx = 0;
    #ty = 0;
    #pointers = /* @__PURE__ */ new Map();
    #pinchStart = null;
    constructor(host) {
      this.#host = host;
    }
    mount(root, anchor) {
      const s = this.#host.settings;
      this.#stage = document.createElement("div");
      this.#stage.className = `myr-single myr-fit-${s.singleFit}`;
      this.#stage.style.touchAction = "none";
      this.#viewport = document.createElement("div");
      this.#viewport.className = "myr-single-viewport";
      this.#stage.appendChild(this.#viewport);
      root.appendChild(this.#stage);
      this.#win = new PageWindow(
        this.#host.pages,
        { before: s.preload.before, after: s.preload.after },
        {
          onRatioChange: () => this.#applyTransform(),
          onReparseChapter: () => this.#host.onReparseChapter()
        }
      );
      this.#win.appendTo(this.#viewport);
      this.#gesture = new GestureRecognizer(
        {
          onTap: (x, y) => this.#handleTap(x, y),
          onSwipe: (dir) => this.#handleSwipe(dir),
          onPan: (dx, dy) => this.#pan(dx, dy)
        },
        { viewportWidth: this.#stage.getBoundingClientRect().width || 400 }
      );
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        this.#cleanup.addListener(this.#stage, type, (e) => {
          this.#trackPointer(type, e);
        });
      }
      this.#cleanup.addListener(this.#stage, "click", (e) => e.stopPropagation());
      this.#cleanup.addListener(this.#stage, "contextmenu", (e) => e.stopPropagation());
      const onResize = () => {
        this.#gesture.updateThresholds({ viewportWidth: this.#stage.getBoundingClientRect().width || 400 });
        this.#clampTransform();
        this.#applyTransform();
      };
      this.#cleanup.addListener(window, "resize", onResize);
      this.#showPage(anchor.page, false);
    }
    #trackPointer(type, e) {
      if (type === "pointerdown") {
        this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.#gesture.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      } else if (type === "pointermove") {
        if (this.#pointers.has(e.pointerId)) {
          this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          this.#pinch();
        }
        this.#gesture.pointerMove(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      } else if (type === "pointerup") {
        this.#pointers.delete(e.pointerId);
        this.#pinchStart = null;
        this.#gesture.pointerUp(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      } else {
        this.#pointers.delete(e.pointerId);
        this.#pinchStart = null;
        this.#gesture.pointerCancel(e.pointerId);
      }
    }
    /** 双指捏合缩放（transform-origin 0 0，围绕中点）。 */
    #pinch() {
      if (this.#pointers.size !== 2) return;
      const [a, b] = [...this.#pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (!this.#pinchStart) {
        this.#pinchStart = { dist, scale: this.#scale, mx, my };
        return;
      }
      const start = this.#pinchStart;
      const nextScale = Math.min(MAX_SCALE, Math.max(1, start.scale * (dist / Math.max(1, start.dist))));
      const ratio = nextScale / this.#scale;
      const rect = this.#stage.getBoundingClientRect();
      const cx = mx - rect.left;
      const cy = my - rect.top;
      this.#tx = cx - (cx - this.#tx) * ratio;
      this.#ty = cy - (cy - this.#ty) * ratio;
      this.#scale = nextScale;
      this.#clampTransform();
      this.#applyTransform();
    }
    #pan(dx, dy) {
      if (this.#scale <= 1.01) return;
      this.#tx += dx;
      this.#ty += dy;
      this.#clampTransform();
      this.#applyTransform();
    }
    #clampTransform() {
      const rect = this.#stage.getBoundingClientRect();
      const img = this.#win.imgs[this.#page];
      if (!img || !rect.width) return;
      const w = img.clientWidth * this.#scale || rect.width * this.#scale;
      const h2 = img.clientHeight * this.#scale || rect.height * this.#scale;
      if (w <= rect.width) this.#tx = (rect.width - w) / 2;
      else this.#tx = Math.min(0, Math.max(rect.width - w, this.#tx));
      if (h2 <= rect.height) this.#ty = (rect.height - h2) / 2;
      else this.#ty = Math.min(0, Math.max(rect.height - h2, this.#ty));
    }
    #applyTransform() {
      this.#viewport.style.transform = `translate(${this.#tx}px, ${this.#ty}px) scale(${this.#scale})`;
      if (this.#scale <= 1.01) this.#viewport.classList.remove("myr-zoomed");
      else this.#viewport.classList.add("myr-zoomed");
    }
    #handleTap(x, y) {
      const rect = this.#stage.getBoundingClientRect();
      const zoomed = this.isZoomed();
      const outcome = outcomeAt(x - rect.left, y - rect.top, rect.width, rect.height, this.#host.settings.tapZones);
      if (zoomed && outcome !== "menu") return;
      if (outcome === "menu") this.#host.onMenu();
      else if (outcome === "next") this.step(1);
      else if (outcome === "prev") this.step(-1);
    }
    /** 滑动方向跟随阅读方向（R-S6）。 */
    #handleSwipe(dir) {
      if (this.isZoomed()) return;
      const forwardSwipe = this.#host.settings.direction === "rtl" ? "right" : "left";
      this.step(dir === forwardSwipe ? 1 : -1);
    }
    #showPage(page, notify = true) {
      const max = this.#host.pages.length - 1;
      const clamped = Math.min(max, Math.max(0, page));
      this.#page = clamped;
      for (const [i, slot] of this.#win.slots.entries()) {
        slot.classList.toggle("myr-active", i === clamped);
      }
      this.#resetZoom();
      this.#win.update(clamped);
      if (notify) {
        this.#host.onPageChange(clamped);
        this.#host.onAnchorChange({ page: clamped, offset: 0 });
      }
    }
    #resetZoom() {
      this.#scale = 1;
      this.#tx = 0;
      this.#ty = 0;
      this.#applyTransform();
    }
    isZoomed() {
      return this.#scale > 1.01;
    }
    computeAnchor() {
      return { page: this.#page, offset: 0 };
    }
    getAnchor() {
      return { page: this.#page, offset: 0 };
    }
    goTo(page, _offset) {
      this.#showPage(page);
    }
    step(dir) {
      const next = this.#page + dir;
      if (next < 0) {
        this.#host.onChapterEdge("start");
        return;
      }
      if (next > this.#host.pages.length - 1) {
        this.#host.onChapterEdge("end");
        return;
      }
      this.#showPage(next);
    }
    unmount() {
      this.#win?.unmount();
      this.#gesture?.dispose();
      this.#cleanup.run();
      this.#stage?.remove();
    }
  }
  class VerticalMode extends ContinuousMode {
    constructor(host) {
      super({ axis: "y", host });
    }
    decorate() {
      const width = this.host.settings.verticalWidth;
      this.content.style.width = `${width}%`;
      this.content.style.maxWidth = `${width}%`;
      this.content.style.margin = "0 auto";
      this.appendEdgeCards();
    }
    appendEdgeCards() {
      const start = this.makeEdgeCard("start", "上一话");
      const end = this.makeEdgeCard("end", "下一话");
      this.content.insertBefore(start, this.content.firstChild);
      this.content.appendChild(end);
    }
    makeEdgeCard(edge, label) {
      const card = document.createElement("div");
      card.className = "myr-edge-card";
      const btn2 = document.createElement("button");
      btn2.type = "button";
      btn2.textContent = label;
      btn2.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.onChapterEdge(edge);
      });
      card.appendChild(btn2);
      return card;
    }
    /** 参考线 = 视口垂直中线所在页与页内比例（R-K3）。 */
    computeAnchor() {
      const scrollerRect = this.scroller.getBoundingClientRect();
      const refY = scrollerRect.top + scrollerRect.height / 2;
      let page = 0;
      for (const [i, slot2] of this.win.slots.entries()) {
        const r2 = slot2.getBoundingClientRect();
        if (refY >= r2.top && refY < r2.bottom) {
          page = i;
          break;
        }
        if (r2.top <= refY) page = i;
      }
      const slot = this.win.slots[page];
      if (!slot) return { page: 0, offset: 0 };
      const r = slot.getBoundingClientRect();
      const offset = clamp01((refY - r.top) / Math.max(1, r.height));
      return { page, offset };
    }
    goTo(page, offset = 0) {
      const slot = this.win.slots[clamp(page, 0, this.win.slots.length - 1)];
      if (!slot) return;
      const scrollerRect = this.scroller.getBoundingClientRect();
      const r = slot.getBoundingClientRect();
      const targetRefY = r.top + r.height * clamp01(offset);
      const delta = targetRefY - (scrollerRect.top + scrollerRect.height / 2);
      this.scroller.scrollTop += delta;
    }
  }
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }
  const RETURN_FLAG = "myr:v1:return";
  class ReaderController {
    #deps;
    #cleanup = new Cleanup();
    #ui = null;
    #comic = null;
    #chapterUrl = "";
    #info = null;
    #pageState = null;
    #mode = null;
    #modeKind = "vertical";
    #active = false;
    #wakeLock = null;
    #savedStyles = [];
    #savedScrollLock = null;
    constructor(deps) {
      this.#deps = deps;
    }
    attachUI(ui) {
      this.#ui = ui;
    }
    get active() {
      return this.#active;
    }
    get comic() {
      return this.#comic;
    }
    get info() {
      return this.#info;
    }
    get currentChapterUrl() {
      return this.#chapterUrl;
    }
    get pages() {
      return this.#pageState?.pages ?? [];
    }
    get pageStats() {
      const anchor = this.#mode?.getAnchor();
      return { current: (anchor?.page ?? 0) + 1, total: this.pages.length };
    }
    get settings() {
      return this.#deps.settingsStore.effective(this.#comic);
    }
    get modeKind() {
      return this.#modeKind;
    }
    // ---------- 进入 / 退出 ----------
    async enter(route) {
      if (this.#active) return;
      this.#active = true;
      this.#comic = route.comic;
      this.#chapterUrl = route.chapterUrl;
      this.#hideSiteReader();
      this.#lockScroll();
      this.#ui?.open();
      this.#applyBackground();
      const offInfo = this.#deps.adapter.onComicInfo((info) => {
        if (info.ref.siteId === this.#comic?.siteId && info.chapters.length) {
          this.#info = info;
          this.#ui?.updateCatalog(info);
        }
      });
      this.#cleanup.add(offInfo);
      const offPages = this.#deps.adapter.onPageList((list) => {
        if (list.chapterUrl === this.#chapterUrl) this.#setPages(list.images, list.resolvedAt);
      });
      this.#cleanup.add(offPages);
      this.#ui?.setLoading(true, "正在获取本章图片…");
      try {
        const list = await this.#resolveCurrentChapter();
        if (!this.#active) return;
        this.#setPages(list.images, list.resolvedAt);
      } catch (e) {
        if (!this.#active) return;
        this.#ui?.setLoading(false);
        this.#ui?.showError("图片清单获取失败", e instanceof Error ? e.message : String(e), [
          { label: "重试", action: () => void this.#reloadChapter() },
          { label: "退出", action: () => this.exit() }
        ]);
        return;
      }
      void this.#ensureComicInfo().then(() => {
        if (this.#info) this.#ui?.updateCatalog(this.#info);
      });
    }
    async #resolveCurrentChapter() {
      const comic = this.#comic;
      return this.#deps.adapter.resolveChapter(comic, this.#chapterUrl);
    }
    async #ensureComicInfo() {
      if (this.#info || !this.#comic) return;
      try {
        const info = await this.#deps.adapter.resolveComic(this.#comic, this.#chapterUrl);
        if (this.#comic && info.ref.siteId === this.#comic.siteId) {
          this.#info = info;
          this.#deps.progress.updateMeta(this.#comic, info.title);
        }
      } catch {
      }
    }
    #setPages(pages, resolvedAt) {
      this.#pageState = { pages, resolvedAt };
      this.#ui?.setLoading(false);
      this.#mountMode();
    }
    async #reloadChapter() {
      this.#ui?.setLoading(true, "正在重新解析本话…");
      try {
        const list = await this.#resolveCurrentChapter();
        this.#setPages(list.images, list.resolvedAt);
      } catch (e) {
        this.#ui?.setLoading(false);
        this.#ui?.showError("重新解析失败", e instanceof Error ? e.message : String(e), [
          { label: "重试", action: () => void this.#reloadChapter() }
        ]);
      }
    }
    exit() {
      if (!this.#active) return;
      this.#flushProgress();
      this.#active = false;
      this.#unmountMode();
      this.#ui?.close();
      this.#releaseWakeLock();
      this.#cleanup.run();
      this.#cleanup = new Cleanup();
      this.#restoreSiteReader();
      this.#restoreScroll();
      this.#pageState = null;
      this.#info = null;
    }
    #hideSiteReader() {
      this.#savedStyles = [];
      const candidates = document.querySelectorAll(
        '[aria-label="漫画阅读器"], .reader-overlay, [role="dialog"][aria-modal="true"]'
      );
      for (const el2 of candidates) {
        if (!(el2 instanceof HTMLElement)) continue;
        this.#savedStyles.push({ el: el2, display: el2.style.display });
        el2.style.display = "none";
      }
    }
    #restoreSiteReader() {
      for (const { el: el2, display } of this.#savedStyles) {
        if (el2 instanceof HTMLElement) el2.style.display = display;
      }
      this.#savedStyles = [];
    }
    #lockScroll() {
      const html = document.documentElement;
      this.#savedScrollLock = {
        htmlOverscroll: html.style.overscrollBehavior,
        bodyOverflow: document.body.style.overflow
      };
      html.style.overscrollBehavior = "none";
      document.body.style.overflow = "hidden";
    }
    #restoreScroll() {
      if (!this.#savedScrollLock) return;
      document.documentElement.style.overscrollBehavior = this.#savedScrollLock.htmlOverscroll;
      document.body.style.overflow = this.#savedScrollLock.bodyOverflow;
      this.#savedScrollLock = null;
    }
    // ---------- 模式 ----------
    #modeHost() {
      const self = () => this;
      return {
        get settings() {
          return self().settings;
        },
        get pages() {
          return self().pages;
        },
        onAnchorChange: (a) => {
          this.#recordAnchor(a);
        },
        onPageChange: (page) => {
          this.#ui?.updatePageIndicator(page + 1, this.pages.length);
        },
        onMenu: () => {
          this.#ui?.toggleToolbar();
        },
        onChapterEdge: (edge) => {
          const chapter = this.#neighborChapter(edge === "start" ? -1 : 1);
          this.#ui?.showChapterCard(edge, chapter);
        },
        onReparseChapter: () => {
          void this.#reloadChapter();
        },
        isZoomed: () => this.#mode?.isZoomed?.() ?? (window.visualViewport?.scale ?? 1) > 1.01
      };
    }
    #mountMode(anchor) {
      if (!this.#active || !this.#ui || !this.#pageState) return;
      this.#unmountMode();
      const kind = this.settings.mode;
      this.#modeKind = kind;
      const host = this.#modeHost();
      const mode = kind === "horizontal" ? new HorizontalMode(host) : kind === "single" ? new SingleMode(host) : new VerticalMode(host);
      const target = anchor ?? this.#restoredAnchor();
      this.#mode = mode;
      mode.mount(this.#ui.modeRoot, target);
      const a = mode.getAnchor();
      this.#ui.updatePageIndicator(a.page + 1, this.pages.length);
      this.#ui.updateModeButtons(kind, this.settings.direction);
    }
    #unmountMode() {
      this.#mode?.unmount();
      this.#mode = null;
    }
    /** 恢复锚点：进度记录 →（无则第 1 页）。 */
    #restoredAnchor() {
      const saved = this.#comic ? this.#deps.progress.get(this.#comic) : null;
      if (saved && saved.chapterUrl === this.#chapterUrl) {
        return { page: Math.min(this.pages.length - 1, Math.max(0, saved.page)), offset: saved.offset };
      }
      return { page: 0, offset: 0 };
    }
    #recordAnchor(a) {
      if (!this.#comic) return;
      this.#deps.progress.record(this.#comic, { chapterUrl: this.#chapterUrl, page: a.page, offset: a.offset });
    }
    #flushProgress() {
      this.#deps.progress.flush();
    }
    // ---------- 设置变更 ----------
    switchMode(kind) {
      if (!this.#active) return;
      const anchor = this.#mode?.getAnchor() ?? { page: 0, offset: 0 };
      this.#applySettings({ mode: kind }, anchor);
    }
    switchDirection(direction) {
      if (!this.#active) return;
      const anchor = this.#mode?.getAnchor() ?? { page: 0, offset: 0 };
      this.#applySettings({ direction }, anchor);
    }
    /** 应用设置变更并保持锚点（R-C2）。 */
    applySettingChanges(anchor) {
      if (!this.#active) return;
      this.#applyBackground();
      this.#mountMode(anchor ?? this.#mode?.getAnchor() ?? void 0);
    }
    #applySettings(patch, anchor) {
      if (this.#comic) {
        const overrides = {
          ...this.#deps.settingsStore.effective(this.#comic),
          ...patch
        };
        const { mode, direction, verticalWidth, singleFit } = overrides;
        this.#deps.progress.setOverrides(this.#comic, { mode, direction, verticalWidth, singleFit });
      }
      this.#applyBackground();
      this.#mountMode(anchor);
    }
    #applyBackground() {
      this.#ui?.applyBackground(this.settings.background);
    }
    // ---------- 章节 ----------
    #neighborChapter(delta) {
      const chapters = this.#info?.chapters;
      if (!chapters?.length) return null;
      const idx = chapters.findIndex((c) => c.url === this.#chapterUrl);
      if (idx < 0) return null;
      return chapters[idx + delta] ?? null;
    }
    /** 切话：交给原站路由整页跳转（§7 D6），打标记返回后自动进入。 */
    navigateToChapter(chapter) {
      if (!this.#comic) return;
      try {
        sessionStorage.setItem(RETURN_FLAG, "1");
      } catch {
      }
      this.#flushProgress();
      const url = this.#deps.adapter.buildReadUrl(this.#comic, chapter.url);
      this.exit();
      location.assign(url);
    }
    jumpToPage(page) {
      this.#mode?.goTo(page);
    }
    step(dir) {
      this.#mode?.step(dir);
    }
    // ---------- 键盘（R-C6） ----------
    handleKey(e) {
      if (!this.#active) return false;
      const rtl = this.settings.direction === "rtl";
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      switch (e.key) {
        case forward:
        case "PageDown":
        case " ":
          this.step(1);
          return true;
        case backward:
        case "PageUp":
          this.step(-1);
          return true;
        case "ArrowDown":
          this.step(1);
          return true;
        case "ArrowUp":
          this.step(-1);
          return true;
        case "Escape":
          if (this.#ui?.dismissTopPanel()) return true;
          this.exit();
          return true;
        case "f":
        case "F":
          void this.toggleFullscreen();
          return true;
        default:
          return false;
      }
    }
    // ---------- 全屏 / 常亮 ----------
    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        this.#ui?.toast("当前环境不支持全屏");
      }
    }
    #releaseWakeLock() {
      void this.#wakeLock?.release().catch(() => {
      });
      this.#wakeLock = null;
    }
    async requestWakeLock() {
      if (!this.settings.keepAwake) return;
      if (this.#wakeLock && !this.#wakeLock.released) return;
      try {
        this.#wakeLock = await navigator.wakeLock.request("screen");
        this.#wakeLock.addEventListener("release", () => {
          this.#wakeLock = null;
        });
      } catch {
      }
    }
  }
  const STYLES = `
:host { all: initial }

.myr-root {
  position: fixed; inset: 0;
  display: none;
  font-family: system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  color: #eee; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.myr-root.myr-open { display: block }
.myr-bg-black { background: #000 }
.myr-bg-gray { background: #3f3f46 }
.myr-bg-white { background: #fff }
.myr-bg-system { background: light-dark(#fff, #000) }

/* ---------- 阅读模式 ---------- */
.myr-mode-root { position: absolute; inset: 0; overflow: hidden }
.myr-scroll {
  position: absolute; inset: 0;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.myr-scroll::-webkit-scrollbar { display: none }
.myr-scroll-v { overflow-y: auto; overflow-x: hidden }
.myr-scroll-h { overflow-x: auto; overflow-y: hidden; white-space: nowrap }
.myr-rtl { direction: rtl }

.myr-strip-v {
  display: flex; flex-direction: column;
  min-height: 100%;
}
.myr-strip-v > .myr-page { width: 100% }

.myr-strip-h {
  display: inline-flex; flex-direction: row;
  height: 100%;
  gap: 0;
}
.myr-rtl .myr-strip-h { flex-direction: row } /* direction:rtl 控制顺序 */
.myr-strip-h > .myr-page { height: 100%; width: auto; flex: 0 0 auto }
.myr-strip-h > .myr-page img { height: 100%; width: auto; display: block }

/* 横向“适应屏幕”适配（竖屏手机）：整页可见、垂直居中；
   页间空隙由 --myr-h-gap 控制（设置“页间留隙”可关为 0） */
.myr-h-screen .myr-strip-h {
  align-items: center;
  gap: var(--myr-h-gap, 12px);
  padding: 0 calc(var(--myr-h-gap, 12px) / 2);
}
.myr-h-screen .myr-strip-h > .myr-page {
  height: auto; width: auto; /* 尺寸由脚本按比例设定 */
}
.myr-h-screen .myr-strip-h > .myr-page img {
  height: 100%; width: 100%; object-fit: contain; display: block;
}
.myr-h-screen .myr-edge-card-h { height: auto; min-height: 40vh; align-self: center }

.myr-page { position: relative; background: inherit }
.myr-page img {
  display: block; width: 100%; height: 100%;
  object-fit: contain;
  background: transparent;
}
.myr-strip-h > .myr-page img { object-fit: fill } /* 高度适配，按比例占位 */

/* 加载占位 */
.myr-page { background-image: none }
.myr-page:not(.myr-page-error) { min-height: 40px }

/* 失败重试 */
.myr-page-error { outline: 1px dashed #666; min-height: 160px;
  display: flex; align-items: center; justify-content: center }
.myr-page-retry {
  position: absolute; inset: 0; z-index: 3;
  display: flex; gap: 12px; align-items: center; justify-content: center;
  flex-wrap: wrap; padding: 12px;
}
.myr-page-retry button {
  min-width: 96px; min-height: 48px; border-radius: 10px;
  border: 1px solid #777; background: #222; color: #eee; font-size: 14px;
}

/* 章首/章尾卡片 */
.myr-edge-card {
  display: flex; align-items: center; justify-content: center;
  padding: 32px 16px; width: 100%;
}
.myr-edge-card-h { min-width: 60vw; height: 100% }
.myr-edge-card button {
  min-width: 128px; min-height: 56px; border-radius: 12px;
  border: 1px solid #666; background: #1c1c1e; color: #eee; font-size: 15px;
}

/* ---------- 单页模式 ---------- */
.myr-single { position: absolute; inset: 0; overflow: hidden; display: flex }
.myr-single-viewport {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  transform-origin: 0 0;
  transition: none;
}
.myr-single .myr-page {
  position: absolute; inset: 0;
  display: none; align-items: center; justify-content: center;
  margin: auto;
}
.myr-single .myr-page.myr-active { display: flex }
.myr-single .myr-page img { width: auto; height: auto; max-width: none; max-height: none; object-fit: none }
.myr-fit-screen .myr-page img { max-width: 100%; max-height: 100%; object-fit: contain }
.myr-fit-width .myr-page img { width: 100%; height: auto; object-fit: contain }
.myr-fit-height .myr-page img { height: 100%; width: auto; object-fit: contain }
.myr-fit-original .myr-page img { width: auto; height: auto }

/* ---------- 工具栏 ---------- */
.myr-toolbar {
  position: absolute; inset: 0;
  pointer-events: none;
  display: flex; flex-direction: column; justify-content: space-between;
  opacity: 0; transition: opacity .18s ease;
  z-index: 10;
}
.myr-toolbar.myr-visible { opacity: 1 }
.myr-toolbar.myr-visible .myr-bar { pointer-events: auto }
.myr-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px max(10px, env(safe-area-inset-left)) calc(8px) max(10px, env(safe-area-inset-right));
  padding-top: max(8px, env(safe-area-inset-top));
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: rgba(16, 16, 18, .92);
  backdrop-filter: blur(8px);
  flex-wrap: wrap;
}
.myr-bar-bottom { row-gap: 6px }
.myr-btn {
  min-width: 48px; min-height: 48px; padding: 0 14px;
  border-radius: 10px; border: 1px solid #3a3a3e;
  background: #232326; color: #eee; font-size: 14px;
  cursor: pointer;
}
.myr-btn:active { background: #333338 }
.myr-btn-primary { background: #2f6fed; border-color: #2f6fed; color: #fff }
.myr-btn-small { min-width: 40px; min-height: 40px; padding: 0 10px; font-size: 13px }
.myr-seg-active { background: #3a5bcc; border-color: #5a78e0; color: #fff }
.myr-title {
  flex: 1; text-align: center; font-size: 15px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.myr-cluster { display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
.myr-slider-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding-top: 2px;
}
.myr-page-label { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 64px }
.myr-page-slider { flex: 1; height: 40px; accent-color: #5a8bf5 }

/* ---------- 面板 / 弹层 ---------- */
.myr-sheet-wrap {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0, 0, 0, .45);
}
.myr-sheet-wrap.myr-center { align-items: center; padding: 24px }
.myr-sheet {
  width: 100%; max-width: 560px;
  background: #1b1b1e; color: #eee;
  border-radius: 16px 16px 0 0;
  padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
  max-height: 78vh; display: flex; flex-direction: column;
}
.myr-center .myr-sheet { border-radius: 16px }
.myr-sheet-tall { height: 68vh }
.myr-sheet-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px }
.myr-sheet-title { flex: 1; font-size: 16px; font-weight: 600 }
.myr-sheet-body { overflow-y: auto; flex: 1; padding-bottom: 6px }
.myr-sheet-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap }

/* 目录 */
.myr-catalog-list { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 }
.myr-catalog-item {
  min-height: 48px; text-align: left; padding: 0 14px;
  border-radius: 10px; border: 1px solid #2c2c30;
  background: #232327; color: #ddd; font-size: 14px;
  cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.myr-catalog-now { background: #2c3f78; border-color: #40559b; color: #fff }

/* 设置 */
.myr-settings-group { margin-bottom: 14px }
.myr-settings-label { font-size: 13px; color: #aaa; margin-bottom: 6px }
.myr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.myr-wrap { flex-wrap: wrap }
.myr-value { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums }
.myr-mini-label { font-size: 13px; min-width: 34px }
.myr-toggle-row { display: flex; align-items: center; justify-content: space-between }
.myr-toggle-row .myr-settings-label { margin: 0 }
.myr-toggle-row input { width: 22px; height: 22px; accent-color: #5a8bf5 }
.myr-select {
  min-height: 44px; border-radius: 8px; padding: 0 8px;
  border: 1px solid #3a3a3e; background: #232326; color: #eee; font-size: 13px;
}
.myr-file-label { position: relative; overflow: hidden; display: inline-flex; align-items: center }
.myr-file-label input {
  position: absolute; inset: 0; opacity: 0;
  width: 100%; height: 100%; cursor: pointer;
}

/* 点击区示意图（与 tap-zones 几何一致） */
.myr-zone-preview {
  width: 220px; aspect-ratio: 9 / 16; margin: 0 auto 8px;
  display: flex; flex-direction: column;
  border: 1px solid #3a3a3e; border-radius: 10px; overflow: hidden;
}
.myr-zone {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #ccc; background: #232327;
  border: 1px solid #2c2c30;
}
.myr-zone-top, .myr-zone-bottom { flex: 0 0 20%; width: 100% }
.myr-zone-mid { flex: 1; display: flex }
.myr-zone-left, .myr-zone-right { flex: 0 0 30%; height: 100%; writing-mode: vertical-rl }
.myr-zone-center { flex: 1; background: #2c3f78; color: #fff }

/* 加载 / Toast */
.myr-loading {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; gap: 14px;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .6);
}
.myr-spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 3px solid #444; border-top-color: #7c9bff;
  animation: myr-spin .9s linear infinite;
}
@keyframes myr-spin { to { transform: rotate(360deg) } }
.myr-loading-text { font-size: 14px; color: #ccc }
.myr-toast {
  position: absolute; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  background: rgba(20, 20, 22, .95); color: #eee;
  padding: 10px 18px; border-radius: 10px; font-size: 13px;
  z-index: 40; pointer-events: none; white-space: nowrap;
}

/* ---------- 下载面板 ---------- */
.myr-dl-scope-row { display: flex; gap: 8px; margin: 8px 0 }
.myr-dl-list {
  max-height: 34vh; overflow-y: auto; margin: 8px 0;
  display: flex; flex-direction: column; gap: 4px;
  border: 1px solid #2c2c30; border-radius: 10px; padding: 8px;
}
.myr-dl-chapter {
  display: flex; align-items: center; gap: 8px;
  min-height: 44px; font-size: 13px; color: #ddd;
}
.myr-dl-chapter input { width: 20px; height: 20px; accent-color: #5a8bf5 }
.myr-dl-chapter span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.myr-dl-progress { margin: 10px 0 }
.myr-dl-bar { height: 8px; border-radius: 4px; background: #2c2c30; overflow: hidden }
.myr-dl-bar > div { height: 100%; background: #2f6fed; transition: width .2s }
.myr-dl-meta { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px }
.myr-dl-fail-list { font-size: 12px; color: #e6a23c; max-height: 20vh; overflow-y: auto }
.myr-dl-status { font-size: 13px; margin: 6px 0 }

/* ---------- 悬浮入口（R-C1） ---------- */
.myr-entry {
  position: fixed; z-index: 2147483646;
  min-width: 52px; min-height: 52px; border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, .35);
  background: rgba(20, 20, 24, .82); color: #fff;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  padding: 0 14px; cursor: pointer; user-select: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .4);
  touch-action: none;
}
`;
  const BG_COLOR = {
    black: "#000",
    gray: "#3f3f46",
    white: "#fff",
    system: "auto"
  };
  function h(tag, attrs, ...children) {
    const el2 = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith("on") && typeof value === "function") {
          el2.addEventListener(key.slice(2), value);
        } else if (typeof value === "boolean") {
          if (value) el2.setAttribute(key, "");
        } else {
          el2.setAttribute(key, String(value));
        }
      }
    }
    for (const child of children) {
      if (child == null) continue;
      el2.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return el2;
  }
  class OverlayUI {
    #host;
    #shadow;
    #root;
    #modeRootEl;
    #toolbar;
    #toolbarVisible = false;
    #loading = null;
    #errorSheet = null;
    #catalogSheet = null;
    #settingsSheet = null;
    #chapterCard = null;
    #toastEl = null;
    #pageLabel;
    #pageSlider;
    #modeButtons = {};
    #cleanup = new Cleanup();
    #actions;
    #catalogAsc = true;
    #info = null;
    #currentChapterUrl = "";
    #externalSheets = /* @__PURE__ */ new Set();
    constructor(actions) {
      this.#actions = actions;
      this.#host = document.createElement("div");
      this.#host.id = "myr-overlay-host";
      this.#host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
      this.#shadow = this.#host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.#shadow.append(style);
      this.#root = h("div", { class: "myr-root myr-bg-black" });
      this.#modeRootEl = h("div", { class: "myr-mode-root" });
      this.#toolbar = this.#buildToolbar();
      this.#pageLabel = this.#toolbar.querySelector(".myr-page-label");
      this.#pageSlider = this.#toolbar.querySelector(".myr-page-slider");
      this.#root.append(this.#modeRootEl, this.#toolbar);
      this.#shadow.append(this.#root);
      this.#cleanup.addListener(this.#root, "pointerdown", (e) => e.stopPropagation());
      this.#cleanup.addListener(this.#root, "touchstart", (e) => e.stopPropagation(), { passive: true });
      this.#cleanup.addListener(this.#root, "touchmove", (e) => e.stopPropagation(), { passive: true });
      this.#cleanup.addListener(this.#root, "touchend", (e) => e.stopPropagation(), { passive: true });
      this.#cleanup.addListener(this.#root, "click", (e) => e.stopPropagation());
      this.#cleanup.addListener(this.#root, "wheel", (e) => e.stopPropagation());
    }
    get modeRoot() {
      return this.#modeRootEl;
    }
    /** 在 Shadow DOM 内查询（e2e/测试辅助）。 */
    queryAll(selector) {
      return [...this.#shadow.querySelectorAll(selector)];
    }
    open() {
      if (!this.#host.isConnected) document.documentElement.appendChild(this.#host);
      this.#root.classList.add("myr-open");
      this.setToolbarVisible(false);
      this.updatePageIndicator(1, 0);
    }
    close() {
      this.dismissTopPanel();
      this.#chapterCard?.remove();
      this.#chapterCard = null;
      this.#errorSheet?.remove();
      this.#errorSheet = null;
      this.#loading?.remove();
      this.#loading = null;
      this.#root.classList.remove("myr-open");
      this.#cleanup.run();
      this.#host.remove();
    }
    // ---------- 工具栏 ----------
    #buildToolbar() {
      const fullscreenSupported = typeof document.documentElement.requestFullscreen === "function" && document.fullscreenEnabled;
      const screenBtn = h(
        "button",
        { class: "myr-btn", type: "button" },
        fullscreenSupported ? "全屏" : "沉浸"
      );
      screenBtn.addEventListener("click", () => {
        if (fullscreenSupported) this.#actions.toggleFullscreen();
        else {
          this.setToolbarVisible(false);
          this.toast("沉浸模式：点击中央区域呼出菜单");
        }
      });
      const top = h(
        "div",
        { class: "myr-bar myr-bar-top" },
        h("button", { class: "myr-btn", type: "button", onclick: () => this.#actions.exit() }, "退出"),
        h("div", { class: "myr-title" }, "增强阅读"),
        screenBtn,
        h("button", { class: "myr-btn", type: "button", onclick: () => this.#openSettings() }, "设置")
      );
      const modeBtn = (kind, label) => {
        const btn2 = h("button", { class: "myr-btn myr-seg", type: "button", onclick: () => this.#actions.switchMode(kind) }, label);
        this.#modeButtons[kind] = btn2;
        return btn2;
      };
      const dirBtn = h("button", { class: "myr-btn", type: "button" }, "右→左");
      dirBtn.addEventListener("click", () => {
        const s = this.#actions.settings();
        const next = s.direction === "rtl" ? "ltr" : "rtl";
        this.#confirmInvertZones(next);
      });
      this.#modeButtons["dir"] = dirBtn;
      const bottom = h(
        "div",
        { class: "myr-bar myr-bar-bottom" },
        h(
          "div",
          { class: "myr-cluster", role: "group", "aria-label": "阅读模式" },
          modeBtn("vertical", "纵向"),
          modeBtn("horizontal", "横向"),
          modeBtn("single", "单页"),
          dirBtn
        ),
        h(
          "div",
          { class: "myr-cluster" },
          h("button", { class: "myr-btn", type: "button", onclick: () => this.#openCatalog() }, "目录"),
          h("button", { class: "myr-btn", type: "button", onclick: () => this.#actions.openDownload() }, "下载")
        ),
        h(
          "div",
          { class: "myr-slider-row" },
          h("span", { class: "myr-page-label" }, "0 / 0"),
          this.#makeSlider()
        )
      );
      return h("div", { class: "myr-toolbar" }, top, bottom);
    }
    #makeSlider() {
      const input = document.createElement("input");
      input.type = "range";
      input.className = "myr-page-slider";
      input.min = "1";
      input.max = "1";
      input.value = "1";
      input.addEventListener("input", () => {
        const page = Number(input.value);
        this.#pageLabel.textContent = `${page} / ${input.max}`;
      });
      input.addEventListener("change", () => {
        this.#actions.jumpToPage(Number(input.value) - 1);
      });
      return input;
    }
    /** R-S3/D4：切换方向时询问是否同时反转左右点击区，不静默修改。 */
    #confirmInvertZones(next) {
      const sheet = h(
        "div",
        { class: "myr-sheet-wrap" },
        h(
          "div",
          { class: "myr-sheet" },
          h("div", { class: "myr-sheet-title" }, `切换为${next === "rtl" ? "右→左" : "左→右"}`),
          h("div", { class: "myr-sheet-body" }, "是否同时反转左右点击区的动作？"),
          h(
            "div",
            { class: "myr-sheet-actions" },
            h("button", {
              class: "myr-btn myr-btn-primary",
              type: "button",
              onclick: () => {
                sheet.remove();
                this.#actions.switchDirection(next, true);
              }
            }, "是，反转"),
            h("button", {
              class: "myr-btn",
              type: "button",
              onclick: () => {
                sheet.remove();
                this.#actions.switchDirection(next, false);
              }
            }, "否，保持")
          )
        )
      );
      this.#root.append(sheet);
    }
    toggleToolbar() {
      this.setToolbarVisible(!this.#toolbarVisible);
    }
    setToolbarVisible(visible) {
      this.#toolbarVisible = visible;
      this.#toolbar.classList.toggle("myr-visible", visible);
    }
    // ---------- 状态展示 ----------
    setLoading(on, text = "加载中…") {
      if (!on) {
        this.#loading?.remove();
        this.#loading = null;
        return;
      }
      if (!this.#loading) {
        this.#loading = h("div", { class: "myr-loading" }, h("div", { class: "myr-spinner" }), h("div", { class: "myr-loading-text" }, text));
        this.#root.append(this.#loading);
      }
      const label = this.#loading.querySelector(".myr-loading-text");
      if (label) label.textContent = text;
    }
    showError(title, detail, actions) {
      this.#errorSheet?.remove();
      const buttons = actions.map(
        (a) => h("button", { class: "myr-btn myr-btn-primary", type: "button", onclick: () => {
          this.#errorSheet?.remove();
          this.#errorSheet = null;
          a.action();
        } }, a.label)
      );
      this.#errorSheet = h(
        "div",
        { class: "myr-sheet-wrap" },
        h(
          "div",
          { class: "myr-sheet" },
          h("div", { class: "myr-sheet-title" }, title),
          h("div", { class: "myr-sheet-body" }, detail),
          h("div", { class: "myr-sheet-actions" }, ...buttons)
        )
      );
      this.#root.append(this.#errorSheet);
    }
    updatePageIndicator(current, total) {
      this.#pageLabel.textContent = `${current} / ${total}`;
      this.#pageSlider.max = String(Math.max(1, total));
      this.#pageSlider.value = String(Math.max(1, Math.min(total, current)));
    }
    updateModeButtons(mode, direction) {
      for (const kind of ["vertical", "horizontal", "single"]) {
        this.#modeButtons[kind]?.classList.toggle("myr-seg-active", kind === mode);
      }
      const dirBtn = this.#modeButtons["dir"];
      if (dirBtn) dirBtn.textContent = direction === "rtl" ? "右→左" : "左→右";
    }
    updateCatalog(info) {
      this.#info = info;
      const title = this.#root.querySelector(".myr-title");
      if (title && info.title) title.textContent = info.title;
      if (this.#catalogSheet) this.#renderCatalogList();
    }
    setCurrentChapter(chapterUrl) {
      this.#currentChapterUrl = chapterUrl;
    }
    applyBackground(bg) {
      const color = BG_COLOR[bg];
      this.#root.classList.remove("myr-bg-black", "myr-bg-gray", "myr-bg-white", "myr-bg-system");
      this.#root.classList.add(`myr-bg-${bg}`);
      this.#root.style.removeProperty("background");
      if (color !== "auto") this.#root.style.background = color;
    }
    toast(text) {
      this.#toastEl?.remove();
      this.#toastEl = h("div", { class: "myr-toast" }, text);
      this.#root.append(this.#toastEl);
      setTimeout(() => {
        this.#toastEl?.remove();
        this.#toastEl = null;
      }, 2200);
    }
    // ---------- 面板 ----------
    dismissTopPanel() {
      let dismissed = false;
      if (this.#externalSheets.size > 0) {
        for (const el2 of [...this.#externalSheets]) this.closeSheet(el2);
        dismissed = true;
      }
      if (this.#errorSheet) {
        this.#errorSheet.remove();
        this.#errorSheet = null;
        dismissed = true;
      }
      if (this.#settingsSheet) {
        this.#settingsSheet.remove();
        this.#settingsSheet = null;
        dismissed = true;
      }
      if (this.#catalogSheet) {
        this.#catalogSheet.remove();
        this.#catalogSheet = null;
        dismissed = true;
      }
      if (this.#chapterCard) {
        this.#chapterCard.remove();
        this.#chapterCard = null;
        dismissed = true;
      }
      return dismissed;
    }
    /** 外部面板（如下载面板）挂载进 Shadow DOM（N-3 隔离）。 */
    openSheet(el2) {
      this.#externalSheets.add(el2);
      this.#root.append(el2);
    }
    closeSheet(el2) {
      this.#externalSheets.delete(el2);
      el2.remove();
    }
    showChapterCard(edge, chapter) {
      this.#chapterCard?.remove();
      if (!chapter) {
        this.toast(edge === "start" ? "已经是第一话" : "已经是最后一话");
        return;
      }
      const label = edge === "start" ? "上一话" : "下一话";
      this.#chapterCard = h(
        "div",
        { class: "myr-sheet-wrap myr-center" },
        h(
          "div",
          { class: "myr-sheet" },
          h("div", { class: "myr-sheet-title" }, label),
          h("div", { class: "myr-sheet-body" }, chapter.name),
          h(
            "div",
            { class: "myr-sheet-actions" },
            h("button", {
              class: "myr-btn myr-btn-primary",
              type: "button",
              onclick: () => {
                this.#chapterCard?.remove();
                this.#chapterCard = null;
                this.#actions.jumpToChapter(chapter);
              }
            }, `进入${label}`),
            h("button", {
              class: "myr-btn",
              type: "button",
              onclick: () => {
                this.#chapterCard?.remove();
                this.#chapterCard = null;
              }
            }, "留在本章")
          )
        )
      );
      this.#root.append(this.#chapterCard);
    }
    #openCatalog() {
      this.#catalogSheet?.remove();
      this.#catalogSheet = h(
        "div",
        { class: "myr-sheet-wrap myr-sheet-bottom" },
        h(
          "div",
          { class: "myr-sheet myr-sheet-tall" },
          h(
            "div",
            { class: "myr-sheet-head" },
            h("div", { class: "myr-sheet-title" }, this.#info?.title || "目录"),
            h("button", {
              class: "myr-btn myr-btn-small",
              type: "button",
              onclick: () => {
                this.#catalogAsc = !this.#catalogAsc;
                this.#renderCatalogList();
              }
            }, this.#catalogAsc ? "正序 ↓" : "倒序 ↑"),
            h("button", {
              class: "myr-btn myr-btn-small",
              type: "button",
              onclick: () => {
                this.#catalogSheet?.remove();
                this.#catalogSheet = null;
              }
            }, "关闭")
          ),
          h("div", { class: "myr-catalog-list" })
        )
      );
      this.#root.append(this.#catalogSheet);
      this.#renderCatalogList();
    }
    #renderCatalogList() {
      const list = this.#catalogSheet?.querySelector(".myr-catalog-list");
      if (!list || !this.#info) return;
      list.textContent = "";
      const chapters = this.#catalogAsc ? this.#info.chapters : [...this.#info.chapters].reverse();
      for (const chapter of chapters) {
        const current = chapter.url === this.#currentChapterUrl;
        const item = h("button", {
          class: `myr-catalog-item${current ? " myr-catalog-now" : ""}`,
          type: "button",
          onclick: () => {
            if (current) {
              this.#catalogSheet?.remove();
              this.#catalogSheet = null;
              return;
            }
            this.#actions.jumpToChapter(chapter);
          }
        }, chapter.name);
        list.append(item);
      }
      const now = list.querySelector(".myr-catalog-now");
      now?.scrollIntoView({ block: "center" });
    }
    // ---------- 设置 ----------
    #openSettings() {
      this.#settingsSheet?.remove();
      const s = this.#actions.settings();
      const sheet = h(
        "div",
        { class: "myr-sheet-wrap myr-sheet-bottom" },
        h(
          "div",
          { class: "myr-sheet myr-sheet-tall myr-settings" },
          h(
            "div",
            { class: "myr-sheet-head" },
            h("div", { class: "myr-sheet-title" }, "设置"),
            h("button", {
              class: "myr-btn myr-btn-small",
              type: "button",
              onclick: () => {
                this.#settingsSheet?.remove();
                this.#settingsSheet = null;
              }
            }, "关闭")
          ),
          h(
            "div",
            { class: "myr-sheet-body" },
            this.#settingsGroup("阅读宽度（纵向）", this.#widthControl(s)),
            this.#settingsGroup("横向适配", this.#horizontalFitControl(s)),
            this.#settingsGroup("页间留隙", this.#gapToggle(s)),
            this.#settingsGroup("单页适应", this.#fitControl(s)),
            this.#settingsGroup("点击区", this.#tapZoneControl(s)),
            this.#settingsGroup("背景", this.#bgControl(s)),
            this.#settingsGroup("预加载", this.#preloadControl(s)),
            this.#toggleRow("屏幕常亮", s.keepAwake, (on) => this.#actions.setKeepAwake(on)),
            this.#toggleRow("连续模式点击区", s.tapInContinuous, (on) => this.#actions.setTapInContinuous(on)),
            this.#toggleRow("进入阅读页自动打开", s.autoEnter, (on) => this.#actions.setAutoEnter(on)),
            this.#settingsGroup("设置导入导出", h(
              "div",
              { class: "myr-row" },
              h("button", {
                class: "myr-btn myr-btn-small",
                type: "button",
                onclick: () => {
                  const blob = new Blob([this.#actions.exportSettings()], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "mangayun-reader-settings.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }, "导出"),
              h(
                "label",
                { class: "myr-btn myr-btn-small myr-file-label" },
                "导入",
                (() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "application/json";
                  input.addEventListener("change", async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const result = this.#actions.importSettings(text);
                    this.toast(result.ok ? "导入成功" : `导入失败：${result.error ?? "未知错误"}`);
                    if (result.ok) {
                      this.#settingsSheet?.remove();
                      this.#settingsSheet = null;
                    }
                  });
                  return input;
                })()
              )
            ))
          )
        )
      );
      this.#settingsSheet = sheet;
      this.#root.append(sheet);
    }
    #settingsGroup(title, control) {
      return h("div", { class: "myr-settings-group" }, h("div", { class: "myr-settings-label" }, title), control);
    }
    #toggleRow(title, on, setter) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = on;
      input.addEventListener("change", () => setter(input.checked));
      return h(
        "div",
        { class: "myr-settings-group myr-toggle-row" },
        h("div", { class: "myr-settings-label" }, title),
        input
      );
    }
    #widthControl(s) {
      const value = h("span", { class: "myr-value" }, `${s.verticalWidth}%`);
      const input = document.createElement("input");
      input.type = "range";
      input.min = "50";
      input.max = "100";
      input.step = "5";
      input.value = String(s.verticalWidth);
      input.addEventListener("input", () => {
        value.textContent = `${input.value}%`;
      });
      input.addEventListener("change", () => this.#actions.setVerticalWidth(Number(input.value)));
      return h("div", { class: "myr-row" }, input, value);
    }
    /** 横向连续模式的页面适配（参考 Mihon Fit screen/height）。 */
    #horizontalFitControl(s) {
      const fits = [
        ["auto", "自动"],
        ["height", "适应高度"],
        ["screen", "适应屏幕"]
      ];
      const row = h("div", { class: "myr-row" });
      for (const [fit, label] of fits) {
        const btn2 = h("button", {
          class: `myr-btn myr-seg${s.horizontalFit === fit ? " myr-seg-active" : ""}`,
          type: "button",
          onclick: () => {
            this.#actions.setHorizontalFit(fit);
            for (const b of row.querySelectorAll(".myr-seg")) b.classList.remove("myr-seg-active");
            btn2.classList.add("myr-seg-active");
          }
        }, label);
        row.append(btn2);
      }
      return h(
        "div",
        {},
        row,
        h(
          "div",
          { class: "myr-settings-label", style: "font-size:11px;margin-top:4px" },
          "自动：竖屏整页可见、横屏按高度无缝"
        )
      );
    }
    /** 页间留隙开关（适应屏幕适配下 12px 空隙，可关为 0）。 */
    #gapToggle(s) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = s.horizontalGap !== false;
      input.addEventListener("change", () => this.#actions.setHorizontalGap(input.checked));
      const label = h(
        "label",
        { class: "myr-toggle-row" },
        h(
          "span",
          { class: "myr-settings-label" },
          "保留页与页之间的空隙（日漫跨页拼接场景请关闭，页面零间隙相接）"
        ),
        input
      );
      return label;
    }
    #fitControl(s) {
      const fits = [["screen", "适应屏幕"], ["width", "适应宽度"], ["height", "适应高度"], ["original", "原始大小"]];
      const row = h("div", { class: "myr-row" });
      for (const [fit, label] of fits) {
        const btn2 = h("button", {
          class: `myr-btn myr-seg${s.singleFit === fit ? " myr-seg-active" : ""}`,
          type: "button",
          onclick: () => {
            this.#actions.setSingleFit(fit);
            for (const b of row.querySelectorAll(".myr-seg")) b.classList.remove("myr-seg-active");
            btn2.classList.add("myr-seg-active");
          }
        }, label);
        row.append(btn2);
      }
      return row;
    }
    #bgControl(s) {
      const bgs = [["black", "黑"], ["gray", "深灰"], ["white", "白"], ["system", "跟随系统"]];
      const row = h("div", { class: "myr-row" });
      for (const [bg, label] of bgs) {
        const btn2 = h("button", {
          class: `myr-btn myr-seg${s.background === bg ? " myr-seg-active" : ""}`,
          type: "button",
          onclick: () => {
            this.#actions.setBackground(bg);
            for (const b of row.querySelectorAll(".myr-seg")) b.classList.remove("myr-seg-active");
            btn2.classList.add("myr-seg-active");
          }
        }, label);
        row.append(btn2);
      }
      return row;
    }
    #preloadControl(s) {
      const before = h("span", { class: "myr-value" }, String(s.preload.before));
      const after = h("span", { class: "myr-value" }, String(s.preload.after));
      const mk = (label, current, min, max, span, pick) => h(
        "div",
        { class: "myr-row" },
        h("span", { class: "myr-mini-label" }, label),
        h("button", { class: "myr-btn myr-btn-small", type: "button", onclick: () => {
          const v = Math.max(min, current - 1);
          span.textContent = String(v);
          pick(v);
        } }, "−"),
        span,
        h("button", { class: "myr-btn myr-btn-small", type: "button", onclick: () => {
          const v = Math.min(max, current + 1);
          span.textContent = String(v);
          pick(v);
        } }, "+")
      );
      const wrap = h(
        "div",
        {},
        mk("之前", s.preload.before, 0, 5, before, (v) => this.#actions.setPreload(v, Number(after.textContent))),
        mk("之后", s.preload.after, 1, 10, after, (v) => this.#actions.setPreload(Number(before.textContent), v))
      );
      return wrap;
    }
    /** 点击区编辑：四区选择 + 示意图 + 预设 + 恢复默认（R-S2、R-S4、R-S5）。 */
    #tapZoneControl(s) {
      const zones = { ...s.tapZones };
      const preview = h("div", { class: "myr-zone-preview" });
      const zoneNames = [["top", "上"], ["left", "左"], ["right", "右"], ["bottom", "下"]];
      const actionLabel = { prev: "上一页", next: "下一页", none: "无操作" };
      const renderPreview = () => {
        preview.textContent = "";
        const mk = (cls, label) => h("div", { class: `myr-zone myr-zone-${cls}` }, label);
        preview.append(
          mk("top", actionLabel[zones.top]),
          h(
            "div",
            { class: "myr-zone-mid" },
            mk("left", actionLabel[zones.left]),
            mk("center", "菜单"),
            mk("right", actionLabel[zones.right])
          ),
          mk("bottom", actionLabel[zones.bottom])
        );
      };
      const selects = h("div", { class: "myr-row myr-wrap" });
      for (const [zone, label] of zoneNames) {
        const select = document.createElement("select");
        select.className = "myr-select";
        for (const action of ["prev", "next", "none"]) {
          const opt = document.createElement("option");
          opt.value = action;
          opt.textContent = `${label}：${actionLabel[action]}`;
          if (zones[zone] === action) opt.selected = true;
          select.append(opt);
        }
        select.addEventListener("change", () => {
          zones[zone] = select.value;
          renderPreview();
          this.#actions.setTapZones({ ...zones });
        });
        selects.append(select);
      }
      const presetRow = h("div", { class: "myr-row myr-wrap" });
      for (const preset of Object.values(TAP_PRESETS)) {
        presetRow.append(h("button", {
          class: "myr-btn myr-btn-small",
          type: "button",
          onclick: () => {
            Object.assign(zones, preset.zones);
            renderPreview();
            this.#actions.setTapZones({ ...zones });
            for (const select of selects.querySelectorAll("select")) {
              const zone = select.dataset.zone;
              if (zone) select.value = zones[zone];
            }
          }
        }, preset.label));
      }
      selects.querySelectorAll("select").forEach((sel, i) => {
        sel.dataset.zone = zoneNames[i][0];
      });
      renderPreview();
      return h(
        "div",
        {},
        preview,
        selects,
        presetRow,
        h(
          "div",
          { class: "myr-row" },
          h("button", {
            class: "myr-btn myr-btn-small",
            type: "button",
            onclick: () => {
              Object.assign(zones, TAP_PRESETS.default.zones);
              renderPreview();
              this.#actions.setTapZones({ ...zones });
            }
          }, "恢复默认"),
          h("button", {
            class: "myr-btn myr-btn-small",
            type: "button",
            onclick: () => {
              this.#settingsSheet?.remove();
              this.#settingsSheet = null;
              this.toast("已应用，点击试用");
            }
          }, "立即试用")
        )
      );
    }
  }
  const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) {
      c = TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    }
    return (c ^ 4294967295) >>> 0;
  }
  class MemoryCapError extends Error {
    constructor(capBytes) {
      super(`内存模式达到 ${Math.round(capBytes / 1024 / 1024)} MiB 上限`);
      this.capBytes = capBytes;
      this.name = "MemoryCapError";
    }
  }
  class CacheUnavailableError extends Error {
    constructor(message) {
      super(message);
      this.name = "CacheUnavailableError";
    }
  }
  const MEMORY_MODE_CAP_MIB = 100;
  const CACHE_NAMESPACE = "myr-v1";
  class MemoryCache {
    kind = "memory";
    capBytes = MEMORY_MODE_CAP_MIB * 1024 * 1024;
    #map = /* @__PURE__ */ new Map();
    #bytes = 0;
    async init() {
    }
    async get(key) {
      return this.#map.get(key) ?? null;
    }
    async put(key, bytes) {
      const existing = this.#map.get(key);
      const incoming = existing ? bytes.length - existing.length : bytes.length;
      if (this.#bytes + incoming > this.capBytes) throw new MemoryCapError(this.capBytes);
      this.#map.set(key, { bytes, length: bytes.length, crc: crc32(bytes) });
      this.#bytes += incoming;
    }
    async remove(key) {
      const existing = this.#map.get(key);
      if (existing) {
        this.#bytes -= existing.length;
        this.#map.delete(key);
      }
    }
    async keys(prefix) {
      const all = [...this.#map.keys()];
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    }
    async clearTask(prefix) {
      for (const key of await this.keys(prefix)) await this.remove(key);
    }
    usedBytes() {
      return this.#bytes;
    }
  }
  class IdbCache {
    kind = "idb";
    capBytes = null;
    #db = null;
    #bytes = 0;
    async init() {
      this.#db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(`${CACHE_NAMESPACE}-images`, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new CacheUnavailableError("IndexedDB 打开失败"));
      });
      for (const rec of await this.#all()) this.#bytes += rec.length;
    }
    #tx(mode, fn) {
      const db = this.#db;
      if (!db) throw new CacheUnavailableError("IndexedDB 未初始化");
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", mode);
        const req = fn(tx.objectStore("images"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
      });
    }
    async #all() {
      const records = await this.#tx("readonly", (s) => s.getAll());
      return records ?? [];
    }
    async get(key) {
      const rec = await this.#tx("readonly", (s) => s.get(key));
      if (!rec) return null;
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      if (bytes.length !== rec.length || crc32(bytes) !== rec.crc) return null;
      return { bytes, length: rec.length, crc: rec.crc };
    }
    async put(key, bytes) {
      const rec = { blob: new Blob([bytes]), length: bytes.length, crc: crc32(bytes) };
      const existing = await this.#tx("readonly", (s) => s.get(key));
      if (existing) this.#bytes -= existing.length;
      this.#bytes += bytes.length;
      await this.#tx("readwrite", (s) => s.put(rec, key));
    }
    async remove(key) {
      const existing = await this.#tx("readonly", (s) => s.get(key));
      if (existing) this.#bytes -= existing.length;
      await this.#tx("readwrite", (s) => s.delete(key));
    }
    async keys(prefix) {
      const all = await this.#tx("readonly", (s) => s.getAllKeys());
      const keys = (all ?? []).filter((k) => typeof k === "string");
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    }
    async clearTask(prefix) {
      for (const key of await this.keys(prefix)) await this.remove(key);
    }
    usedBytes() {
      return this.#bytes;
    }
  }
  class OpfsCache {
    kind = "opfs";
    capBytes = null;
    #dir = null;
    #manifest = { entries: {} };
    async init() {
      const root = await navigator.storage.getDirectory();
      const ns = await root.getDirectoryHandle(CACHE_NAMESPACE, { create: true });
      this.#dir = await ns.getDirectoryHandle("images", { create: true });
      try {
        const handle = await this.#dir.getFileHandle("manifest.json");
        const text = await (await handle.getFile()).text();
        this.#manifest = JSON.parse(text);
        if (!this.#manifest.entries) this.#manifest = { entries: {} };
      } catch {
        this.#manifest = { entries: {} };
      }
    }
    fileName(key) {
      return encodeURIComponent(key).replace(/[.*+?%]/g, (c) => "%" + c.charCodeAt(0).toString(16));
    }
    async #saveManifest() {
      if (!this.#dir) throw new CacheUnavailableError("OPFS 未初始化");
      const handle = await this.#dir.getFileHandle("manifest.json", { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Blob([JSON.stringify(this.#manifest)]));
      await writable.close();
    }
    async get(key) {
      const entry = this.#manifest.entries[key];
      if (!entry || !this.#dir) return null;
      try {
        const handle = await this.#dir.getFileHandle(entry.file);
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== entry.length || crc32(bytes) !== entry.crc) return null;
        return { bytes, length: entry.length, crc: entry.crc };
      } catch {
        return null;
      }
    }
    async put(key, bytes) {
      if (!this.#dir) throw new CacheUnavailableError("OPFS 未初始化");
      const file = this.fileName(key);
      const handle = await this.#dir.getFileHandle(file, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      const crc = crc32(bytes);
      this.#manifest.entries[key] = { file, length: bytes.length, crc };
      await this.#saveManifest();
    }
    async remove(key) {
      const entry = this.#manifest.entries[key];
      if (!entry || !this.#dir) return;
      try {
        await this.#dir.removeEntry(entry.file);
      } catch {
      }
      delete this.#manifest.entries[key];
      await this.#saveManifest();
    }
    async keys(prefix) {
      const all = Object.keys(this.#manifest.entries);
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    }
    async clearTask(prefix) {
      for (const key of await this.keys(prefix)) await this.remove(key);
    }
    usedBytes() {
      return Object.values(this.#manifest.entries).reduce((s, e) => s + e.length, 0);
    }
  }
  async function openBestCache() {
    const opfs = new OpfsCache();
    try {
      await opfs.init();
      return opfs;
    } catch {
    }
    const idb = new IdbCache();
    try {
      await idb.init();
      return idb;
    } catch {
    }
    const memory = new MemoryCache();
    await memory.init();
    return memory;
  }
  function sniffImageType(bytes) {
    if (bytes.length < 12) return null;
    const b = bytes;
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { ext: "jpg", mime: "image/jpeg" };
    if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return { ext: "png", mime: "image/png" };
    if (b[0] === 71 && b[1] === 73 && b[2] === 70 && b[3] === 56 && (b[4] === 55 || b[4] === 57) && b[5] === 97) return { ext: "gif", mime: "image/gif" };
    if (b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) return { ext: "webp", mime: "image/webp" };
    if (b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand === "avif" || brand === "avis") return { ext: "avif", mime: "image/avif" };
    }
    return null;
  }
  class FetchFailure extends Error {
    kind;
    status;
    /** 429/503 时从 Retry-After 解析的等待毫秒数（R-D10）。 */
    retryAfterMs;
    constructor(kind, message, status, retryAfterMs) {
      super(message);
      this.name = "FetchFailure";
      this.kind = kind;
      this.status = status;
      this.retryAfterMs = retryAfterMs;
    }
  }
  function parseRetryAfter(value) {
    if (!value) return void 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1e3;
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    return void 0;
  }
  function classifyStatus(status) {
    if (status === 429) return "http-429";
    if (status === 503) return "http-503";
    if (status === 403) return "expired";
    if (status === 404) return "http-404";
    if (status >= 500) return "http-5xx";
    return "invalid";
  }
  function validateImageBytes(bytes, contentType, contentLength) {
    if (bytes.length === 0) throw new FetchFailure("expired", "空响应");
    if (contentLength != null && contentLength !== bytes.length) {
      throw new FetchFailure("network", `长度不一致：${bytes.length}/${contentLength}`);
    }
    const sniffed = sniffImageType(bytes);
    if (!sniffed) throw new FetchFailure("expired", "文件头不是受支持的图片格式");
    if (contentType && /text\/html/i.test(contentType)) {
      throw new FetchFailure("expired", "响应是 HTML");
    }
    return sniffed;
  }
  async function fromResponse(res) {
    if (!res.ok) {
      const retryAfter = res.status === 429 || res.status === 503 ? parseRetryAfter(res.headers.get("retry-after")) : void 0;
      throw new FetchFailure(classifyStatus(res.status), `HTTP ${res.status}`, res.status, retryAfter);
    }
    const contentType = res.headers.get("content-type");
    const contentLengthHeader = res.headers.get("content-length");
    const contentLength = contentLengthHeader != null ? Number(contentLengthHeader) : null;
    if (contentType && /text\/html/i.test(contentType)) {
      throw new FetchFailure("expired", "响应是 HTML");
    }
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const { ext, mime } = validateImageBytes(bytes, contentType, Number.isFinite(contentLength) ? contentLength : null);
    return { bytes, ext, mime };
  }
  async function fetchViaPage(url) {
    try {
      const res = await fetch(url, { referrerPolicy: "no-referrer", credentials: "same-origin" });
      return await fromResponse(res);
    } catch (e) {
      if (e instanceof FetchFailure) throw e;
      throw new FetchFailure("network", e instanceof Error ? e.message : String(e));
    }
  }
  function fetchViaGM(url) {
    return new Promise((resolve, reject) => {
      const gm = globalThis.GM_xmlhttpRequest;
      if (!gm) {
        reject(new FetchFailure("network", "GM_xmlhttpRequest 不可用"));
        return;
      }
      gm({
        method: "GET",
        url,
        anonymous: true,
        // 不带 Cookie
        responseType: "blob",
        timeout: 6e4,
        onload: async (res) => {
          if (res.status < 200 || res.status >= 300) {
            const headers = parseHeaders(res.responseHeaders);
            const retryAfter = res.status === 429 || res.status === 503 ? parseRetryAfter(headers.get("retry-after")) : void 0;
            reject(new FetchFailure(classifyStatus(res.status), `HTTP ${res.status}`, res.status, retryAfter));
            return;
          }
          try {
            const blob = res.response;
            const headers = parseHeaders(res.responseHeaders);
            const contentLengthHeader = headers.get("content-length");
            const contentLength = contentLengthHeader != null ? Number(contentLengthHeader) : null;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const { ext, mime } = validateImageBytes(bytes, headers.get("content-type"), Number.isFinite(contentLength) ? contentLength : null);
            resolve({ bytes, ext, mime });
          } catch (e) {
            reject(e instanceof FetchFailure ? e : new FetchFailure("network", String(e)));
          }
        },
        onerror: (err) => reject(new FetchFailure("network", err?.error ?? "GM 请求失败")),
        ontimeout: () => reject(new FetchFailure("network", "请求超时"))
      });
    });
  }
  function parseHeaders(raw) {
    const headers = new Headers();
    for (const line of raw.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    return headers;
  }
  async function fetchImage(url, isSameOrigin) {
    if (isSameOrigin(url)) {
      return fetchViaPage(url);
    }
    try {
      return await fetchViaPage(url);
    } catch (e) {
      if (e instanceof FetchFailure && (e.kind === "network" || e.kind === "http-5xx")) {
        return fetchViaGM(url);
      }
      throw e;
    }
  }
  const RETRY_DELAYS_MS = [1e3, 3e3];
  const JITTER_MAX_MS = 800;
  const MAX_ATTEMPTS = 3;
  const MAX_BACKOFF_MS = 6e4;
  const RECOVER_CONCURRENCY_MS = 6e4;
  class Scheduler {
    #concurrency;
    #hooks;
    #queue = [];
    #active = 0;
    #running = true;
    #cancelled = false;
    #generation = 0;
    #globalPauseUntil = 0;
    #pauseTimer = null;
    #recoverTimer = null;
    #rateLimitHits = 0;
    #effectiveConcurrency;
    constructor(concurrency = 2, hooks = {}) {
      this.#concurrency = Math.min(4, Math.max(1, Math.round(concurrency)));
      this.#effectiveConcurrency = this.#concurrency;
      this.#hooks = hooks;
    }
    get stats() {
      return { queued: this.#queue.length, active: this.#active, paused: !this.#running || Date.now() < this.#globalPauseUntil };
    }
    submit(job) {
      if (this.#cancelled) return Promise.resolve({ key: job.key, status: "cancelled", attempts: 0 });
      return new Promise((resolve) => {
        this.#queue.push({ job, attempts: 0, resolve, generation: this.#generation });
        this.#pull();
      });
    }
    #pull() {
      if (!this.#running || this.#cancelled) return;
      if (Date.now() < this.#globalPauseUntil) return;
      while (this.#active < this.#effectiveConcurrency && this.#queue.length > 0) {
        const entry = this.#queue.shift();
        this.#active++;
        void this.#attempt(entry);
      }
    }
    async #attempt(entry) {
      const { job } = entry;
      try {
        const result = await job.run();
        this.#active--;
        if (entry.generation !== this.#generation) {
          entry.resolve({ key: job.key, status: "cancelled", attempts: entry.attempts + 1 });
        } else {
          entry.resolve({ key: job.key, status: "done", attempts: entry.attempts + 1, result });
        }
        this.#pull();
        return;
      } catch (e) {
        this.#active--;
        const failure = e instanceof FetchFailure ? e : null;
        const kind = failure?.kind ?? "invalid";
        const message = e instanceof Error ? e.message : String(e);
        if (entry.generation !== this.#generation || this.#cancelled) {
          entry.resolve({ key: job.key, status: "cancelled", attempts: entry.attempts + 1 });
          this.#pull();
          return;
        }
        if (kind === "http-429" || kind === "http-503") {
          this.#rateLimit(failure);
          this.#queue.unshift(entry);
          return;
        }
        if (kind === "expired") {
          entry.resolve({
            key: job.key,
            status: "expired",
            attempts: entry.attempts + 1,
            error: { kind, message }
          });
          this.#pull();
          return;
        }
        const canRetry = failure != null && (kind === "network" || kind === "http-5xx" || kind === "http-404" || kind === "invalid") && entry.attempts + 1 < MAX_ATTEMPTS;
        if (canRetry) {
          entry.attempts++;
          const base = RETRY_DELAYS_MS[Math.min(entry.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 3e3;
          const delay = base + Math.random() * JITTER_MAX_MS;
          setTimeout(() => {
            if (this.#cancelled || entry.generation !== this.#generation) {
              entry.resolve({ key: job.key, status: "cancelled", attempts: entry.attempts });
              return;
            }
            this.#queue.push(entry);
            this.#pull();
          }, delay);
          return;
        }
        entry.resolve({
          key: job.key,
          status: "failed",
          attempts: entry.attempts + 1,
          error: { kind, message }
        });
        this.#pull();
      }
    }
    /** 429/503：全局暂停（R-D10）。 */
    #rateLimit(failure) {
      this.#rateLimitHits++;
      const retryAfter = failure?.retryAfterMs;
      let waitMs;
      if (retryAfter != null && retryAfter > 0) {
        waitMs = Math.min(MAX_BACKOFF_MS, retryAfter);
      } else {
        waitMs = Math.min(MAX_BACKOFF_MS, 1e3 * 2 ** this.#rateLimitHits);
      }
      const until = Date.now() + waitMs;
      if (until > this.#globalPauseUntil) {
        this.#globalPauseUntil = until;
        this.#hooks.onRateLimited?.(waitMs);
        if (this.#pauseTimer != null) clearTimeout(this.#pauseTimer);
        this.#pauseTimer = setTimeout(() => {
          this.#pauseTimer = null;
          this.#globalPauseUntil = 0;
          this.#effectiveConcurrency = 1;
          this.#hooks.onRateLimitRecovered?.();
          this.#pull();
          if (this.#recoverTimer != null) clearTimeout(this.#recoverTimer);
          this.#recoverTimer = setTimeout(() => {
            this.#recoverTimer = null;
            this.#effectiveConcurrency = this.#concurrency;
            this.#pull();
          }, RECOVER_CONCURRENCY_MS);
        }, waitMs);
      }
    }
    /** 用户暂停：立即停止发起新请求（R-D6）。 */
    pause() {
      this.#running = false;
      if (this.#pauseTimer != null) {
        clearTimeout(this.#pauseTimer);
        this.#pauseTimer = null;
        this.#globalPauseUntil = 0;
      }
    }
    resume() {
      if (this.#cancelled) return;
      this.#running = true;
      this.#pull();
    }
    /** 取消：丢弃队列，迟到的回调返回 cancelled。 */
    cancel() {
      this.#cancelled = true;
      this.#generation++;
      if (this.#pauseTimer != null) clearTimeout(this.#pauseTimer);
      if (this.#recoverTimer != null) clearTimeout(this.#recoverTimer);
      this.#pauseTimer = null;
      this.#globalPauseUntil = 0;
      const queue = this.#queue.splice(0);
      for (const entry of queue) {
        entry.resolve({ key: entry.job.key, status: "cancelled", attempts: entry.attempts });
      }
      this.#running = false;
    }
    isCancelled() {
      return this.#cancelled;
    }
  }
  function newTask(ref, title, chapters, storage) {
    const now = Date.now();
    return {
      id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      ref,
      title,
      state: "draft",
      chapters: chapters.map((chapter) => ({
        chapter,
        resolved: false,
        expectedPages: 0,
        pages: [],
        exts: [],
        failures: []
      })),
      storage
    };
  }
  function taskKey(id) {
    return `myr:v1:task:${id}`;
  }
  function saveTask(kv, task) {
    task.updatedAt = Date.now();
    kv.set(taskKey(task.id), task);
  }
  function loadTask(kv, id) {
    return kv.get(taskKey(id));
  }
  function listTasks(kv) {
    return kv.list().filter((k) => k.startsWith("myr:v1:task:")).map((k) => kv.get(k)).filter((t) => !!t).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  function resumableTasks(kv) {
    return listTasks(kv).filter(
      (t) => t.state === "resolving" || t.state === "downloading" || t.state === "paused" || t.state === "incomplete"
    );
  }
  function deleteTask(kv, id) {
    kv.delete(taskKey(id));
  }
  function taskStats(task) {
    let totalPages = 0;
    let cachedPages = 0;
    let failedPages = 0;
    for (const c of task.chapters) {
      totalPages += c.expectedPages;
      for (const s of c.pages) {
        if (s === "cached") cachedPages++;
        else if (s === "failed") failedPages++;
      }
    }
    return {
      totalPages,
      cachedPages,
      failedPages,
      pendingPages: Math.max(0, totalPages - cachedPages - failedPages),
      complete: totalPages > 0 && cachedPages === totalPages
    };
  }
  const SIG_LOCAL = 67324752;
  const SIG_CENTRAL = 33639248;
  const SIG_EOCD = 101010256;
  const SIG_EOCD64 = 101075792;
  const SIG_LOCATOR64 = 117853008;
  const FLAG_UTF8 = 2048;
  const U32_MAX = 4294967295;
  const U16_MAX = 65535;
  function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    const date = (year - 1980 << 9 | d.getMonth() + 1 << 5 | d.getDate()) & 65535;
    const time = (d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1) & 65535;
    return { time, date };
  }
  class StoreZipWriter {
    #sink;
    #records = [];
    #offset = 0;
    #closed = false;
    #createdAt = dosDateTime(/* @__PURE__ */ new Date());
    constructor(sink) {
      this.#sink = sink;
    }
    async add(name, data) {
      if (this.#closed) throw new Error("zip writer already closed");
      const nameBytes = new TextEncoder().encode(name);
      if (nameBytes.length > U16_MAX) throw new Error("entry name too long");
      const localOffset = this.#offset;
      const zip64 = data.length > U32_MAX || localOffset > U32_MAX;
      const crc = crc32(data);
      const header = new Uint8Array(30 + nameBytes.length + (zip64 ? 20 : 0));
      const view = new DataView(header.buffer);
      view.setUint32(0, SIG_LOCAL, true);
      view.setUint16(4, zip64 ? 45 : 20, true);
      view.setUint16(6, FLAG_UTF8, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, this.#createdAt.time, true);
      view.setUint16(12, this.#createdAt.date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, zip64 ? U32_MAX : data.length, true);
      view.setUint32(22, zip64 ? U32_MAX : data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, zip64 ? 20 : 0, true);
      header.set(nameBytes, 30);
      if (zip64) {
        const extra = 30 + nameBytes.length;
        view.setUint16(extra, 1, true);
        view.setUint16(extra + 2, 16, true);
        view.setUint32(extra + 4, data.length, true);
        view.setUint32(extra + 8, 0, true);
        view.setUint32(extra + 12, data.length, true);
        view.setUint32(extra + 16, 0, true);
      }
      await this.#sink.write(header);
      await this.#sink.write(data);
      this.#offset += header.length + data.length;
      this.#records.push({ nameBytes, crc, size: data.length, localOffset, zip64 });
    }
    async close() {
      if (this.#closed) return;
      this.#closed = true;
      const cdStart = this.#offset;
      for (const rec of this.#records) {
        const offsetNeeds64 = rec.localOffset > U32_MAX;
        const sizeNeeds64 = rec.size > U32_MAX;
        const extraLen = rec.zip64 ? (sizeNeeds64 ? 24 : 0) + (offsetNeeds64 ? 8 : 0) || 20 : 0;
        const buf = new Uint8Array(46 + rec.nameBytes.length + extraLen);
        const view = new DataView(buf.buffer);
        view.setUint32(0, SIG_CENTRAL, true);
        view.setUint16(4, rec.zip64 ? 45 : 20, true);
        view.setUint16(6, rec.zip64 ? 45 : 20, true);
        view.setUint16(8, FLAG_UTF8, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, this.#createdAt.time, true);
        view.setUint16(14, this.#createdAt.date, true);
        view.setUint32(16, rec.crc, true);
        view.setUint32(20, sizeNeeds64 ? U32_MAX : rec.size, true);
        view.setUint32(24, sizeNeeds64 ? U32_MAX : rec.size, true);
        view.setUint16(28, rec.nameBytes.length, true);
        view.setUint16(30, extraLen, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
        view.setUint32(42, offsetNeeds64 ? U32_MAX : rec.localOffset, true);
        buf.set(rec.nameBytes, 46);
        if (rec.zip64) {
          let p = 46 + rec.nameBytes.length;
          view.setUint16(p, 1, true);
          view.setUint16(p + 2, extraLen - 4, true);
          p += 4;
          if (sizeNeeds64) {
            view.setUint32(p, rec.size, true);
            view.setUint32(p + 4, 0, true);
            view.setUint32(p + 8, rec.size, true);
            view.setUint32(p + 12, 0, true);
            p += 16;
          }
          if (offsetNeeds64) {
            view.setUint32(p, rec.localOffset, true);
            view.setUint32(p + 4, 0, true);
          }
        }
        await this.#sink.write(buf);
      }
      const cdSize = this.#offset - cdStart;
      const needZip64Eocd = this.#records.length > U16_MAX || cdStart > U32_MAX || cdSize > U32_MAX;
      if (needZip64Eocd) {
        const zip64Offset = this.#offset;
        const eocd64 = new Uint8Array(56);
        const v64 = new DataView(eocd64.buffer);
        v64.setUint32(0, SIG_EOCD64, true);
        v64.setBigUint64(4, BigInt(44), true);
        v64.setUint16(12, 45, true);
        v64.setUint16(14, 45, true);
        v64.setUint32(16, 0, true);
        v64.setUint32(20, 0, true);
        v64.setBigUint64(24, BigInt(this.#records.length), true);
        v64.setBigUint64(32, BigInt(this.#records.length), true);
        v64.setBigUint64(40, BigInt(cdSize), true);
        v64.setBigUint64(48, BigInt(cdStart), true);
        await this.#sink.write(eocd64);
        const locator = new Uint8Array(20);
        const vl = new DataView(locator.buffer);
        vl.setUint32(0, SIG_LOCATOR64, true);
        vl.setUint32(4, 0, true);
        vl.setBigUint64(8, BigInt(zip64Offset), true);
        vl.setUint32(16, 1, true);
        await this.#sink.write(locator);
        this.#offset += 76;
      }
      const eocd = new Uint8Array(22);
      const ve = new DataView(eocd.buffer);
      ve.setUint32(0, SIG_EOCD, true);
      ve.setUint16(4, 0, true);
      ve.setUint16(6, 0, true);
      ve.setUint16(8, this.#records.length > U16_MAX ? U16_MAX : this.#records.length, true);
      ve.setUint16(10, this.#records.length > U16_MAX ? U16_MAX : this.#records.length, true);
      ve.setUint32(12, cdSize > U32_MAX ? U32_MAX : cdSize, true);
      ve.setUint32(16, cdStart > U32_MAX ? U32_MAX : cdStart, true);
      ve.setUint16(20, 0, true);
      await this.#sink.write(eocd);
      this.#offset += 22;
      await this.#sink.close?.();
    }
    get byteLength() {
      return this.#offset;
    }
    get entryCount() {
      return this.#records.length;
    }
  }
  const WINDOWS_RESERVED = /* @__PURE__ */ new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
    "CONIN$",
    "CONOUT$"
  ]);
  function padNumber(n, minDigits = 4) {
    if (!Number.isFinite(n) || n < 0) n = 0;
    const s = String(Math.floor(n));
    return s.length >= minDigits ? s : s.padStart(minDigits, "0");
  }
  function sanitizeName(name, maxLength = 80) {
    let s = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\]/g, " ").replace(/[<>:"|?*]/g, " ").replace(/\.{2,}/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").replace(/\s+/g, " ").trim();
    if (s.length > maxLength) s = s.slice(0, maxLength).replace(/[.\s]+$/, "").trim();
    if (!s) return "";
    const upper = s.toUpperCase();
    if (WINDOWS_RESERVED.has(upper)) return "";
    return s;
  }
  function chapterFolderName(order, chapterName) {
    const safe = sanitizeName(chapterName) || "unnamed";
    return `${padNumber(order)}_${safe}`;
  }
  function pageFileName(pageIndex, ext) {
    return `${padNumber(pageIndex)}.${ext}`;
  }
  function comicRootName(title) {
    return sanitizeName(title, 120) || "comic";
  }
  function partialSuffix(name) {
    return `${name}_partial`;
  }
  function buildReport(input) {
    const chapters = input.chapters.map((c) => {
      const missing = c.pages.filter((p) => p.ext == null).map((p) => ({ page: p.page + 1, reason: "fetch-failed", attempts: 3 }));
      return {
        folder: chapterFolderName(c.chapter.order, c.chapter.name),
        order: c.chapter.order,
        rawIndex: c.chapter.rawIndex,
        url: c.chapter.url,
        name: c.chapter.name,
        expectedPages: c.expectedPages,
        savedPages: c.pages.length - missing.length,
        missing
      };
    });
    const complete = chapters.every((c) => c.missing.length === 0);
    return {
      tool: "mangayun-reader",
      version: "1.0.0",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      site: { siteId: input.ref.siteId, verified: input.siteVerified },
      comic: { title: input.title, detailUrl: input.ref.detailUrl },
      result: complete ? "complete" : "partial",
      chapters
    };
  }
  function zipFileName(title, partial) {
    const base = `${comicRootName(title)}.zip`;
    return partial ? partialSuffix(base) : base;
  }
  async function packToSink(sink, input, loadBytes, keyOf) {
    const writer = new StoreZipWriter(sink);
    const root = comicRootName(input.title);
    for (const [ci, c] of input.chapters.entries()) {
      const folder = chapterFolderName(c.chapter.order, c.chapter.name);
      for (const page of c.pages) {
        if (page.ext == null) continue;
        const bytes = page.bytes ?? await loadBytes(keyOf(ci, page.page));
        if (!bytes) continue;
        await writer.add(`${root}/${folder}/${pageFileName(page.page, page.ext)}`, bytes);
      }
    }
    const report = buildReport(input);
    await writer.add(
      `${root}/download-report.json`,
      new TextEncoder().encode(JSON.stringify(report, null, 2))
    );
    await writer.close();
    return { byteLength: writer.byteLength, entryCount: writer.entryCount, report };
  }
  function opfsSink(writable) {
    return {
      async write(chunk) {
        await writable.write(chunk);
      },
      async close() {
        await writable.close();
      }
    };
  }
  class MemorySink {
    #chunks = [];
    #bytes = 0;
    async write(chunk) {
      this.#chunks.push(new Uint8Array(chunk));
      this.#bytes += chunk.length;
    }
    async close() {
    }
    get byteLength() {
      return this.#bytes;
    }
    toBlob() {
      return new Blob(this.#chunks, { type: "application/zip" });
    }
  }
  async function withTabLock(name, fn) {
    const locks = navigator.locks;
    if (!locks?.request) {
      const result = await fn();
      return { acquired: true, result };
    }
    let outcome = { acquired: false };
    await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      const result = await fn();
      outcome = { acquired: true, result };
    });
    return outcome;
  }
  const MAX_CHAPTER_RESOLVES = 3;
  class DownloadManager {
    #deps;
    #cache = null;
    #scheduler = null;
    #task = null;
    #abort = false;
    #userPaused = false;
    #speedWindow = [];
    #pack = null;
    #running = false;
    constructor(deps) {
      this.#deps = deps;
    }
    get task() {
      return this.#task;
    }
    get packHandle() {
      return this.#pack;
    }
    async ensureCache() {
      if (!this.#cache) this.#cache = await openBestCache();
      return this.#cache;
    }
    #emit(extra = {}) {
      const task = this.#task;
      if (!task) return;
      const stats = taskStats(task);
      const cache = this.#cache;
      const now = Date.now();
      this.#speedWindow = this.#speedWindow.filter((p) => now - p.at < 3e3);
      const bytes = this.#speedWindow.reduce((s, p) => s + p.bytes, 0);
      const current = task.chapters.find((c) => c.resolved && c.pages.includes("pending")) ?? task.chapters.find((c) => !c.resolved);
      this.#deps.onProgress({
        state: task.state,
        title: task.title,
        chapterCount: task.chapters.length,
        currentChapter: current?.chapter.name ?? null,
        totalPages: stats.totalPages,
        cachedPages: stats.cachedPages,
        failedPages: stats.failedPages,
        bytesPerSec: bytes / 3,
        storage: cache?.kind ?? task.storage,
        usedBytes: cache?.usedBytes() ?? 0,
        capBytes: cache?.capBytes ?? null,
        note: task.note ?? null,
        ...extra
      });
    }
    cacheKeyOf(taskId, chapterIndex, page) {
      return `${taskId}/${chapterIndex}/${page}`;
    }
    /** 建立并运行任务。返回任务 id。 */
    async start(comic, title, chapters) {
      const cache = await this.ensureCache();
      const task = newTask(comic, title, chapters, cache.kind);
      this.#task = task;
      this.#pack = null;
      this.#abort = false;
      this.#userPaused = false;
      saveTask(this.#deps.kv, task);
      void this.#run(task);
      return task.id;
    }
    /** 恢复任务（R-D13）：已缓存页跳过，其余重新解析后下载。 */
    async resume(taskId) {
      const cached = loadTask(this.#deps.kv, taskId);
      if (!cached) return false;
      const cache = await this.ensureCache();
      cached.storage = cache.kind;
      cached.state = "resolving";
      cached.note = null;
      for (const [ci, c] of cached.chapters.entries()) {
        for (let p = 0; p < c.pages.length; p++) {
          if (c.pages[p] === "cached") {
            const hit = await cache.get(this.cacheKeyOf(taskId, ci, p));
            if (!hit) c.pages[p] = "pending";
          }
        }
        c.failures = [];
      }
      this.#task = cached;
      this.#abort = false;
      this.#userPaused = false;
      saveTask(this.#deps.kv, cached);
      void this.#run(cached);
      return true;
    }
    async #run(task) {
      if (this.#running) return;
      this.#running = true;
      try {
        const outcome = await withTabLock(`myr:v1:lock:${task.id}`, async () => this.#runInner(task));
        if (!outcome.acquired) {
          task.state = "paused";
          task.note = "另一个标签页正在执行本任务";
          saveTask(this.#deps.kv, task);
          this.#emit();
        }
      } finally {
        this.#running = false;
      }
    }
    async #runInner(task) {
      const cache = await this.ensureCache();
      const concurrency = this.#deps.settings.get().download.concurrency;
      const scheduler = new Scheduler(concurrency, {
        onRateLimited: (waitMs) => {
          task.note = `限流，等待 ${Math.ceil(waitMs / 1e3)}s`;
          this.#emit();
        },
        onRateLimitRecovered: () => {
          task.note = null;
          this.#emit();
        }
      });
      this.#scheduler = scheduler;
      try {
        const resolvesCount = /* @__PURE__ */ new Map();
        for (const [ci, chapterState] of task.chapters.entries()) {
          if (this.#abort) break;
          while (!this.#userPaused && !this.#abort) {
            task.state = chapterState.resolved ? "downloading" : "resolving";
            this.#emit();
            saveTask(this.#deps.kv, task);
            let images;
            try {
              const list = await this.#deps.adapter.resolveChapter(task.ref, chapterState.chapter.url);
              images = list.images;
            } catch (e) {
              chapterState.failures.push({
                page: 0,
                reason: `章节解析失败：${e instanceof Error ? e.message : String(e)}`,
                attempts: 1
              });
              task.state = "incomplete";
              task.note = chapterState.failures[0]?.reason ?? null;
              saveTask(this.#deps.kv, task);
              this.#emit();
              return;
            }
            chapterState.expectedPages = images.length;
            if (chapterState.pages.length !== images.length) {
              chapterState.pages = images.map((_, i) => chapterState.pages[i] ?? "pending");
              chapterState.exts = images.map((_, i) => chapterState.exts[i] ?? null);
            }
            chapterState.resolved = true;
            const jobs = [];
            let expired = false;
            let capHit = false;
            for (let page = 0; page < images.length; page++) {
              if (chapterState.pages[page] === "cached") continue;
              const url = images[page];
              const key = this.cacheKeyOf(task.id, ci, page);
              jobs.push(
                scheduler.submit({
                  key,
                  run: async () => {
                    if (scheduler.isCancelled()) return;
                    const fetched = await fetchImage(
                      url,
                      (u) => isProxiedUrl(u, location.origin) || new URL(u, location.origin).origin === location.origin
                    );
                    try {
                      await cache.put(key, fetched.bytes);
                    } catch (e) {
                      if (e instanceof MemoryCapError) {
                        capHit = true;
                        throw e;
                      }
                      throw e;
                    }
                    this.#speedWindow.push({ at: Date.now(), bytes: fetched.bytes.length });
                    return fetched;
                  }
                }).then((outcome) => {
                  const p = Number(outcome.key.split("/")[2]);
                  if (outcome.status === "done") {
                    chapterState.pages[p] = "cached";
                    const fetched = outcome.result;
                    chapterState.exts[p] = fetched?.ext ?? null;
                  } else if (outcome.status === "expired") {
                    expired = true;
                    chapterState.pages[p] = "pending";
                  } else if (outcome.status === "failed") {
                    chapterState.pages[p] = "failed";
                    chapterState.failures.push({
                      page: p,
                      reason: outcome.error?.message ?? "下载失败",
                      attempts: outcome.attempts
                    });
                  }
                  this.#emit();
                  return outcome;
                })
              );
            }
            await Promise.all(jobs);
            if (capHit) throw new MemoryCapError(cache.capBytes ?? 100 * 1024 * 1024);
            if (this.#abort) break;
            if (this.#userPaused) break;
            saveTask(this.#deps.kv, task);
            if (expired) {
              const count = (resolvesCount.get(ci) ?? 1) + 1;
              resolvesCount.set(ci, count);
              if (count < MAX_CHAPTER_RESOLVES) {
                chapterState.resolved = false;
                continue;
              }
              for (let p = 0; p < chapterState.pages.length; p++) {
                if (chapterState.pages[p] === "pending") {
                  chapterState.pages[p] = "failed";
                  chapterState.failures.push({ page: p, reason: "地址过期且重解析无效", attempts: MAX_CHAPTER_RESOLVES });
                }
              }
            }
            break;
          }
          if (this.#userPaused) {
            task.state = "paused";
            saveTask(this.#deps.kv, task);
            this.#emit();
            return;
          }
        }
        if (this.#abort) {
          task.state = "cancelled";
          saveTask(this.#deps.kv, task);
          this.#emit();
          return;
        }
        const stats = taskStats(task);
        if (stats.failedPages > 0) {
          task.state = "incomplete";
          task.note = null;
          saveTask(this.#deps.kv, task);
          this.#emit();
          return;
        }
        await this.pack(false);
      } catch (e) {
        if (e instanceof MemoryCapError) {
          task.state = "paused";
          task.note = `已达到内存模式 ${Math.round(e.capBytes / 1024 / 1024)} MiB 上限，可导出部分结果或取消`;
          saveTask(this.#deps.kv, task);
          this.#emit();
          return;
        }
        task.state = "failed";
        task.note = e instanceof Error ? e.message : String(e);
        saveTask(this.#deps.kv, task);
        this.#emit();
      } finally {
        this.#scheduler = null;
      }
    }
    pause() {
      this.#userPaused = true;
      this.#scheduler?.pause();
      if (this.#task) {
        this.#task.state = "paused";
        saveTask(this.#deps.kv, this.#task);
        this.#emit();
      }
    }
    resumePaused() {
      this.#userPaused = false;
      this.#scheduler?.resume();
      if (this.#task) {
        const task = this.#task;
        task.note = null;
        saveTask(this.#deps.kv, task);
        if (!this.#running) void this.#run(task);
        this.#emit();
      }
    }
    cancel() {
      this.#abort = true;
      this.#userPaused = false;
      this.#scheduler?.cancel();
      if (this.#task) {
        this.#task.state = "cancelled";
        saveTask(this.#deps.kv, this.#task);
        this.#emit();
      }
    }
    /** 只重试失败项（R-D7）。 */
    async retryFailed() {
      const task = this.#task;
      if (!task) return;
      for (const c of task.chapters) {
        c.failures = [];
        for (let p = 0; p < c.pages.length; p++) {
          if (c.pages[p] === "failed") c.pages[p] = "pending";
        }
        c.resolved = false;
      }
      task.state = "resolving";
      task.note = null;
      saveTask(this.#deps.kv, task);
      this.#abort = false;
      this.#userPaused = false;
      if (!this.#running) void this.#run(task);
      this.#emit();
    }
    /** 打包（R-D5）。partial=true 时文件名加 _partial（R-D9）。 */
    async pack(partial) {
      const task = this.#task;
      if (!task) throw new Error("没有进行中的任务");
      const cache = await this.ensureCache();
      task.state = "packing";
      saveTask(this.#deps.kv, task);
      this.#emit();
      const input = {
        ref: task.ref,
        title: task.title,
        siteVerified: VERIFIED_SOURCES.has(task.ref.siteId),
        chapters: task.chapters.map((c) => ({
          chapter: c.chapter,
          expectedPages: c.expectedPages,
          pages: c.pages.map((status, page) => ({
            page,
            ext: status === "cached" ? c.exts[page] ?? "jpg" : null
          }))
        }))
      };
      const keyOf = (ci, page) => this.cacheKeyOf(task.id, ci, page);
      let handle;
      if (cache.kind === "opfs") {
        const root = await navigator.storage.getDirectory();
        const ns = await root.getDirectoryHandle("myr-v1", { create: true });
        const zips = await ns.getDirectoryHandle("zips", { create: true });
        const fileHandle = await zips.getFileHandle(`${task.id}.zip`, { create: true });
        const writable = await fileHandle.createWritable();
        const result = await packToSink(
          opfsSink(writable),
          input,
          (key) => cache.get(key).then((c) => c?.bytes ?? null),
          keyOf
        );
        handle = {
          taskId: task.id,
          fileName: zipFileName(task.title, partial),
          byteLength: result.byteLength,
          file: await fileHandle.getFile(),
          blob: null,
          report: result.report
        };
      } else {
        const sink = new MemorySink();
        const result = await packToSink(
          sink,
          input,
          (key) => cache.get(key).then((c) => c?.bytes ?? null),
          keyOf
        );
        handle = {
          taskId: task.id,
          fileName: zipFileName(task.title, partial),
          byteLength: result.byteLength,
          file: null,
          blob: sink.toBlob(),
          report: result.report
        };
      }
      task.state = "packed";
      task.zipName = handle.fileName;
      saveTask(this.#deps.kv, task);
      this.#pack = handle;
      this.#emit();
      this.#deps.onPacked(handle);
      return handle;
    }
    markHandedOff() {
      const task = this.#task;
      if (!task) return;
      task.state = "handed-off";
      saveTask(this.#deps.kv, task);
      this.#emit();
    }
    /** 清理任务缓存与元数据（取消后由用户选择，基线 §8.1）。 */
    async cleanup(keepZip = false) {
      const task = this.#task;
      const cache = this.#cache;
      if (task && cache) {
        await cache.clearTask(`${task.id}/`);
        if (cache.kind === "opfs") {
          try {
            const root = await navigator.storage.getDirectory();
            const ns = await root.getDirectoryHandle("myr-v1");
            const zips = await ns.getDirectoryHandle("zips");
            await zips.removeEntry(`${task.id}.zip`);
          } catch {
          }
        }
      }
      if (task && !keepZip) deleteTask(this.#deps.kv, task.id);
      this.#task = null;
      this.#pack = null;
    }
  }
  function getGmDownload() {
    const gm = globalThis.GM_download;
    return typeof gm === "function" ? gm : null;
  }
  function saveViaAnchor(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { status: "handed-off", detail: "已交给系统下载，请在通知栏/下载记录确认" };
  }
  async function saveZip(source, fileName) {
    const url = URL.createObjectURL(source);
    try {
      const gm = getGmDownload();
      if (gm) {
        return await new Promise((resolve) => {
          let settled = false;
          const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
          };
          try {
            gm({
              url,
              name: fileName,
              saveAs: false,
              onload: () => finish({ status: "saved", detail: "已保存" }),
              onerror: (err) => {
                const reason = err?.error ?? "";
                if (reason === "not_whitelisted" || reason === "not_enabled" || reason === "unknown_something") {
                  finish(saveViaAnchor(url, fileName));
                } else {
                  finish({ status: "failed", detail: `GM_download 失败：${reason || "未知错误"}` });
                }
              },
              ontimeout: () => finish({ status: "failed", detail: "GM_download 超时" })
            });
            setTimeout(() => finish({ status: "handed-off", detail: "已交给系统下载" }), 5e3);
          } catch {
            finish(saveViaAnchor(url, fileName));
          }
        });
      }
      return saveViaAnchor(url, fileName);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 6e4);
    }
  }
  function el(tag, cls, ...children) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const child of children) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return node;
  }
  function btn(label, primary, onClick) {
    const b = el("button", `myr-btn${primary ? " myr-btn-primary" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  const STATE_LABEL = {
    draft: "准备中",
    resolving: "解析章节",
    downloading: "下载中",
    paused: "已暂停",
    packing: "打包中",
    packed: "已打包",
    "handed-off": "已交给系统下载",
    incomplete: "未完成",
    cancelled: "已取消",
    failed: "失败"
  };
  class DownloadPanel {
    #deps;
    #sheet = null;
    constructor(deps) {
      this.#deps = deps;
    }
    open() {
      this.#sheet?.remove();
      const comic = this.#deps.getComic();
      if (!comic) {
        this.#deps.toast("请先进入漫画阅读页");
        return;
      }
      const support = this.#deps.adapter.supportOf(comic.ref.siteId);
      if (support !== "full") {
        this.#showBlocked(comic.ref.siteId);
        return;
      }
      const resumable = resumableTasks(this.#deps.kv);
      if (resumable.length > 0 && !this.#deps.manager.task) {
        this.#showResumePrompt(resumable[0]);
        return;
      }
      if (this.#deps.manager.task) {
        this.#showProgress();
        return;
      }
      this.#showScopeSelection(comic.ref, comic.info, comic.currentChapterUrl);
    }
    close() {
      if (this.#sheet) this.#deps.closeSheet(this.#sheet);
      this.#sheet = null;
    }
    #begin() {
      const sheet = el("div", "myr-sheet-wrap myr-sheet-bottom");
      const box = el("div", "myr-sheet myr-sheet-tall");
      sheet.append(box);
      this.#sheet = sheet;
      this.#deps.openSheet(sheet);
      return box;
    }
    #showBlocked(siteId) {
      const box = this.#begin();
      box.append(
        el("div", "myr-sheet-title", "此来源暂不支持下载"),
        el("div", "myr-sheet-body", `来源 ${siteId} 的图片经过前端打乱还原，原始字节无法直接打包（首版限制）。阅读不受影响。`),
        el("div", "myr-sheet-actions", btn("关闭", false, () => this.close()))
      );
    }
    #showResumePrompt(task) {
      const box = this.#begin();
      box.append(
        el("div", "myr-sheet-title", "发现未完成的任务"),
        el("div", "myr-sheet-body", `《${task.title}》（${STATE_LABEL[task.state] ?? task.state}）可以恢复：已下载的图片不会重复下载。`),
        el(
          "div",
          "myr-sheet-actions",
          btn("恢复任务", true, () => {
            this.close();
            void this.#deps.manager.resume(task.id).then((ok) => {
              if (ok) this.#showProgress();
              else this.#deps.toast("任务数据已失效");
            });
          }),
          btn("新建任务", false, () => {
            void this.#deps.manager.cleanup(true).then(() => {
              const comic = this.#deps.getComic();
              if (comic && this.#deps.adapter.supportOf(comic.ref.siteId) === "full") {
                this.#showScopeSelection(comic.ref, comic.info, comic.currentChapterUrl);
              }
            });
          })
        )
      );
    }
    #showScopeSelection(ref, info, currentChapterUrl) {
      const box = this.#begin();
      const chapters = info?.chapters ?? [];
      const current = chapters.find((c) => c.url === currentChapterUrl) ?? null;
      let scope = "current";
      const selected = new Set(current ? [current.url] : []);
      box.append(el("div", "myr-sheet-title", "下载"));
      if (chapters.length === 0) {
        box.append(el("div", "myr-sheet-body", "目录尚未加载完成，请稍后再试或先打开目录。"));
        box.append(el("div", "myr-sheet-actions", btn("关闭", false, () => this.close())));
        return;
      }
      const scopeRow = el("div", "myr-dl-scope-row");
      const scopeBtns = {
        current: btn("当前话", false, () => pick("current")),
        select: btn("多话勾选", false, () => pick("select")),
        all: btn("整部", false, () => pick("all"))
      };
      const list = el("div", "myr-dl-list");
      list.style.display = "none";
      for (const chapter of [...chapters].reverse()) {
        const row = el("label", "myr-dl-chapter");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(chapter.url);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(chapter.url);
          else selected.delete(chapter.url);
          updateConfirm();
        });
        row.append(checkbox, el("span", void 0, chapter.name));
        list.append(row);
      }
      const pick = (next) => {
        scope = next;
        for (const [key, b] of Object.entries(scopeBtns)) b.classList.toggle("myr-seg-active", key === scope);
        list.style.display = scope === "select" ? "block" : "none";
        updateConfirm();
      };
      for (const b of Object.values(scopeBtns)) scopeRow.append(b);
      const storageLine = el("div", "myr-dl-status", "正在检测存储能力…");
      void this.#deps.manager.ensureCache().then(async (cache) => {
        let quota = "";
        try {
          const est = await navigator.storage?.estimate?.();
          if (est?.quota) quota += `，站点配额约 ${formatBytes(est.quota)}`;
        } catch {
        }
        const cap = cache.capBytes ? `（上限 ${Math.round(cache.capBytes / 1024 / 1024)} MiB）` : "";
        const verified = this.#deps.adapter.supportOf(ref.siteId) === "full";
        storageLine.textContent = `来源：${ref.siteId} · 存储：${cache.kind.toUpperCase()}${cap}，已用 ${formatBytes(cache.usedBytes())}${quota}` + (verified ? "" : "（未验证来源，报告中会标注）");
      }).catch(() => {
        storageLine.textContent = "存储能力检测失败，任务可能无法建立";
      });
      box.append(scopeRow, storageLine, list);
      const confirmBox = el("div", "myr-dl-status");
      const actions = el("div", "myr-sheet-actions");
      const startBtn = btn("确认下载", true, () => this.#start(ref, info, scope, selected, chapters));
      const closeBtn = btn("关闭", false, () => this.close());
      actions.append(startBtn, closeBtn);
      box.append(confirmBox, actions);
      const updateConfirm = () => {
        const count = scope === "all" ? chapters.length : scope === "current" ? current ? 1 : 0 : selected.size;
        confirmBox.textContent = scope === "all" ? `将下载整部 ${chapters.length} 话（来源 ${ref.siteId}）` : scope === "current" ? `将下载当前话${current ? `：${current.name}` : ""}（来源 ${ref.siteId}）` : `已选 ${count} 话（来源 ${ref.siteId}）`;
        startBtn.disabled = count === 0;
      };
      pick("current");
    }
    async #start(ref, info, scope, selected, chapters) {
      let targets;
      if (scope === "all") targets = chapters;
      else if (scope === "select") targets = chapters.filter((c) => selected.has(c.url));
      else targets = chapters.filter((c) => selected.size <= 1 ? selected.has(c.url) : false);
      if (targets.length === 0) {
        const current = chapters.find((c) => selected.has(c.url));
        targets = current ? [current] : [];
      }
      if (targets.length === 0) {
        this.#deps.toast("没有可下载的章节");
        return;
      }
      targets = [...targets].sort((a, b) => a.order - b.order);
      this.close();
      await this.#deps.manager.ensureCache();
      await this.#deps.manager.start(ref, info?.title ?? "comic", targets);
      this.#showProgress();
    }
    #showProgress() {
      this.#sheet?.remove();
      const box = this.#begin();
      const title = el("div", "myr-sheet-title", "下载");
      const status = el("div", "myr-dl-status");
      const barOuter = el("div", "myr-dl-bar");
      const barInner = el("div");
      barOuter.append(barInner);
      const meta = el("div", "myr-dl-meta");
      const failList = el("div", "myr-dl-fail-list");
      failList.style.display = "none";
      const actions = el("div", "myr-sheet-actions");
      const closeBtn = btn("关闭", false, () => this.close());
      actions.append(closeBtn);
      box.append(title, status, barOuter, meta, failList, actions);
      const render = (p) => {
        title.textContent = `下载《${p.title}》`;
        const total = Math.max(1, p.totalPages);
        barInner.style.width = `${Math.round(p.cachedPages / total * 100)}%`;
        status.textContent = `${STATE_LABEL[p.state] ?? p.state}${p.note ? `：${p.note}` : ""}`;
        meta.textContent = `${p.cachedPages + p.failedPages}/${p.totalPages} 页 · 失败 ${p.failedPages} · ${formatBytes(p.bytesPerSec)}/s · ${p.currentChapter ?? ""}`;
        meta.title = `存储：${p.storage.toUpperCase()}${p.capBytes ? `（上限 ${Math.round(p.capBytes / 1024 / 1024)} MiB）` : ""}，已用 ${formatBytes(p.usedBytes)}`;
        for (const b of [...actions.querySelectorAll("button")]) {
          if (b !== closeBtn) b.remove();
        }
        const insert = (...bs) => {
          for (const b of bs) actions.insertBefore(b, closeBtn);
        };
        if (p.state === "downloading" || p.state === "resolving") {
          insert(btn("暂停", false, () => this.#deps.manager.pause()));
        } else if (p.state === "paused") {
          insert(
            btn("继续", true, () => this.#deps.manager.resumePaused()),
            btn("取消", false, () => void this.onCancelChoice())
          );
        } else if (p.state === "incomplete") {
          const failed = p.failedPages > 0;
          failList.style.display = failed ? "block" : "none";
          if (failed) failList.textContent = `失败 ${p.failedPages} 页；可选择“只重试失败项”，或导出已有部分（文件名加 _partial）`;
          insert(
            btn("只重试失败项", true, () => void this.#deps.manager.retryFailed()),
            btn("导出部分结果", false, () => void this.#deps.manager.pack(true).then(() => this.#showSave())),
            btn("取消任务", false, () => void this.onCancelChoice())
          );
        } else if (p.state === "packed") {
          insert(btn("保存 ZIP", true, () => this.#showSave()));
        }
      };
      const current = this.#deps.manager.task;
      if (current) {
        render(this.#lastProgress ?? {
          state: current.state,
          title: current.title,
          chapterCount: current.chapters.length,
          currentChapter: null,
          totalPages: 0,
          cachedPages: 0,
          failedPages: 0,
          bytesPerSec: 0,
          storage: current.storage,
          usedBytes: 0,
          capBytes: null,
          note: current.note ?? null
        });
      }
      this.#progressListener = render;
    }
    #lastProgress = null;
    #progressListener = null;
    /** 由 main 转发 manager 的进度回调。 */
    onProgress(p) {
      this.#lastProgress = p;
      this.#progressListener?.(p);
    }
    onPacked(handle) {
      if (this.#sheet && this.#lastProgress?.state !== "incomplete") this.#showSave(handle);
    }
    onCancelChoice() {
      const box = this.#begin();
      box.append(
        el("div", "myr-sheet-title", "取消下载？"),
        el("div", "myr-sheet-body", "取消后已下载的缓存可以保留（下次可恢复），或立即清理。"),
        el(
          "div",
          "myr-sheet-actions",
          btn("取消并保留缓存", true, () => {
            this.#deps.manager.cancel();
            this.close();
          }),
          btn("取消并清理缓存", false, () => {
            this.#deps.manager.cancel();
            void this.#deps.manager.cleanup();
            this.close();
          }),
          btn("返回", false, () => this.close())
        )
      );
    }
    #showSave(handle) {
      const pack = handle ?? this.#deps.manager.packHandle;
      if (!pack) return;
      this.#sheet?.remove();
      const box = this.#begin();
      const status = el("div", "myr-dl-status", `ZIP 已生成（${formatBytes(pack.byteLength)}，${pack.report.result === "partial" ? "部分结果" : "完整"}）`);
      const resultLine = el("div", "myr-dl-status", "等待保存…");
      box.append(
        el("div", "myr-sheet-title", "保存"),
        status,
        el("div", "myr-dl-meta", `文件名：${pack.fileName}`),
        resultLine,
        el(
          "div",
          "myr-sheet-actions",
          btn("保存 ZIP", true, async () => {
            const source = pack.file ?? pack.blob;
            const result = await saveZip(source, pack.fileName);
            resultLine.textContent = result.status === "saved" ? "已保存" : result.status === "handed-off" ? "已交给系统下载，请在系统下载记录确认" : `保存失败：${result.detail ?? ""}`;
            if (result.status !== "failed") this.#deps.manager.markHandedOff();
          }),
          btn("重新打包", false, () => void this.#deps.manager.pack(pack.report.result === "partial").then(() => this.#showSave())),
          btn("清理任务", false, () => {
            void this.#deps.manager.cleanup();
            this.close();
          })
        )
      );
    }
  }
  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function createReaderApp(deps) {
    const kv = deps.kv ?? createKV();
    const settingsStore = new SettingsStore(kv);
    const progress = new ProgressStore(kv);
    const controller = new ReaderController({ adapter: deps.adapter, settingsStore, progress });
    const actions = {
      exit: () => controller.exit(),
      switchMode: (kind) => controller.switchMode(kind),
      switchDirection: (direction, invert) => {
        if (invert) {
          const s = settingsStore.get();
          settingsStore.update({ tapZones: invertHorizontalZones(s.tapZones) });
        }
        controller.switchDirection(direction);
      },
      setVerticalWidth: (width) => {
        if (controller.comic) progress.setOverrides(controller.comic, { verticalWidth: width });
        controller.applySettingChanges();
      },
      setHorizontalFit: (fit) => {
        settingsStore.update({ horizontalFit: fit });
        controller.applySettingChanges();
      },
      setHorizontalGap: (on) => {
        settingsStore.update({ horizontalGap: on });
        controller.applySettingChanges();
      },
      setSingleFit: (fit) => {
        if (controller.comic) progress.setOverrides(controller.comic, { singleFit: fit });
        controller.applySettingChanges();
      },
      setTapZones: (zones) => {
        settingsStore.update({ tapZones: zones });
      },
      setBackground: (bg) => {
        settingsStore.update({ background: bg });
        controller.applySettingChanges();
      },
      setPreload: (before, after) => {
        settingsStore.update({ preload: { before, after } });
        controller.applySettingChanges();
      },
      setKeepAwake: (on) => {
        settingsStore.update({ keepAwake: on });
        if (on) void controller.requestWakeLock();
      },
      setAutoEnter: (on) => {
        settingsStore.update({ autoEnter: on });
      },
      setTapInContinuous: (on) => {
        settingsStore.update({ tapInContinuous: on });
        controller.applySettingChanges();
      },
      jumpToPage: (page) => controller.jumpToPage(page),
      jumpToChapter: (chapter) => controller.navigateToChapter(chapter),
      neighborChapter: (delta) => {
        const chapters = controller.info?.chapters ?? [];
        const idx = chapters.findIndex((c) => c.url === controller.currentChapterUrl);
        return chapters[idx + delta] ?? null;
      },
      toggleFullscreen: () => void controller.toggleFullscreen(),
      openDownload: () => panel.open(),
      exportSettings: () => exportData(kv),
      importSettings: (json) => importData(kv, json),
      settings: () => settingsStore.effective(controller.comic)
    };
    const ui = new OverlayUI(actions);
    controller.attachUI(ui);
    const manager = new DownloadManager({
      adapter: deps.adapter,
      settings: settingsStore,
      kv,
      onProgress: (p) => {
        panel.onProgress(p);
        if (p.state === "downloading" || p.state === "resolving" || p.state === "packing") {
          void controller.requestWakeLock();
        }
      },
      onPacked: (handle) => panel.onPacked(handle)
    });
    const panel = new DownloadPanel({
      manager,
      adapter: deps.adapter,
      kv,
      getComic: () => {
        const comic = controller.comic;
        if (!comic) return null;
        return { ref: comic, info: controller.info, currentChapterUrl: controller.currentChapterUrl };
      },
      toast: (text) => ui.toast(text),
      openSheet: (el2) => ui.openSheet(el2),
      closeSheet: (el2) => ui.closeSheet(el2)
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (!controller.active) return;
        if (controller.handleKey(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true }
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") progress.flush();
      else void controller.requestWakeLock();
    });
    window.addEventListener("pagehide", () => progress.flush());
    return { controller, ui, manager, panel, settingsStore, progress, kv };
  }
  const DRAG_THRESHOLD_PX = 12;
  const EDGE = 8;
  class FloatingEntry {
    #host;
    #btn;
    #opts;
    constructor(opts) {
      this.#opts = opts;
      this.#host = document.createElement("div");
      this.#host.style.cssText = "position:fixed;z-index:2147483646;";
      const shadow = this.#host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLES;
      shadow.append(style);
      this.#btn = document.createElement("button");
      this.#btn.className = "myr-entry";
      this.#btn.type = "button";
      this.#btn.textContent = "增强\n阅读";
      this.#btn.style.whiteSpace = "pre";
      shadow.append(this.#btn);
      let start = null;
      let dragged = false;
      this.#btn.addEventListener("pointerdown", (e) => {
        start = { x: e.clientX, y: e.clientY, left: this.#host.offsetLeft, top: this.#host.offsetTop };
        dragged = false;
        this.#btn.setPointerCapture(e.pointerId);
        e.stopPropagation();
      });
      this.#btn.addEventListener("pointermove", (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragged = true;
        if (dragged) this.#place(start.left + dx, start.top + dy);
        e.stopPropagation();
      });
      this.#btn.addEventListener("pointerup", (e) => {
        if (start && dragged) {
          this.#opts.savePosition(this.#normalize());
        } else if (start) {
          this.#opts.onTap();
        }
        start = null;
        e.stopPropagation();
      });
      this.#btn.addEventListener("pointercancel", () => {
        start = null;
      });
      this.#btn.addEventListener("click", (e) => e.stopPropagation());
      const saved = this.#opts.loadPosition();
      this.#place(saved?.x ?? window.innerWidth - 110, saved?.y ?? window.innerHeight * 0.55);
    }
    #place(x, y) {
      const w = this.#btn.offsetWidth || 88;
      const h2 = this.#btn.offsetHeight || 52;
      const left = Math.min(window.innerWidth - w - EDGE, Math.max(EDGE, x));
      const top = Math.min(window.innerHeight - h2 - EDGE, Math.max(EDGE, y));
      this.#host.style.left = `${Math.round(left)}px`;
      this.#host.style.top = `${Math.round(top)}px`;
    }
    #normalize() {
      return { x: this.#host.offsetLeft, y: this.#host.offsetTop };
    }
    show() {
      if (!this.#host.isConnected) document.documentElement.appendChild(this.#host);
    }
    hide() {
      this.#host.remove();
    }
  }
  const g = globalThis;
  if (typeof window !== "undefined" && isResolveIframe(window.name)) {
    const parentToken = resolveIframeToken(window.name);
    const bus = new CaptureBus();
    bus.start();
    if (parentToken) {
      bus.on((event) => {
        try {
          if (window.parent === window) return;
          window.parent.postMessage(
            { source: RESOLVE_FORWARD_SOURCE, token: parentToken, event },
            location.origin
          );
        } catch {
        }
      });
    }
  } else if (!g.__myrInitialized) {
    let main = function() {
      const kv = createKV();
      migrateStorage(kv);
      const bus = new CaptureBus();
      bus.start();
      const adapter = createMangayunAdapter(bus);
      const app = createReaderApp({ adapter, kv });
      const { controller, ui, settingsStore } = app;
      const entry = new FloatingEntry({
        onTap: () => {
          const route = adapter.currentReadRoute();
          if (route) void controller.enter(route);
        },
        loadPosition: () => settingsStore.get().floatPos,
        savePosition: (pos) => settingsStore.update({ floatPos: pos })
      });
      function syncRoute() {
        const route = adapter.currentReadRoute();
        if (route && !controller.active) {
          entry.show();
          ui.setCurrentChapter(route.chapterUrl);
          const settings = settingsStore.effective(route.comic);
          if (settings.autoEnter) void controller.enter(route);
        } else if (!route) {
          entry.hide();
          if (controller.active) controller.exit();
        }
      }
      let returning = false;
      try {
        returning = sessionStorage.getItem(RETURN_FLAG) === "1";
        if (returning) sessionStorage.removeItem(RETURN_FLAG);
      } catch {
        returning = false;
      }
      const wrapHistory = (name) => {
        const orig = history[name].bind(history);
        history[name] = function(...args) {
          const result = orig(...args);
          setTimeout(syncRoute, 0);
          return result;
        };
      };
      wrapHistory("pushState");
      wrapHistory("replaceState");
      window.addEventListener("popstate", () => setTimeout(syncRoute, 0));
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(onReady, 300));
      } else {
        setTimeout(onReady, 300);
      }
      function onReady() {
        syncRoute();
        if (returning) {
          const route = adapter.currentReadRoute();
          if (route) void controller.enter(route);
        }
      }
    };
    g.__myrInitialized = true;
    main();
  }

})();