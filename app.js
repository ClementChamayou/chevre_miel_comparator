// =====================================================================
//  Le Guide Chèvre-Miel — application
//  Carte : Leaflet + tuiles CARTO (données OpenStreetMap)
//  Recherche : Photon (komoot), données OpenStreetMap, sans clé
//  Données : Supabase (ou localStorage en mode démo)
// =====================================================================
import { CONFIG } from './config.js';

const DEMO = !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('XXXX')
          || !CONFIG.SUPABASE_KEY || CONFIG.SUPABASE_KEY.includes('XXXX');
const PHOTON = 'https://photon.komoot.io';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ---------------------------------------------------------------------
//  Petits utilitaires
// ---------------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtNote = n => (n == null || isNaN(n)) ? '–' : (Math.round(n * 10) / 10).toString().replace('.', ',');
const fmtPrix = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

class PinError extends Error {}
class Cancelled extends Error {}

function noteLabel(n) {
  if (n == null) return '';
  if (n < 2) return 'Crime contre le chèvre';
  if (n < 4) return 'Le miel pleure';
  if (n < 5.5) return 'Mangeable, sans plus';
  if (n < 7) return 'Honnête';
  if (n < 8.5) return 'Très belle chèvre-miel';
  if (n < 9.5) return 'Le Graal n’est pas loin';
  return 'Chef-d’œuvre absolu';
}
function noteColors(n) {
  if (n == null) return ['#EADBC4', '#3B2A1A'];
  if (n < 4) return ['#D9C7B0', '#3B2A1A'];
  if (n < 6) return ['#F6D38A', '#3B2A1A'];
  if (n < 8) return ['#F2A93B', '#3B2A1A'];
  if (n < 9) return ['#C97A12', '#FFF8EC'];
  return ['#3B2A1A', '#F2A93B'];
}

// Initiales d'un établissement : on saute les mots creux (« Pizzeria », « Chez »…)
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'chez', 'pizzeria', 'pizza', 'pizzas', 'restaurant', 'resto', 'da', 'di', 'il', 'lo', 'au', 'aux', 'the', 'et', 'a']);
function initials(name) {
  const words = String(name || '?').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  let sig = words.filter(w => !STOP.has(w.toLowerCase()));
  if (!sig.length) sig = words;
  if (!sig.length) return '?';
  return (sig.length >= 2 ? sig[0][0] + sig[1][0] : sig[0].slice(0, 2)).toUpperCase();
}
const AVATARS = [['#FCE3B0', '#3B2A1A'], ['#F2A93B', '#3B2A1A'], ['#3B2A1A', '#F2A93B'], ['#E8D5B5', '#7A4B12'], ['#C97A12', '#FFF8EC'], ['#F7EEDC', '#C97A12']];
function avatarColors(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
function thumbHtml({ img, name, big = false }) {
  if (img) return `<div class="thumb${big ? ' big' : ''}"><img src="${esc(img)}" alt=""></div>`;
  const [bg, fg] = avatarColors(name);
  return `<div class="thumb${big ? ' big' : ''}" style="--av:${bg};--av-txt:${fg}" aria-hidden="true">${esc(initials(name))}</div>`;
}
function chipHtml(n, extra = '') {
  const [bg, fg] = noteColors(n);
  return `<div class="note-chip" style="--chip:${bg};--chip-txt:${fg};${extra}">${fmtNote(n)}</div>`;
}

// ---------------------------------------------------------------------
//  Stockage : mode démo (navigateur) ou Supabase
// ---------------------------------------------------------------------
class LocalStore {
  constructor() {
    this.key = 'gcm-demo-v1';
    let db = null;
    try { db = JSON.parse(ls.get(this.key)); } catch { /* vide */ }
    this.db = db || { restos: [], pizzas: [], photos: {} };
  }
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.db)); }
    catch { throw new Error('Le stockage du navigateur est plein (mode démo).'); }
  }
  needsPin() { return false; }
  async loadAll() { return { restos: structuredClone(this.db.restos), pizzas: structuredClone(this.db.pizzas) }; }
  async addResto(r) {
    const row = { id: uid(), created_at: new Date().toISOString(), address: null, osm_id: null, ...r };
    this.db.restos.push(row); this.save(); return { ...row };
  }
  async updateResto(id, patch) {
    const r = this.db.restos.find(x => x.id === id); Object.assign(r, patch); this.save(); return { ...r };
  }
  async deleteResto(id) {
    const gone = this.db.pizzas.filter(p => p.resto_id === id).map(p => p.id);
    gone.forEach(pid => delete this.db.photos[pid]);
    this.db.pizzas = this.db.pizzas.filter(p => p.resto_id !== id);
    this.db.restos = this.db.restos.filter(r => r.id !== id);
    this.save();
  }
  async addPizza(p, photo) {
    const row = { id: uid(), created_at: new Date().toISOString(), ...p };
    this.db.pizzas.push(row);
    if (photo) this.db.photos[row.id] = photo;
    this.save(); return { ...row };
  }
  async updatePizza(id, patch, photo) {
    const p = this.db.pizzas.find(x => x.id === id); Object.assign(p, patch);
    if (photo === null) delete this.db.photos[id]; else if (photo) this.db.photos[id] = photo;
    this.save(); return { ...p };
  }
  async deletePizza(id) {
    this.db.pizzas = this.db.pizzas.filter(p => p.id !== id); delete this.db.photos[id]; this.save();
  }
  async getPhoto(id) { return this.db.photos[id] || null; }
}

