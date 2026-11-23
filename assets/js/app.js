/* ==========================================================================
   شاشة مواقيت جامع الشيخ عبد الكريم الرفاعي — دمشق
   الساعة، المواقيت، شاشات الأذان والإقامة، تدوير الإعلانات، والإعدادات.
   البيانات من جدول الجامع في assets/js/data.js بتوقيت دمشق.
   ========================================================================== */

(function () {
  'use strict';

  const PRAYERS = [
    { key: 'fajr',    name: 'الفجر',   hasIqama: true },
    { key: 'shuruq',  name: 'الشروق',  hasIqama: false },
    { key: 'dhuhr',   name: 'الظهر',   hasIqama: true },
    { key: 'asr',     name: 'العصر',   hasIqama: true },
    { key: 'maghrib', name: 'المغرب',  hasIqama: true },
    { key: 'isha',    name: 'العشاء',  hasIqama: true },
  ];

  const IQ_LABELS = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

  const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى',
    'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  const GREG_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
    'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  const DEFAULTS = {
    hour24: false,
    showSuffix: true,
    hijriOffset: 0,
    iqama: { fajr: 20, dhuhr: 20, asr: 20, maghrib: 10, isha: 10 },
    jumuah: '',
    adsMode: 'mixed',   // mixed | main | ads
    mainSec: 30,
    adSec: 20,
  };

  const TIME_ZONE = 'Asia/Damascus';
  const STORAGE_KEY = 'rifa3i.prayer.settings.v1';
  const TABLE = window.PRAYER_TIMES;
  const AD_PREVIEW_MS = 20000;

  const state = load();
  const $ = (id) => document.getElementById(id);

  let sheetOpen = false;
  let preview = null;
  let previewTimer = 0;
  let adPreview = null;
  let currentView = 'board';
  let currentAdId = null;
  let washFront = 0;
  let washToken = 0;
  let swapTimer = 0;
  let lastSlideKey = '';
  let lastVeilKey = '';
  let lastSecond = -1;
  let lastRowsSig = '';
  let lastAdRowsSig = '';
  let rowsSettled = false;

  const ads = [];
  const adUrls = new Map();
  const rot = { anchor: Date.now() };

  /* ---------------------------------------------------------------- إعدادات */

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* تجاهل */ }
    const merged = {
      ...DEFAULTS,
      ...(saved || {}),
      iqama: { ...DEFAULTS.iqama, ...((saved && saved.iqama) || {}) },
    };
    if (!['mixed', 'main', 'ads'].includes(merged.adsMode)) merged.adsMode = DEFAULTS.adsMode;
    merged.mainSec = clampNumber(merged.mainSec, 5, 600, DEFAULTS.mainSec);
    merged.adSec = clampNumber(merged.adSec, 5, 600, DEFAULTS.adSec);
    return merged;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* تجاهل */ }
  }

  /* ------------------------------------------------------------------ أدوات */

  const d2 = (n) => String(n).padStart(2, '0');

  const minutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  function nowInZone() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date());
    const o = {};
    for (const p of parts) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
  }

  const dayKey = (y, m, d) => d2(m) + '-' + d2(d);
  const isoKey = (y, m, d) => y + '-' + d2(m) + '-' + d2(d);
  const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();

  function addDay(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  function hijri(y, m, d) {
    const base = new Date(Date.UTC(y, m - 1, d, 12));
    base.setUTCDate(base.getUTCDate() + state.hijriOffset);
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric',
    }).formatToParts(base);
    const o = {};
    for (const p of parts) o[p.type] = p.value;
    return { d: +o.day, m: +o.month, y: +o.year };
  }

  function timeDigits(mins) {
    const t = ((Math.round(mins) % 1440) + 1440) % 1440;
    const h = Math.floor(t / 60);
    const mi = t % 60;
    if (state.hour24) return d2(h) + ':' + d2(mi);
    return d2(h % 12 === 0 ? 12 : h % 12) + ':' + d2(mi);
  }

  function timeHTML(mins) {
    const suffix = (state.hour24 || !state.showSuffix) ? '' : suffixOf(mins);
    return '<span class="time-digits">' + timeDigits(mins) + '</span>' +
      (suffix ? '<span class="time-suffix">' + suffix + '</span>' : '');
  }

  function suffixOf(mins) {
    const t = ((Math.round(mins) % 1440) + 1440) % 1440;
    return Math.floor(t / 60) < 12 ? 'ص' : 'م';
  }

  function clockParts(now) {
    const main = state.hour24
      ? d2(now.h) + ':' + d2(now.mi)
      : d2(now.h % 12 === 0 ? 12 : now.h % 12) + ':' + d2(now.mi);
    const suffix = state.hour24 ? '' : (now.h < 12 ? 'ص' : 'م');
    return { main, suffix, seconds: d2(now.s) };
  }

  function humanDuration(sec) {
    const s = Math.max(0, Math.round(sec));
    if (s < 3600) return d2(Math.floor(s / 60)) + ':' + d2(s % 60);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (!m) return h + ' س';
    return h + ' س ' + m + ' د';
  }

  /* ------------------------------------------------------------------ البيانات */

  const timesOf = (y, m, d) => TABLE[dayKey(y, m, d)] || TABLE['01-01'];
  const jumuahValid = () => /^\d{1,2}:\d{2}$/.test(state.jumuah || '');

  function iqamaOf(key, adhanMin, isFriday) {
    if (key === 'shuruq') return null;
    if (key === 'dhuhr' && isFriday && jumuahValid()) return minutes(state.jumuah);
    return adhanMin + state.iqama[key];
  }

  function prayerName(p, isFriday) {
    return p.key === 'dhuhr' && isFriday ? 'الجمعة' : p.name;
  }

  /* --------------------------------------------------------- الصلاة القادمة */

  function nextInfo(nowSec, y, m, d) {
    const isFriday = weekday(y, m, d) === 5;
    const t = timesOf(y, m, d);

    for (const p of PRAYERS) {
      if (!p.hasIqama) continue;
      const adhan = minutes(t[p.key]);
      const iq = iqamaOf(p.key, adhan, isFriday);
      const name = prayerName(p, isFriday);
      if (nowSec >= adhan * 60 && nowSec < iq * 60) {
        return { kind: 'iqama', key: p.key, name, at: iq, left: iq * 60 - nowSec, tomorrow: false };
      }
    }

    for (const p of PRAYERS) {
      if (!p.hasIqama) continue;
      const adhan = minutes(t[p.key]);
      if (adhan * 60 > nowSec) {
        return { kind: 'adhan', key: p.key, name: prayerName(p, isFriday), at: adhan, left: adhan * 60 - nowSec, tomorrow: false };
      }
    }

    const tm = addDay(y, m, d);
    const t2 = timesOf(tm.y, tm.m, tm.d);
    const fajr = PRAYERS[0];
    const adhan = minutes(t2[fajr.key]);
    return {
      kind: 'adhan', key: fajr.key, name: fajr.name,
      at: adhan, left: (86400 - nowSec) + adhan * 60, tomorrow: true,
    };
  }

  /* ------------------------------------------------------------- الشاشة الأساسية */

  function rowsSignature(dateKey, next, tomorrow) {
    return [dateKey, next.key, next.kind, tomorrow ? 1 : 0,
      state.hour24 ? 1 : 0, state.showSuffix ? 1 : 0,
      PRAYERS.map((p) => state.iqama[p.key] ?? '').join(','), state.jumuah].join('|');
  }

  function renderRows(t, isFriday, next, tomorrow) {
    let html = '';
    PRAYERS.forEach((p) => {
      const adhan = minutes(t[p.key]);
      const iq = iqamaOf(p.key, adhan, isFriday);
      const active = !tomorrow && next.key === p.key;
      const iqama = iq === null
        ? '<span class="tcell__iqama"><span class="key">الإقامة</span><span class="none">—</span></span>'
        : '<span class="tcell__iqama"><span class="key">الإقامة</span>' + timeHTML(iq) + '</span>';

      html += '<li class="tcell' + (active ? ' tcell--next' : '') + '" data-key="' + p.key + '">' +
        '<span class="tcell__in">' +
          '<span class="tcell__name">' + prayerName(p, isFriday) + '</span>' +
          '<span class="tcell__adhan">' + timeHTML(adhan) + '</span>' +
          iqama +
        '</span>' +
      '</li>';
    });
    $('schedule').innerHTML = html;
    if (rowsSettled) $('schedule').classList.add('is-settled');
    else rowsSettled = true;
  }

  function adRowsSignature(dateKey, next, tomorrow) {
    return [dateKey, next.key, next.kind, tomorrow ? 1 : 0,
      state.hour24 ? 1 : 0, state.showSuffix ? 1 : 0,
      PRAYERS.map((p) => state.iqama[p.key] ?? '').join(','), state.jumuah].join('|');
  }

  function renderAdRows(t, isFriday, next, tomorrow) {
    let html = '';
    PRAYERS.forEach((p) => {
      const adhan = minutes(t[p.key]);
      const iq = iqamaOf(p.key, adhan, isFriday);
      const active = !tomorrow && next.key === p.key;
      html += '<li class="arow' + (active ? ' arow--next' : '') + '">' +
        '<span class="arow__name">' + prayerName(p, isFriday) + '</span>' +
        '<span class="arow__adhan">' + timeDigits(adhan) + '</span>' +
        '<span class="arow__iqama"' + (iq === null ? '' : ' aria-label="الإقامة ' + timeDigits(iq) + '"') + '>' +
          (iq === null ? '—' : timeDigits(iq)) +
        '</span>' +
      '</li>';
    });
    $('adSchedule').innerHTML = html;
  }

  function updateClocks(now) {
    const { main, suffix, seconds } = clockParts(now);
    const wd = weekday(now.y, now.m, now.d);
    const hj = hijri(now.y, now.m, now.d);

    $('clock').textContent = main;
    $('clockSuffix').textContent = suffix;
    $('seconds').textContent = seconds;

    $('adClock').textContent = main;
    $('adSuffix').textContent = suffix;

    $('dateHijri').textContent = hj.d + ' ' + HIJRI_MONTHS[hj.m - 1] + ' ' + hj.y + ' هـ';
    $('dateGreg').textContent = WEEKDAYS[wd] + ' ' + now.d + ' ' + GREG_MONTHS[now.m - 1];

    const full = WEEKDAYS[wd] + ' ' + now.d + ' ' + GREG_MONTHS[now.m - 1] +
      ' · ' + hj.d + ' ' + HIJRI_MONTHS[hj.m - 1];
    if ($('adDate').textContent !== full) $('adDate').textContent = full;

    if (now.s !== lastSecond) {
      lastSecond = now.s;
      beat();
    }
  }

  function updateSchedule(now, nowSec, wd, isFriday, t) {
    const next = nextInfo(nowSec, now.y, now.m, now.d);
    const tomorrow = next.tomorrow;

    // شريط الشاشة الأساسية
    const sig = rowsSignature(isoKey(now.y, now.m, now.d), next, tomorrow);
    if (sig !== lastRowsSig) {
      lastRowsSig = sig;
      renderRows(t, isFriday, next, tomorrow);
    }

    // قائمة شاشة الإعلان
    const adSig = adRowsSignature(isoKey(now.y, now.m, now.d), next, tomorrow);
    if (adSig !== lastAdRowsSig) {
      lastAdRowsSig = adSig;
      renderAdRows(t, isFriday, next, tomorrow);
    }

    // سطر الصلاة القادمة على الشاشة الأساسية
    $('nextName').textContent = next.name;
    $('nextTime').innerHTML = timeHTML(next.at);
    $('countLabel').textContent = 'بعد';

    const tags = document.querySelectorAll('.now__tag');
    tags.forEach((el) => { el.textContent = next.kind === 'iqama' ? 'تُقام الصلاة' : 'الصلاة القادمة'; });

    const showCount = next.left <= 3600;
    $('nextCount').hidden = !showCount;
    if (showCount) $('countValue').textContent = humanDuration(next.left);

    // سطر شاشة الإعلان
    $('adNextLabel').textContent = next.kind === 'iqama' ? 'تُقام الصلاة' : 'الصلاة القادمة';
    $('adNextName').textContent = next.name;
    $('adNextCount').textContent = 'بعد ' + humanDuration(next.left);
  }

  function beat() {
    if (reducedMotion()) return;
    $('secColon').animate(
      [{ opacity: 1 }, { opacity: .12 }, { opacity: 1 }],
      { duration: 820, easing: 'ease-in-out' }
    );
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------- شاشة الأذان / الإقامة */

  /* شاشة الأذان: ٣ دقائق بعد الأذان — شاشة الإقامة: ١٠ دقائق بعد الإقامة */
  function phaseState(nowSec, y, m, d, isFriday) {
    const t = timesOf(y, m, d);
    for (const p of PRAYERS) {
      if (!p.hasIqama) continue;
      const adhan = minutes(t[p.key]) * 60;
      const iq = iqamaOf(p.key, minutes(t[p.key]), isFriday) * 60;
      const name = prayerName(p, isFriday);
      if (nowSec >= iq && nowSec < iq + 10 * 60) return { type: 'iqama', name };
      if (nowSec >= adhan && nowSec < adhan + 3 * 60) return { type: 'adhan', name };
    }
    return null;
  }

  function applyVeil(phase) {
    const key = phase ? phase.type + '|' + phase.name : '';
    if (key === lastVeilKey) return;
    lastVeilKey = key;

    const veil = $('veil');
    const wasOpen = !veil.hidden;

    if (!phase) {
      veil.hidden = true;
      veil.classList.remove('is-iqama');
      document.body.classList.remove('is-veiled');
      if (wasOpen) resetRotation();
      return;
    }

    veil.hidden = false;
    veil.classList.toggle('is-iqama', phase.type === 'iqama');
    $('veilEyebrow').textContent = phase.type === 'iqama' ? 'تُقام الصلاة' : 'حان وقت الأذان';
    $('veilTitle').textContent = phase.name;
    document.body.classList.add('is-veiled');
    adPreview = null;
    resetRotation();

    if (!reducedMotion()) {
      $('veilCore').animate(
        phase.type === 'adhan'
          ? [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }]
          : [{ opacity: 0 }, { opacity: 1 }],
        { duration: 750, easing: 'cubic-bezier(.2,.7,.2,1)' }
      );
    }
  }

  /* ---------------------------------------------------------------- المعاينات */

  function previewName(nowSec, y, m, d, isFriday) {
    const t = timesOf(y, m, d);
    for (const p of PRAYERS) {
      if (!p.hasIqama) continue;
      if (minutes(t[p.key]) * 60 > nowSec) return prayerName(p, isFriday);
    }
    const tm = addDay(y, m, d);
    const first = PRAYERS.find((p) => p.hasIqama);
    return prayerName(first, weekday(tm.y, tm.m, tm.d) === 5);
  }

  function startPreview(type) {
    const now = nowInZone();
    const nowSec = now.h * 3600 + now.mi * 60 + now.s;
    preview = { type, name: previewName(nowSec, now.y, now.m, now.d, weekday(now.y, now.m, now.d) === 5) };
    $('veilExit').hidden = false;
    closePanel();
    lastVeilKey = '';
    paint();
    $('veilExit').focus();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(endPreview, AD_PREVIEW_MS);
  }

  function endPreview() {
    if (!preview) return;
    preview = null;
    clearTimeout(previewTimer);
    previewTimer = 0;
    $('veilExit').hidden = true;
    lastVeilKey = '\u0000';
    resetRotation();
    paint();
    $('gear').focus();
  }

  function previewAdScreen() {
    if (!ads.length) return;
    closePanel();
    adPreview = { until: Date.now() + AD_PREVIEW_MS, ad: ads[0] };
    lastSlideKey = '';
    paint();
  }

  /* ------------------------------------------------------------------ الإعلانات */

  function resetRotation() {
    rot.anchor = Date.now();
    lastSlideKey = '';
  }

  function slideAt(nowMs) {
    if (adPreview) {
      if (nowMs < adPreview.until) return { kind: 'ad', ad: adPreview.ad };
      adPreview = null;
      resetRotation();
    }

    if (state.adsMode === 'main' || !ads.length) return { kind: 'board' };

    const adSec = Math.max(1, state.adSec);
    const elapsed = Math.max(0, (nowMs - rot.anchor) / 1000);

    if (state.adsMode === 'ads') {
      const index = Math.floor(elapsed / adSec) % ads.length;
      return { kind: 'ad', ad: ads[index] };
    }

    const mainSec = Math.max(1, state.mainSec);
    const cycle = mainSec + adSec;
    const phase = elapsed % cycle;
    if (phase < mainSec) return { kind: 'board' };
    const index = Math.floor(elapsed / cycle) % ads.length;
    return { kind: 'ad', ad: ads[index] };
  }

  function setAdView(on, instant) {
    const board = $('board');
    const adview = $('adview');

    if (on) {
      adview.classList.add('is-on');
      adview.removeAttribute('aria-hidden');
      board.classList.remove('is-on');
      board.setAttribute('aria-hidden', 'true');
      currentView = 'ad';
    } else {
      board.classList.add('is-on');
      board.removeAttribute('aria-hidden');
      adview.classList.remove('is-on');
      adview.setAttribute('aria-hidden', 'true');
      currentView = 'board';
    }
    if (instant) adview.style.transition = board.style.transition = 'none';
  }

  function setWash(src) {
    const layers = [$('adwashA'), $('adwashB')];
    const next = layers[1 - washFront];
    const token = ++washToken;

    const apply = () => {
      if (token !== washToken) return;
      next.style.backgroundImage = 'url("' + src.replace(/"/g, '\\"') + '")';
      next.classList.add('is-on');
      layers[washFront].classList.remove('is-on');
      washFront = 1 - washFront;
    };

    const img = new Image();
    img.onload = apply;
    img.onerror = apply;
    img.src = src;
  }

  function showAd(ad) {
    if (!ad) return;
    if (currentAdId === ad.id && $('adImage').getAttribute('src') === ad.src) return;

    const isFirst = !$('adImage').getAttribute('src');
    currentAdId = ad.id;
    setWash(ad.src);

    clearTimeout(swapTimer);

    if (isFirst) {
      $('adImage').src = ad.src;
      $('adImage').alt = ad.name || 'إعلان';
      return;
    }

    const card = $('adcard');
    card.classList.add('is-out');
    swapTimer = setTimeout(() => {
      $('adImage').src = ad.src;
      $('adImage').alt = ad.name || 'إعلان';
      card.classList.remove('is-out');
    }, 420);
  }

  function applySlide(slide) {
    if (slide.kind === 'board') {
      if (currentView !== 'board') setAdView(false);
      return;
    }
    if (currentView !== 'ad') setAdView(true);
    showAd(slide.ad);
  }

  function urlFor(row) {
    let url = adUrls.get(row.id);
    if (!url) {
      url = URL.createObjectURL(row.blob);
      adUrls.set(row.id, url);
    }
    return url;
  }

  async function refreshAds() {
    const localRows = await window.AdsStore.all();
    const fileRows = await window.AdsStore.manifest();

    const local = localRows.map((row, index) => ({
      id: row.id,
      name: row.name || 'إعلان',
      kind: 'local',
      order: row.order || index + 1,
      bytes: row.bytes || (row.blob ? row.blob.size : 0),
      src: urlFor(row),
    }));

    const keep = new Set(local.map((row) => row.id));
    for (const [id, url] of adUrls) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(url);
        adUrls.delete(id);
      }
    }

    ads.length = 0;
    ads.push(...local, ...fileRows);

    if (currentAdId && !ads.some((ad) => ad.id === currentAdId)) {
      currentAdId = null;
      $('adImage').removeAttribute('src');
      $('adcard').classList.remove('is-out');
    }

    renderAdsList();
    $('adsCount').textContent = String(ads.length);
    $('adsHint').textContent = ads.length ? ads.length + ' إعلان جاهز للعرض' : 'لا إعلانات بعد';
    $('previewAd').disabled = !ads.length;
    $('previewAdScreen').disabled = !ads.length;

    resetRotation();
    lastSlideKey = '';
  }

  function renderAdsList() {
    const list = $('adsList');
    if (!ads.length) {
      list.innerHTML = '';
      return;
    }

    const localCount = ads.filter((ad) => ad.kind === 'local').length;

    list.innerHTML = ads.map((ad, index) => {
      const meta = ad.kind === 'file'
        ? 'من مجلد assets/ads'
        : formatBytes(ad.bytes) + ' · محفوظ في هذا الجهاز';
      const actions = ad.kind === 'file'
        ? '<span class="aditem__badge">من المجلد</span>'
        : '<button class="iconbtn" type="button" data-act="up" aria-label="تقديم ' + escapeHTML(ad.name) + '"' + (index === 0 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>' +
          '<button class="iconbtn" type="button" data-act="down" aria-label="تأخير ' + escapeHTML(ad.name) + '"' + (index >= localCount - 1 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>' +
          '<button class="iconbtn iconbtn--danger" type="button" data-act="remove" aria-label="حذف ' + escapeHTML(ad.name) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>';

      return '<li class="aditem" data-id="' + escapeHTML(ad.id) + '" data-kind="' + ad.kind + '">' +
        '<img class="aditem__thumb" src="' + escapeHTML(ad.src) + '" alt="">' +
        '<span class="aditem__index">' + (index + 1) + '</span>' +
        '<span class="aditem__body">' +
          '<span class="aditem__name">' + escapeHTML(ad.name) + '</span>' +
          '<span class="aditem__meta">' + meta + '</span>' +
        '</span>' +
        '<span class="aditem__actions">' + actions + '</span>' +
      '</li>';
    }).join('');
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' ك.ب';
    return (bytes / (1024 * 1024)).toFixed(1) + ' م.ب';
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function onAdsListClick(event) {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const item = button.closest('.aditem');
    if (!item) return;

    const id = item.dataset.id;
    const act = button.dataset.act;
    button.disabled = true;

    if (act === 'remove') {
      await window.AdsStore.remove(id);
    } else if (act === 'up') {
      await window.AdsStore.move(id, -1);
    } else if (act === 'down') {
      await window.AdsStore.move(id, 1);
    }

    await refreshAds();
    paint();
  }

  async function addFiles(files) {
    if (!files || !files.length) return;
    const title = $('dropzone');
    title.classList.add('is-busy');
    const added = await window.AdsStore.addFiles(files);
    title.classList.remove('is-busy');
    await refreshAds();
    paint();
    if (!added) {
      $('adsHint').textContent = 'تعذّر إضافة الصور المختارة';
    }
  }

  /* ------------------------------------------------------------------ اللوحة */

  function selectTab(name) {
    const tabs = { times: $('tabTimes'), ads: $('tabAds'), display: $('tabDisplay') };
    const panes = { times: $('paneTimes'), ads: $('paneAds'), display: $('paneDisplay') };
    for (const key of Object.keys(tabs)) {
      const on = key === name;
      tabs[key].classList.toggle('is-on', on);
      tabs[key].setAttribute('aria-selected', on ? 'true' : 'false');
      panes[key].hidden = !on;
      panes[key].classList.toggle('is-on', on);
    }
  }

  function buildPanel() {
    $('opt24').checked = state.hour24;
    $('optSuffix').checked = state.showSuffix;
    $('optHijri').value = String(state.hijriOffset);
    $('optJumuah').value = state.jumuah || '';
    $('optMainSec').value = String(state.mainSec);
    $('optAdSec').value = String(state.adSec);

    document.querySelectorAll('input[name="adMode"]').forEach((radio) => {
      radio.checked = radio.value === state.adsMode;
    });

    $('iqamaGrid').replaceChildren();
    for (const key of Object.keys(IQ_LABELS)) {
      const wrap = document.createElement('label');
      wrap.className = 'iq';
      wrap.innerHTML = '<span>' + IQ_LABELS[key] + '</span>' +
        '<input type="number" min="0" max="90" step="1" inputmode="numeric" value="' +
        state.iqama[key] + '" data-key="' + key + '">';
      $('iqamaGrid').appendChild(wrap);
    }
  }

  function openPanel() {
    buildPanel();
    sheetOpen = true;
    $('sheet').hidden = false;
    $('gear').setAttribute('aria-expanded', 'true');
    const first = $('iqamaGrid').querySelector('input');
    if (first) first.focus();
  }

  function closePanel() {
    sheetOpen = false;
    $('sheet').hidden = true;
    $('gear').setAttribute('aria-expanded', 'false');
    lastSlideKey = '';
    resetRotation();
    $('gear').focus();
  }

  function changed() {
    save();
    lastRowsSig = '';
    lastAdRowsSig = '';
    paint();
  }

  function bind() {
    $('gear').addEventListener('click', openPanel);
    $('closeSheet').addEventListener('click', closePanel);
    $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closePanel(); });

    $('tabTimes').addEventListener('click', () => selectTab('times'));
    $('tabAds').addEventListener('click', () => selectTab('ads'));
    $('tabDisplay').addEventListener('click', () => selectTab('display'));

    document.addEventListener('keydown', (e) => {
      const typing = /input|select|textarea/i.test(document.activeElement.tagName);
      if (e.key === 'Escape') {
        if (preview) endPreview();
        else if (adPreview) { adPreview = null; resetRotation(); paint(); }
        else if (sheetOpen) closePanel();
      }
      if ((e.key === 's' || e.key === 'S') && !typing && !sheetOpen && !preview) openPanel();
      if ((e.key === 'f' || e.key === 'F') && !typing) toggleFullscreen();
    });

    $('previewAdhan').addEventListener('click', () => startPreview('adhan'));
    $('previewIqama').addEventListener('click', () => startPreview('iqama'));
    $('veilExit').addEventListener('click', endPreview);

    $('opt24').addEventListener('change', (e) => { state.hour24 = e.target.checked; changed(); });
    $('optSuffix').addEventListener('change', (e) => { state.showSuffix = e.target.checked; changed(); });
    $('optHijri').addEventListener('change', (e) => { state.hijriOffset = Number(e.target.value); changed(); });
    $('optJumuah').addEventListener('change', (e) => { state.jumuah = e.target.value || ''; changed(); });

    document.querySelectorAll('input[name="adMode"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        state.adsMode = e.target.value;
        save();
        resetRotation();
        changed();
      });
    });

    $('optMainSec').addEventListener('change', (e) => {
      state.mainSec = clampNumber(e.target.value, 5, 600, DEFAULTS.mainSec);
      e.target.value = String(state.mainSec);
      save();
      resetRotation();
      changed();
    });

    $('optAdSec').addEventListener('change', (e) => {
      state.adSec = clampNumber(e.target.value, 5, 600, DEFAULTS.adSec);
      e.target.value = String(state.adSec);
      save();
      resetRotation();
      changed();
    });

    $('iqamaGrid').addEventListener('change', (e) => {
      const key = e.target.dataset.key;
      if (!key) return;
      let value = Number(e.target.value);
      if (!Number.isFinite(value)) value = 0;
      value = Math.max(0, Math.min(90, Math.round(value)));
      state.iqama[key] = value;
      e.target.value = value;
      changed();
    });

    $('adFiles').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      addFiles(files);
    });

    const dropzone = $('dropzone');
    ['dragenter', 'dragover'].forEach((type) => {
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-over');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    $('adsList').addEventListener('click', onAdsListClick);
    $('previewAd').addEventListener('click', previewAdScreen);
    $('previewAdScreen').addEventListener('click', previewAdScreen);

    $('btnFull').addEventListener('click', toggleFullscreen);

    $('btnReset').addEventListener('click', () => {
      Object.assign(state, JSON.parse(JSON.stringify(DEFAULTS)));
      save();
      buildPanel();
      lastRowsSig = '';
      lastAdRowsSig = '';
      resetRotation();
      paint();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        lastRowsSig = '';
        lastAdRowsSig = '';
        resetRotation();
        paint();
      }
    });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  /* ------------------------------------------------------------------ العرض */

  function paint() {
    const now = nowInZone();
    const nowSec = now.h * 3600 + now.mi * 60 + now.s;
    const wd = weekday(now.y, now.m, now.d);
    const isFriday = wd === 5;
    const t = timesOf(now.y, now.m, now.d);

    updateClocks(now);
    updateSchedule(now, nowSec, wd, isFriday, t);

    const phase = preview || phaseState(nowSec, now.y, now.m, now.d, isFriday);
    applyVeil(phase);

    if (phase) {
      const { main, suffix } = clockParts(now);
      $('veilClock').textContent = main;
      $('veilSuffix').textContent = suffix;
    }

    if (sheetOpen) return;

    const slide = slideAt(Date.now());
    const key = slide.kind === 'ad' ? 'ad:' + slide.ad.id : 'board';
    if (key !== lastSlideKey) {
      lastSlideKey = key;
      applySlide(slide);
    }
  }

  function tick() {
    paint();
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    buildPanel();

    // أدوات عرض سريعة: ?view=ads|main|mixed و ?preview=ad|adhan|iqama
    const params = new URLSearchParams(location.search);
    const forcedView = params.get('view');
    if (['mixed', 'main', 'ads'].includes(forcedView)) state.adsMode = forcedView;
    const mainParam = Number(params.get('main'));
    const adParam = Number(params.get('ad'));
    if (Number.isFinite(mainParam) && mainParam >= 1) state.mainSec = clampNumber(mainParam, 1, 600, state.mainSec);
    if (Number.isFinite(adParam) && adParam >= 1) state.adSec = clampNumber(adParam, 1, 600, state.adSec);

    paint();
    refreshAds().then(() => {
      const wanted = params.get('preview');
      if (wanted === 'ad' && ads.length) {
        adPreview = { until: Date.now() + AD_PREVIEW_MS, ad: ads[0] };
        lastSlideKey = '';
      } else if ((wanted === 'adhan' || wanted === 'iqama') && !preview) {
        const now = nowInZone();
        const nowSec = now.h * 3600 + now.mi * 60 + now.s;
        preview = { type: wanted, name: previewName(nowSec, now.y, now.m, now.d, weekday(now.y, now.m, now.d) === 5) };
        $('veilExit').hidden = false;
        lastVeilKey = '';
        previewTimer = setTimeout(endPreview, AD_PREVIEW_MS);
      }
      paint();
    });
    tick();
  });
})();
