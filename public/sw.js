self.addEventListener('push', function (event) {
  let payload = {
    title: 'TechHaven US Breaking News',
    body: 'Tap to read the latest US & Europe tech update.',
    url: '/'
  };
  try {
    if (event.data) {
      payload = Object.assign(payload, event.data.json());
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'techhaven-breaking',
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