class SupaStore {
  constructor(createClient) {
    this.createClient = createClient;
    this.pin = ls.get('gcm-pin') || '';
    this.sb = this.client(this.pin);
  }
  client(pin) {
    return this.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: pin ? { 'x-pin': pin } : {} },
    });
  }
  needsPin() { return !this.pin; }
  setPin(pin) { this.pin = pin; if (pin) ls.set('gcm-pin', pin); else ls.del('gcm-pin'); this.sb = this.client(pin); }
  async checkPin(pin) {
    const { data, error } = await this.client(pin).rpc('is_chef');
    if (error) throw error;
    return data === true;
  }
  static check(error) {
    if (!error) return;
    // 42501 : refus RLS à l'insertion ; PGRST116 : 0 ligne modifiée (refus RLS à la mise à jour)
    if (error.code === '42501' || error.code === 'PGRST116') throw new PinError();
    throw new Error(error.message || 'Erreur Supabase');
  }
  async loadAll() {
    const [r, p] = await Promise.all([
      this.sb.from('restos').select('*'),
      this.sb.from('pizzas').select('*'),
    ]);
    SupaStore.check(r.error); SupaStore.check(p.error);
    return { restos: r.data, pizzas: p.data };
  }
  async addResto(r) {
    const { data, error } = await this.sb.from('restos').insert(r).select().single();
    SupaStore.check(error); return data;
  }
  async updateResto(id, patch) {
    const { data, error } = await this.sb.from('restos').update(patch).eq('id', id).select().single();
    SupaStore.check(error); return data;
  }
  async deleteResto(id) {
    const { error, count } = await this.sb.from('restos').delete({ count: 'exact' }).eq('id', id);
    SupaStore.check(error); if (count === 0) throw new PinError();
  }
  async addPizza(p, photo) {
    const { data, error } = await this.sb.from('pizzas').insert(p).select().single();
    SupaStore.check(error);
    if (photo) {
      const r = await this.sb.from('photos').insert({ pizza_id: data.id, data: photo });
      if (r.error) toast('Pizza enregistrée, mais la photo n’est pas passée.', true);
    }
    return data;
  }
  async updatePizza(id, patch, photo) {
    const { data, error } = await this.sb.from('pizzas').update(patch).eq('id', id).select().single();
    SupaStore.check(error);
    if (photo === null) await this.sb.from('photos').delete().eq('pizza_id', id);
    else if (photo) {
      const r = await this.sb.from('photos').upsert({ pizza_id: id, data: photo });
      if (r.error) toast('Modifications enregistrées, mais pas la photo.', true);
    }
    return data;
  }
  async deletePizza(id) {
    const { error, count } = await this.sb.from('pizzas').delete({ count: 'exact' }).eq('id', id);
    SupaStore.check(error); if (count === 0) throw new PinError();
  }
  async getPhoto(id) {
    const { data, error } = await this.sb.from('photos').select('data').eq('pizza_id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.data || null;
  }
}

let store;

// ---------------------------------------------------------------------
//  État
// ---------------------------------------------------------------------
const S = {
  restos: new Map(),   // id -> resto
  pizzas: [],          // sans photo pleine taille
  sort: ls.get('gcm-sort') || 'date',
  sheet: null,         // {type:'resto', id} | {type:'place', place}
};
const pizzasOf = rid => S.pizzas.filter(p => p.resto_id === rid);
const avg = arr => arr.length ? arr.reduce((s, p) => s + Number(p.note), 0) / arr.length : null;
const byDateDesc = (a, b) => (b.eaten_on || '').localeCompare(a.eaten_on || '') || (b.created_at || '').localeCompare(a.created_at || '');

// ---------------------------------------------------------------------
//  Interface : toasts & modales
// ---------------------------------------------------------------------
let toastTimer;
function toast(msg, error = false) {
  const el = $('#toast');
  el.textContent = msg; el.classList.toggle('error', !!error); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 4500 : 2600);
}

const modalStack = [];
function openModal(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.style.zIndex = 2000 + modalStack.length * 10;
  wrap.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const m = {
    el: wrap.firstElementChild,
    close() {
      if (!wrap.isConnected) return;
      wrap.remove(); modalStack.splice(modalStack.indexOf(m), 1); onClose?.();
    },
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) m.close(); });
  modalStack.push(m);
  return m;
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (modalStack.length) modalStack[modalStack.length - 1].close();
  else if ($('#drawer').classList.contains('open')) closeDrawer();
  else if (S.sheet) closeSheet();
});

