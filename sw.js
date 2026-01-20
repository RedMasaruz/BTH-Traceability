// Service Worker for BTH Farmer Tracking System
const CACHE_NAME = 'bth-farmer-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Install event - cache essential resources
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        // Use addAll with error handling for individual files
        return Promise.allSettled(
          urlsToCache.map(url => cache.add(url).catch(err => {
            console.warn('[Service Worker] Failed to cache:', url, err);
            return null;
          }))
        );
      })
      .then(() => {
        console.log('[Service Worker] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] Cache failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome extension requests
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Check if we received a valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        // Cache the response asynchronously (don't await)
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          })
          .catch((error) => {
            console.warn('[Service Worker] Failed to cache response:', error);
          });

        return response;
      })
      .catch(() => {
        // Network request failed, try to get it from the cache
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              console.log('[Service Worker] Serving from cache:', event.request.url);
              return response;
            }
            
            // If not in cache and offline, return a basic offline page for navigation requests
            if (event.request.mode === 'navigate') {
              return new Response(
                `<!DOCTYPE html>
                <html lang="th">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>ออฟไลน์ - BTH Farmer</title>
                  <style>
                    body {
                      font-family: 'Noto Sans Thai', sans-serif;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      height: 100vh;
                      margin: 0;
                      background-color: #f5f8fa;
                      color: #333;
                    }
                    .offline-message {
                      text-align: center;
                      padding: 2rem;
                    }
                    .offline-icon {
                      font-size: 4rem;
                      margin-bottom: 1rem;
                    }
                    h1 {
                      color: #16a34a;
                      margin-bottom: 1rem;
                    }
                    p {
                      color: #666;
                    }
                  </style>
                </head>
                <body>
                  <div class="offline-message">
                    <div class="offline-icon">📡</div>
                    <h1>ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
                    <p>กรุณาตรวจสอบการเชื่อมต่อของคุณและลองใหม่อีกครั้ง</p>
                  </div>
                </body>
                </html>`,
                {
                  headers: { 'Content-Type': 'text/html; charset=utf-8' }
                }
              );
            }
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
