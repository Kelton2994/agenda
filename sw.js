// Service worker: deixa o app instalável e abre rápido
const CACHE = 'agenda-v3';
const ARQUIVOS = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Sempre tenta a internet primeiro (pega a versão nova); sem internet usa o cache
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const permitido = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (req.method !== 'GET' || !permitido) return;
  e.respondWith(
    fetch(req)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return r;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});

// Notificação chegando do servidor (funciona com o app fechado)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: 'Lembrete', corpo: e.data ? e.data.text() : '' }; }
  const alarme = d.tipo === 'alarme';
  const opcoes = {
    body: d.corpo || '',
    icon: 'icons/icon-192.png',
    tag: d.id || 'agenda',
    renotify: true,
    requireInteraction: alarme,
    vibrate: alarme ? [800, 250, 800, 250, 800, 250, 1200] : [200, 100, 200],
    data: d,
    actions: alarme
      ? [{ action: 'adiar', title: '⏰ Adiar 10 min' }, { action: 'parar', title: '🔕 Parar alarme' }]
      : [{ action: 'adiar', title: 'Adiar 10 min' }, { action: 'concluir', title: '✓ Concluir' }],
  };
  e.waitUntil(self.registration.showNotification(d.titulo || 'Lembrete', opcoes));
});

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();

  // Botões da notificação: avisa o servidor sem precisar abrir o app
  if (e.action && d.id && d.acaoUrl) {
    e.waitUntil(
      self.registration.pushManager.getSubscription()
        .then((sub) => fetch(d.acaoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: e.action, id: d.id, minutos: 10, endpoint: sub && sub.endpoint }),
        }))
        .catch(() => {})
    );
    return;
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => {
      if (cs.length) return cs[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