function confirmBox(title, text, okLabel = 'Supprimer') {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(`
      <h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn" data-a="no" style="flex:1">Annuler</button>
        <button class="btn danger" data-a="yes" style="flex:1">${esc(okLabel)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); } });
    m.el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      answered = true; resolve(a === 'yes'); m.close();
    });
  });
}

// ---------- Code secret ----------
function askPin(retry = false) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal(`
      <h2>🔑 Code secret</h2>
      <p class="sub">${retry ? 'Ce code n’est pas (ou plus) le bon.' : 'Seule la cheffe du Guide peut noter. Une seule fois sur cet appareil.'}</p>
      <form>
        <div class="field"><input class="input" type="password" name="pin" autocomplete="current-password" placeholder="Phrase secrète" required></div>
        <p class="pin-err" style="color:var(--rouge);font-size:14px;margin:0" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" data-a="cancel" style="flex:1">Annuler</button>
          <button type="submit" class="btn primary">Valider</button>
        </div>
      </form>`, { onClose: () => { if (!done) resolve(false); } });
    const form = $('form', m.el), err = $('.pin-err', m.el), input = $('input', m.el);
    setTimeout(() => input.focus(), 50);
    $('[data-a=cancel]', m.el).onclick = () => m.close();
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = $('[type=submit]', form); btn.disabled = true; err.hidden = true;
      try {
        const pin = input.value.trim();
        if (await store.checkPin(pin)) { store.setPin(pin); done = true; resolve(true); m.close(); toast('Bienvenue, cheffe 👩‍🍳'); }
        else { err.textContent = 'Mauvais code.'; err.hidden = false; input.select(); }
      } catch (ex) {
        err.textContent = 'Impossible de vérifier le code (réseau ou configuration) : ' + (ex.message || ex);
        err.hidden = false;
      } finally { btn.disabled = false; }
    };
  });
}

// Exécute une écriture ; demande le code secret si besoin, puis réessaie une fois.
async function guarded(fn) {
  if (store.needsPin() && !(await askPin())) throw new Cancelled();
  try { return await fn(); }
  catch (e) {
    if (!(e instanceof PinError)) throw e;
    store.setPin('');
    if (!(await askPin(true))) throw new Cancelled();
    return await fn();
  }
}
function handleErr(e) {
  if (e instanceof Cancelled) return;
  console.error(e);
  toast(e.message || 'Une erreur est survenue', true);
}

// ---------------------------------------------------------------------
//  Carte
// ---------------------------------------------------------------------
const map = L.map('map', { zoomControl: false, tapHold: true })
  .setView([CONFIG.CARTE_DEPART.lat, CONFIG.CARTE_DEPART.lon], CONFIG.CARTE_DEPART.zoom);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20, subdomains: 'abcd',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

const markers = new Map();
let tempMarker = null;
let meMarker = null;

function pinIcon(n, { empty = false, temp = false, selected = false } = {}) {
  const [bg, fg] = temp ? ['#3B2A1A', '#FFF8EC'] : noteColors(n);
  const cls = ['pin', empty && 'empty', temp && 'temp', selected && 'selected'].filter(Boolean).join(' ');
  const label = temp ? '📍' : empty ? '🍕' : fmtNote(n);
  return L.divIcon({
    className: '', iconSize: [44, 44], iconAnchor: [22, 46],
    html: `<div class="${cls}" style="--pin:${bg};--pin-txt:${fg}"><span>${label}</span></div>`,
  });
}

function renderMarkers() {
  const selId = S.sheet?.type === 'resto' ? S.sheet.id : null;
  for (const [id, mk] of markers) if (!S.restos.has(id)) { mk.remove(); markers.delete(id); }
  for (const r of S.restos.values()) {
    const ps = pizzasOf(r.id);
    const icon = pinIcon(avg(ps), { empty: !ps.length, selected: r.id === selId });
    let mk = markers.get(r.id);
    if (!mk) {
      mk = L.marker([r.lat, r.lon], { icon, riseOnHover: true, keyboard: true, title: r.name }).addTo(map);
      mk.on('click', () => openResto(r.id));
      markers.set(r.id, mk);
    } else { mk.setIcon(icon); mk.setLatLng([r.lat, r.lon]); }
    mk.setZIndexOffset(r.id === selId ? 1000 : 0);
  }
}

function clearTemp() { if (tempMarker) { tempMarker.remove(); tempMarker = null; } }

// Centre la carte sur un point en tenant compte de la fiche du bas.
function focusOn(lat, lon, zoom = Math.max(map.getZoom(), 16)) {
  const sheetH = S.sheet ? $('#sheet').offsetHeight : 0;
  const topH = 70;
  const pt = map.project([lat, lon], zoom).add([0, (sheetH - topH) / 2]);
  map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.8 });
}

map.on('click', () => { hideResults(); if (S.sheet) closeSheet(); });
map.on('contextmenu', e => { hideResults(); newPlaceAt(e.latlng.lat, e.latlng.lng); });
map.on('movestart', () => $('#hint').classList.add('gone'));

$('#btn-locate').onclick = () => {
  if (!navigator.geolocation) return toast('Géolocalisation indisponible', true);
  const b = $('#btn-locate'); b.classList.add('locating');
  navigator.geolocation.getCurrentPosition(pos => {
    b.classList.remove('locating');
    const { latitude: lat, longitude: lon } = pos.coords;
    if (!meMarker) meMarker = L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(map);
    else meMarker.setLatLng([lat, lon]);
    map.flyTo([lat, lon], 16, { duration: 0.8 });
  }, () => { b.classList.remove('locating'); toast('Position refusée ou introuvable', true); },
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
};

// ---------------------------------------------------------------------
//  Recherche
// ---------------------------------------------------------------------
const input = $('#search-input'), results = $('#search-results'), clearBtn = $('#search-clear');
let searchCtl = null, resultItems = [], activeIdx = -1;

function photonToPlace(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const cityLine = [p.postcode, p.city || (p.name !== p.town ? p.town : '') || p.village].filter(Boolean).join(' ');
  const name = p.name || street || p.city || 'Lieu sans nom';
  const address = [street !== name ? street : '', cityLine, !cityLine && p.country].filter(Boolean).join(', ');
  const area = p.osm_key === 'place' || p.osm_key === 'boundary';
  return { name, address, lat, lon, osm_id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : null, key: p.osm_key, value: p.osm_value, area, extent: p.extent };
}
function placeIcon(pl) {
  if (pl.key === 'amenity' && ['restaurant', 'fast_food', 'food_court'].includes(pl.value)) return /pizz/i.test(pl.name) ? '🍕' : '🍽️';
  if (pl.key === 'amenity' && ['cafe', 'bar', 'pub'].includes(pl.value)) return '☕';
  if (pl.area) return '🏙️';
  if (pl.key === 'shop') return '🛍️';
  return '📍';
}
const FOOD = pl => pl.key === 'amenity' && ['restaurant', 'fast_food', 'food_court', 'cafe', 'bar', 'pub'].includes(pl.value);

// Appel Photon ; si la langue « fr » est refusée par le serveur, on réessaie sans.
async function photon(path, params, signal) {
  let res = await fetch(`${PHOTON}${path}?${params}`, { signal });
  if (res.status === 400 && params.has('lang')) { params.delete('lang'); res = await fetch(`${PHOTON}${path}?${params}`, { signal }); }
  if (!res.ok) throw new Error('Photon HTTP ' + res.status);
  return res.json();
}

function showResults(html) { results.innerHTML = html; results.hidden = false; }
function hideResults() { results.hidden = true; activeIdx = -1; }

function renderResults(known, places, loading) {
  resultItems = [...known.map(r => ({ type: 'resto', r })), ...places.map(pl => ({ type: 'place', pl }))];
  let i = 0, html = '';
  if (known.length) {
    html += `<li class="r-section">Déjà dans le guide</li>`;
    for (const r of known) {
      const ps = pizzasOf(r.id);
      html += `<li data-i="${i++}" role="option"><div class="r-ico known">🍕</div><div class="r-main"><div class="r-name">${esc(r.name)}</div><div class="r-sub">${ps.length ? `${fmtNote(avg(ps))}/10 · ${ps.length} pizza${ps.length > 1 ? 's' : ''}` : 'Pas encore notée'}${r.address ? ' · ' + esc(r.address) : ''}</div></div></li>`;
    }
  }
  if (places.length) {
    if (known.length) html += `<li class="r-section">Sur la carte</li>`;
    for (const pl of places) html += `<li data-i="${i++}" role="option"><div class="r-ico">${placeIcon(pl)}</div><div class="r-main"><div class="r-name">${esc(pl.name)}</div><div class="r-sub">${esc(pl.address || '')}</div></div></li>`;
  }
  if (loading) html += `<li class="r-empty">Recherche…</li>`;
  else if (!known.length && !places.length) html += `<li class="r-empty">Rien trouvé. Astuce : appui long sur la carte pour placer le resto à la main.</li>`;
  showResults(html);
}

const runSearch = debounce(async q => {
  const nq = norm(q);
  const known = [...S.restos.values()].filter(r => norm(r.name).includes(nq) || norm(r.address).includes(nq)).slice(0, 5);
  renderResults(known, [], true);
  searchCtl?.abort(); searchCtl = new AbortController();
  try {
    const c = map.getCenter();
    const params = new URLSearchParams({ q, lang: 'fr', limit: '10' });
    if (map.getZoom() >= 5) { params.set('lat', c.lat.toFixed(5)); params.set('lon', c.lng.toFixed(5)); params.set('zoom', String(Math.min(map.getZoom(), 14))); }
    const json = await photon('/api/', params, searchCtl.signal);
    if (input.value.trim() !== q) return;
    const knownOsm = new Set(known.map(r => r.osm_id).filter(Boolean));
    let places = json.features.map(photonToPlace).filter(pl => !knownOsm.has(pl.osm_id));
    places.sort((a, b) => FOOD(b) - FOOD(a));       // restos d'abord
    renderResults(known, places.slice(0, 8), false);
  } catch (e) {
    if (e.name === 'AbortError') return;
    renderResults(known, [], false);
    results.insertAdjacentHTML('beforeend', `<li class="r-empty">Recherche en ligne indisponible pour l'instant.</li>`);
  }
}, 280);

input.addEventListener('input', () => {
  const q = input.value.trim();
  clearBtn.hidden = !input.value;
  if (q.length < 2) { hideResults(); return; }
  runSearch(q);
});
input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && results.innerHTML) results.hidden = false; });
input.addEventListener('keydown', e => {
  const lis = $$('li[data-i]', results);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!lis.length) return;
    activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
    lis.forEach((li, k) => li.classList.toggle('active', k === activeIdx));
  } else if (e.key === 'Enter') {
    e.preventDefault(); const li = lis[Math.max(activeIdx, 0)]; if (li) pickResult(+li.dataset.i);
  }
});
clearBtn.onclick = () => { input.value = ''; clearBtn.hidden = true; hideResults(); input.focus(); };
results.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pickResult(+li.dataset.i); });

function pickResult(i) {
  const it = resultItems[i]; if (!it) return;
  hideResults(); input.blur();
  if (it.type === 'resto') return openResto(it.r.id, true);
  const pl = it.pl;
  if (pl.area) {
    if (pl.extent) map.flyToBounds([[pl.extent[1], pl.extent[0]], [pl.extent[3], pl.extent[2]]], { duration: 0.8 });
    else map.flyTo([pl.lat, pl.lon], 13, { duration: 0.8 });
    return;
  }
  // Déjà connu ? (même objet OSM, ou même nom à moins de 40 m)
  const twin = [...S.restos.values()].find(r =>
    (pl.osm_id && r.osm_id === pl.osm_id) ||
    (norm(r.name) === norm(pl.name) && map.distance([r.lat, r.lon], [pl.lat, pl.lon]) < 40));
  if (twin) return openResto(twin.id, true);
  openPlace(pl);
}

// ---------------------------------------------------------------------
//  Fiche du bas
// ---------------------------------------------------------------------
const sheet = $('#sheet');
function setSheetHeight() { document.body.style.setProperty('--sheet-h', sheet.hidden ? '0px' : sheet.offsetHeight + 'px'); }

function closeSheet() {
  S.sheet = null; sheet.hidden = true; document.body.classList.remove('sheet-open');
  clearTemp(); renderMarkers(); setSheetHeight();
}

function openResto(id, fly = false) {
  clearTemp();
  S.sheet = { type: 'resto', id };
  renderSheet(); renderMarkers();
  const r = S.restos.get(id);
  if (fly && r) requestAnimationFrame(() => focusOn(r.lat, r.lon));
}

function openPlace(pl) {
  clearTemp();
  tempMarker = L.marker([pl.lat, pl.lon], { icon: pinIcon(null, { temp: true }), zIndexOffset: 2000 }).addTo(map);
  S.sheet = { type: 'place', place: pl };
  renderSheet(); renderMarkers();
  requestAnimationFrame(() => focusOn(pl.lat, pl.lon));
}

async function newPlaceAt(lat, lon) {
  const pl = { name: '', address: '', lat, lon, osm_id: null, manual: true, loading: true };
  openPlace(pl);
  try {
    const json = await photon('/reverse', new URLSearchParams({ lat: String(lat), lon: String(lon), lang: 'fr', limit: '1' }));
    const f = json.features?.[0];
    if (f && S.sheet?.place === pl) {
      const g = photonToPlace(f);
      pl.address = g.address || g.name;
      if (FOOD(g) && map.distance([lat, lon], [g.lat, g.lon]) < 60) { pl.suggest = g.name; pl.osm_id = g.osm_id; }
    }
  } catch { /* pas grave */ }
  pl.loading = false;
  if (S.sheet?.place === pl) renderSheet();
}

function gmapsUrl(r) {
  const q = r.address ? `${r.name}, ${r.address}` : `${r.lat},${r.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function renderSheet() {
  const st = S.sheet; if (!st) return closeSheet();
  let html = '<div class="grip"></div>';
  if (st.type === 'resto') {
    const r = S.restos.get(st.id); if (!r) return closeSheet();
    const ps = pizzasOf(r.id).sort(byDateDesc);
    const a = avg(ps);
    html += `<div class="sheet-head">
        <div class="grow"><h2>${esc(r.name)}</h2><p class="addr">${esc(r.address || '')}</p></div>
        ${ps.length ? `<div class="score-badge" style="background:${noteColors(a)[0]};color:${noteColors(a)[1]}"><b>${fmtNote(a)}</b><small>${ps.length} pizza${ps.length > 1 ? 's' : ''}</small></div>` : ''}
        <button class="close" data-act="close" aria-label="Fermer">×</button>
      </div>
      <div class="sheet-actions">
        <button class="btn primary" data-act="add-pizza">＋ Noter une pizza</button>
        <a class="btn" href="${esc(gmapsUrl(r))}" target="_blank" rel="noopener">Itinéraire</a>
        <button class="btn" data-act="resto-menu" aria-label="Plus d'options">•••</button>
      </div>`;
    if (ps.length) {
      html += `<ul class="mini-list">${ps.map(p => `
        <li data-pizza="${p.id}">${thumbHtml({ img: p.thumb, name: r.name })}
          <div class="item-main"><div class="item-title">${esc(p.name)}</div>
          <div class="item-sub">${fmtDate(p.eaten_on)}</div>
          ${p.comment ? `<div class="item-com">« ${esc(p.comment)} »</div>` : ''}</div>
          ${chipHtml(Number(p.note))}</li>`).join('')}</ul>`;
    } else html += `<p class="addr" style="margin-top:12px">Aucune chèvre-miel notée ici. Pour l'instant.</p>`;
  } else {
    const pl = st.place;
    const title = pl.name || pl.suggest || (pl.loading ? 'Recherche du lieu…' : 'Lieu choisi sur la carte');
    html += `<div class="sheet-head">
        <div class="grow"><h2>${esc(title)}</h2><p class="addr">${esc(pl.address || '')}</p></div>
        <button class="close" data-act="close" aria-label="Fermer">×</button>
      </div>
      <div class="sheet-actions">
        <button class="btn primary" data-act="place-pizza">＋ Noter une pizza ici</button>
        <button class="btn" data-act="place-add">Ajouter le resto</button>
      </div>`;
  }
  sheet.innerHTML = html; sheet.hidden = false; document.body.classList.add('sheet-open');
  setSheetHeight();
}

sheet.addEventListener('click', async e => {
  const li = e.target.closest('[data-pizza]');
  if (li) return openPizzaDetail(li.dataset.pizza);
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  const st = S.sheet;
  if (act === 'close') return closeSheet();
  if (act === 'add-pizza') return openPizzaForm({ restoId: st.id });
  if (act === 'resto-menu') return restoMenu(st.id);
  if (act === 'place-pizza' || act === 'place-add') {
    const pl = st.place;
    // Lieu placé à la main : il faut d'abord un nom
    if (!pl.name) {
      const r = await openRestoForm({ name: pl.suggest || '', address: pl.address, lat: pl.lat, lon: pl.lon, osm_id: pl.osm_id });
      if (!r) return;
      openResto(r.id);
      if (act === 'place-pizza') openPizzaForm({ restoId: r.id });
      return;
    }
    if (act === 'place-add') {
      try {
        const r = await guarded(() => store.addResto({ name: pl.name, address: pl.address || null, lat: pl.lat, lon: pl.lon, osm_id: pl.osm_id }));
        upsertResto(r); openResto(r.id); toast('Resto ajouté au guide');
      } catch (ex) { handleErr(ex); }
    } else openPizzaForm({ place: pl });
  }
});

function restoMenu(id) {
  const r = S.restos.get(id), n = pizzasOf(id).length;
  const m = openModal(`
    <h2>${esc(r.name)}</h2><p class="sub">${esc(r.address || '')}</p>
    <div style="display:grid;gap:8px">
      <button class="btn" data-a="edit">✏️ Renommer / modifier l'adresse</button>
      <button class="btn danger" data-a="del">🗑️ Supprimer ce resto${n ? ` et ses ${n} pizza${n > 1 ? 's' : ''}` : ''}</button>
      <button class="btn dark" data-a="close">Fermer</button>
    </div>`);
  m.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    m.close();
    if (a === 'edit') openRestoForm(r);
    if (a === 'del') {
      if (!(await confirmBox('Supprimer ce resto ?', n ? `Ses ${n} pizza${n > 1 ? 's' : ''} notée${n > 1 ? 's' : ''} disparaîtront aussi. Irréversible.` : 'Irréversible.'))) return;
      try { await guarded(() => store.deleteResto(id)); removeResto(id); closeSheet(); toast('Resto supprimé'); }
      catch (ex) { handleErr(ex); }
    }
  });
}

// Formulaire resto (création depuis un lieu placé à la main, ou modification)
function openRestoForm(r) {
  return new Promise(resolve => {
    let done = false;
    const editing = !!r.id;
    const m = openModal(`
      <h2>${editing ? 'Modifier le resto' : 'Nouveau resto'}</h2>
      <p class="sub">${editing ? '' : 'Placé à la main sur la carte.'}</p>
      <form>
        <div class="field"><label for="rf-name">Nom de l'établissement</label>
          <input id="rf-name" class="input" name="name" required maxlength="200" value="${esc(r.name || '')}" placeholder="Pizzeria Da Mario"></div>
        <div class="field"><label for="rf-addr">Adresse <span class="opt">(facultatif)</span></label>
          <input id="rf-addr" class="input" name="address" maxlength="300" value="${esc(r.address || '')}"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-a="cancel" style="flex:1">Annuler</button>
          <button type="submit" class="btn primary">Enregistrer</button>
        </div>
      </form>`, { onClose: () => { if (!done) resolve(null); } });
    const form = $('form', m.el);
    setTimeout(() => $('#rf-name', m.el).focus(), 50);
    $('[data-a=cancel]', m.el).onclick = () => m.close();
    form.onsubmit = async e => {
      e.preventDefault();
      const F = form.elements;
      const name = F.namedItem('name').value.trim(), address = F.namedItem('address').value.trim() || null;
      if (!name) return;
      const btn = $('[type=submit]', form); btn.disabled = true;
      try {
        const row = editing
          ? await guarded(() => store.updateResto(r.id, { name, address }))
          : await guarded(() => store.addResto({ name, address, lat: r.lat, lon: r.lon, osm_id: r.osm_id || null }));
        upsertResto(row); done = true; resolve(row); m.close();
        toast(editing ? 'Resto modifié' : 'Resto ajouté au guide');
      } catch (ex) { handleErr(ex); btn.disabled = false; }
    };
  });
}

// ---------------------------------------------------------------------
//  Photo : compression côté navigateur
// ---------------------------------------------------------------------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible (format non pris en charge ?)')); };
    img.src = url;
  });
}
function toJpeg(img, maxSide, quality, square = false) {
  const w = img.naturalWidth, h = img.naturalHeight;
  let sx = 0, sy = 0, sw = w, sh = h;
  if (square) { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; }
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
async function processPhoto(file) {
  const img = await loadImage(file);
  return { full: toJpeg(img, 1400, 0.8), thumb: toJpeg(img, 200, 0.72, true) };
}

// ---------------------------------------------------------------------
//  Formulaire pizza
// ---------------------------------------------------------------------
const CRITS = [
  { key: 'chevre', icon: '🐐', name: 'Le chèvre', hint: 'qualité, quantité' },
  { key: 'miel', icon: '🍯', name: 'Le miel', hint: 'ni trop, ni trop peu' },
  { key: 'pate', icon: '🍕', name: 'La pâte', hint: 'cuisson, croustillant' },
];

function openPizzaForm({ restoId = null, place = null, pizza = null }) {
  const editing = !!pizza;
  const rid = pizza?.resto_id || restoId;
  const r = rid ? S.restos.get(rid) : null;
  restoId = rid;                    // devient l'id du resto créé à la volée, même si l'écriture suivante échoue
  const restoName = r?.name || place?.name || '';
  const v = {
    name: pizza?.name ?? 'Chèvre-miel',
    note: pizza ? Number(pizza.note) : 7,
    chevre: pizza?.chevre ?? null, miel: pizza?.miel ?? null, pate: pizza?.pate ?? null,
    eaten_on: pizza?.eaten_on || todayISO(),
    prix: pizza?.prix ?? '', comment: pizza?.comment || '',
  };
  let photo = undefined;            // undefined = inchangée, null = supprimée, {full,thumb} = nouvelle
  let previewSrc = pizza?.thumb || null;

  const m = openModal(`
    <h2>${editing ? 'Modifier la note' : 'Nouvelle chèvre-miel'}</h2>
    <p class="sub">📍 ${esc(restoName)}</p>
    <form novalidate>
      <div class="field"><label for="pf-name">Nom sur la carte</label>
        <input id="pf-name" class="input" name="name" maxlength="120" value="${esc(v.name)}" placeholder="Chèvre-miel, la Montagnarde…"></div>

      <div class="field note-box">
        <div class="note-val"><span id="pf-note-val">${fmtNote(v.note)}</span><small>/10</small></div>
        <div class="note-label" id="pf-note-label">${noteLabel(v.note)}</div>
        <input class="note-range" type="range" name="note" min="0" max="10" step="0.5" value="${v.note}" aria-label="Note sur 10">
      </div>

      <div class="field"><span class="label">Dans le détail <span class="opt">(facultatif)</span></span>
        ${CRITS.map(c => `<div class="crit" data-crit="${c.key}">
          <div class="crit-name">${c.name}<small>${c.hint}</small></div>
          <div class="crit-icons">${[1, 2, 3, 4, 5].map(k => `<button type="button" data-v="${k}" aria-label="${c.name} : ${k} sur 5" class="${v[c.key] >= k ? 'on' : ''}">${c.icon}</button>`).join('')}</div>
        </div>`).join('')}
      </div>

      <div class="row">
        <div class="field"><label for="pf-date">Mangée le</label>
          <input id="pf-date" class="input" type="date" name="eaten_on" value="${esc(v.eaten_on)}" max="${todayISO()}" required></div>
        <div class="field"><label for="pf-prix">Prix <span class="opt">(€)</span></label>
          <input id="pf-prix" class="input" type="number" name="prix" inputmode="decimal" min="0" step="0.1" value="${esc(v.prix)}" placeholder="13,50"></div>
      </div>

      <div class="field"><label for="pf-com">Commentaire</label>
        <textarea id="pf-com" class="input" name="comment" maxlength="4000" placeholder="Le miel de lavande changeait tout. Pâte un peu molle au centre.">${esc(v.comment)}</textarea></div>

      <div class="field"><span class="label">Photo <span class="opt">(facultatif)</span></span>
        <div id="pf-photo"></div>
        <input type="file" accept="image/*" id="pf-file" hidden>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn" data-a="cancel" style="flex:1">Annuler</button>
        <button type="submit" class="btn primary">${editing ? 'Enregistrer' : 'Ajouter au guide'}</button>
      </div>
    </form>`);
  const form = $('form', m.el);

  // Note
  const range = form.elements.namedItem('note');
  range.addEventListener('input', () => {
    v.note = Number(range.value);
    $('#pf-note-val', m.el).textContent = fmtNote(v.note);
    $('#pf-note-label', m.el).textContent = noteLabel(v.note);
  });
  // Critères : re-toucher la même valeur l'efface
  $$('.crit', m.el).forEach(row => row.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const key = row.dataset.crit, k = Number(b.dataset.v);
    v[key] = v[key] === k ? null : k;
    $$('button', row).forEach(x => x.classList.toggle('on', v[key] >= Number(x.dataset.v)));
  }));
  // Photo
  const box = $('#pf-photo', m.el), file = $('#pf-file', m.el);
  function drawPhoto(busy = false) {
    if (busy) box.innerHTML = `<div class="photo-drop"><div class="spinner"></div> Préparation…</div>`;
    else if (previewSrc) box.innerHTML = `<div class="photo-prev"><img src="${esc(previewSrc)}" alt="Aperçu"><button type="button" data-a="rm-photo">Retirer</button></div>`;
    else box.innerHTML = `<label class="photo-drop" for="pf-file">📷 Prendre ou choisir une photo</label>`;
  }
  drawPhoto();
  // En modification, on affiche la vraie photo si elle existe
  if (editing && pizza.thumb) store.getPhoto(pizza.id).then(full => { if (full && photo === undefined) { previewSrc = full; drawPhoto(); } }).catch(() => {});
  box.addEventListener('click', e => {
    if (e.target.closest('[data-a=rm-photo]')) { photo = null; previewSrc = null; file.value = ''; drawPhoto(); }
  });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    drawPhoto(true);
    try { photo = await processPhoto(f); previewSrc = photo.full; }
    catch (ex) { toast(ex.message, true); }
    drawPhoto();
  });

  $('[data-a=cancel]', m.el).onclick = () => m.close();

  form.onsubmit = async e => {
    e.preventDefault();
    const F = form.elements;
    const prixRaw = String(F.namedItem('prix').value).replace(',', '.').trim();
    const row = {
      name: F.namedItem('name').value.trim() || 'Chèvre-miel',
      note: v.note,
      chevre: v.chevre, miel: v.miel, pate: v.pate,
      eaten_on: F.namedItem('eaten_on').value || todayISO(),
      prix: prixRaw === '' ? null : Math.max(0, Number(prixRaw)),
      comment: F.namedItem('comment').value.trim() || null,
    };
    if (row.prix != null && isNaN(row.prix)) row.prix = null;
    if (photo === null) row.thumb = null; else if (photo) row.thumb = photo.thumb;
    const photoArg = photo === undefined ? undefined : photo === null ? null : photo.full;

    const btn = $('[type=submit]', form);
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Enregistrement…';
    try {
      let saved;
      await guarded(async () => {
        if (!restoId && place) {          // lieu trouvé par la recherche : on crée le resto à la volée
          const nr = await store.addResto({ name: place.name, address: place.address || null, lat: place.lat, lon: place.lon, osm_id: place.osm_id });
          upsertResto(nr); restoId = nr.id;
        }
        saved = editing
          ? await store.updatePizza(pizza.id, row, photoArg)
          : await store.addPizza({ ...row, resto_id: restoId }, photoArg);
      });
      upsertPizza(saved);
      m.close();
      openResto(saved.resto_id, !editing);
      toast(editing ? 'Note modifiée' : `${fmtNote(saved.note)}/10 — c'est dans le guide 🍯`);
    } catch (ex) {
      handleErr(ex);
      btn.disabled = false; btn.textContent = editing ? 'Enregistrer' : 'Ajouter au guide';
    }
  };
}

// ---------------------------------------------------------------------
//  Fiche d'une pizza
// ---------------------------------------------------------------------
function openPizzaDetail(id) {
  const p = S.pizzas.find(x => x.id === id); if (!p) return;
  const r = S.restos.get(p.resto_id) || { name: '?' };
  const note = Number(p.note);
  const crits = CRITS.filter(c => p[c.key]);
  const m = openModal(`
    ${p.thumb ? `<div class="detail-photo"><img src="${esc(p.thumb)}" alt="" style="filter:blur(8px);transform:scale(1.05)"></div>` : ''}
    <div class="detail-head">
      ${p.thumb ? '' : thumbHtml({ name: r.name, big: true })}
      <div class="grow"><h2>${esc(p.name)}</h2><button class="resto-link" data-a="resto">${esc(r.name)} →</button></div>
      ${chipHtml(note, 'font-size:26px;padding:10px 12px')}
    </div>
    <p class="note-label" style="margin:0 0 10px">${noteLabel(note)}</p>
    <div class="detail-meta">
      <span class="tag">📅 ${fmtDate(p.eaten_on)}</span>
      ${p.prix != null ? `<span class="tag">💶 ${fmtPrix(Number(p.prix))}</span>` : ''}
    </div>
    ${crits.length ? `<div class="detail-crits">${crits.map(c => `<div class="crit"><div class="crit-name">${c.name}</div>
      <div class="crit-icons">${[1, 2, 3, 4, 5].map(k => `<span class="${p[c.key] >= k ? 'on' : ''}">${c.icon}</span>`).join('')}</div></div>`).join('')}</div>` : ''}
    <p class="detail-comment${p.comment ? '' : ' empty'}">${p.comment ? esc(p.comment) : 'Pas de commentaire.'}</p>
    <div class="modal-actions">
      <button class="btn danger" data-a="del" aria-label="Supprimer">🗑️</button>
      <button class="btn" data-a="edit" style="flex:1">✏️ Modifier</button>
      <button class="btn dark" data-a="close">Fermer</button>
    </div>`);
  if (p.thumb) {
    store.getPhoto(p.id).then(full => {
      const img = $('.detail-photo img', m.el);
      if (img && full) { img.src = full; img.style.filter = ''; img.style.transform = ''; }
    }).catch(() => {});
  }
  m.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'close') m.close();
    if (a === 'resto') { m.close(); closeDrawer(); openResto(p.resto_id, true); }
    if (a === 'edit') { m.close(); openPizzaForm({ pizza: p }); }
    if (a === 'del') {
      if (!(await confirmBox('Supprimer cette note ?', `${p.name} chez ${r.name}, ${fmtNote(note)}/10. Irréversible.`))) return;
      try { await guarded(() => store.deletePizza(p.id)); removePizza(p.id); m.close(); toast('Note supprimée'); }
      catch (ex) { handleErr(ex); }
    }
  });
}

// ---------------------------------------------------------------------
//  Tiroir : liste de toutes les pizzas
// ---------------------------------------------------------------------
const drawer = $('#drawer'), backdrop = $('#drawer-backdrop');
function openDrawer() { renderDrawer(); drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); backdrop.hidden = false; hideResults(); }
function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); backdrop.hidden = true; }
$('#btn-menu').onclick = openDrawer;
$('#btn-drawer-close').onclick = closeDrawer;
backdrop.onclick = closeDrawer;
$$('.sort-btn').forEach(b => b.onclick = () => { S.sort = b.dataset.sort; ls.set('gcm-sort', S.sort); renderDrawer(); });

function itemHtml(p, { showResto = true } = {}) {
  const r = S.restos.get(p.resto_id) || { name: '?' };
  return `<li class="item" data-pizza="${p.id}">
    ${thumbHtml({ img: p.thumb, name: r.name })}
    <div class="item-main">
      <div class="item-title">${esc(showResto ? r.name : p.name)}</div>
      <div class="item-sub">${showResto && norm(p.name) !== 'chevre-miel' ? esc(p.name) + ' · ' : ''}${fmtDate(p.eaten_on)}</div>
      ${p.comment ? `<div class="item-com">« ${esc(p.comment)} »</div>` : ''}
    </div>
    ${chipHtml(Number(p.note))}
  </li>`;
}

function renderDrawer() {
  $$('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === S.sort));
  const n = S.pizzas.length;
  const restosNotes = new Set(S.pizzas.map(p => p.resto_id)).size;
  $('#stats').innerHTML = `
    <div class="stat"><b>${n}</b><small>pizza${n > 1 ? 's' : ''}</small></div>
    <div class="stat"><b>${fmtNote(avg(S.pizzas))}</b><small>moyenne</small></div>
    <div class="stat"><b>${restosNotes}</b><small>resto${restosNotes > 1 ? 's' : ''}</small></div>`;
  const list = $('#pizza-list');
  if (!n) {
    list.innerHTML = `<li class="empty-state"><div class="big">🐐🍯</div><p>Aucune chèvre-miel notée.<br>Cherche une pizzeria en haut de la carte pour commencer.</p></li>`;
    return;
  }
  if (S.sort === 'resto') {
    const groups = [...new Set(S.pizzas.map(p => p.resto_id))].map(rid => ({ r: S.restos.get(rid) || { id: rid, name: '?' }, ps: pizzasOf(rid).sort(byDateDesc) }));
    groups.sort((a, b) => avg(b.ps) - avg(a.ps));
    list.innerHTML = groups.map(g => `<li class="group">${esc(g.r.name)} <span>${fmtNote(avg(g.ps))}/10</span></li>${g.ps.map(p => itemHtml(p, { showResto: false })).join('')}`).join('');
  } else {
    const ps = [...S.pizzas].sort(S.sort === 'note' ? (a, b) => b.note - a.note || byDateDesc(a, b) : byDateDesc);
    list.innerHTML = ps.map(p => itemHtml(p)).join('');
  }
}
$('#pizza-list').addEventListener('click', e => { const li = e.target.closest('[data-pizza]'); if (li) openPizzaDetail(li.dataset.pizza); });

// ---------------------------------------------------------------------
//  Mises à jour de l'état
// ---------------------------------------------------------------------
function refresh() { renderMarkers(); if (drawer.classList.contains('open')) renderDrawer(); if (S.sheet) renderSheet(); }
function upsertResto(r) { S.restos.set(r.id, r); refresh(); }
function removeResto(id) { S.restos.delete(id); S.pizzas = S.pizzas.filter(p => p.resto_id !== id); refresh(); }
function upsertPizza(p) { const i = S.pizzas.findIndex(x => x.id === p.id); if (i >= 0) S.pizzas[i] = p; else S.pizzas.push(p); refresh(); }
function removePizza(id) { S.pizzas = S.pizzas.filter(p => p.id !== id); refresh(); }

// ---------------------------------------------------------------------
//  Démarrage
// ---------------------------------------------------------------------
async function init() {
  if (CONFIG.PRENOM) {
    $('.kicker').textContent = `Le Guide de ${CONFIG.PRENOM}`;
    document.title = `Le Guide Chèvre-Miel de ${CONFIG.PRENOM}`;
  }
  if (DEMO) {
    store = new LocalStore();
    $('#demo-banner').hidden = false;
  } else {
    try {
      const { createClient } = await import(SUPABASE_JS);
      store = new SupaStore(createClient);
    } catch (e) {
      toast('Impossible de charger Supabase. Vérifie ta connexion.', true);
      console.error(e); return;
    }
    const foot = $('.drawer-foot');
    foot.insertAdjacentHTML('beforeend', ' <button id="btn-pin" style="border:0;background:none;color:var(--miel-fonce);font-size:12px;text-decoration:underline">Code secret</button>');
    $('#btn-pin').onclick = async () => { store.setPin(''); closeDrawer(); if (await askPin()) toast('Code enregistré'); };
  }
  try {
    const { restos, pizzas } = await store.loadAll();
    restos.forEach(r => S.restos.set(r.id, r));
    S.pizzas = pizzas;
  } catch (e) {
    console.error(e);
    toast('Impossible de charger le guide (projet Supabase en pause ?)', true);
  }
  renderMarkers();
  if (S.restos.size) {
    const b = L.latLngBounds([...S.restos.values()].map(r => [r.lat, r.lon]));
    map.fitBounds(b, { padding: [60, 60], maxZoom: 14 });
  }
  setTimeout(() => $('#hint').classList.add('gone'), 7000);
  window.__gcm = { S, store };   // pour déboguer dans la console
}
init();
