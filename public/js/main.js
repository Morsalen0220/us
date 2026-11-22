(function () {
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('th_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    html.setAttribute('data-theme', savedTheme);
  }

  const SVG_MOON = '<svg class="lucide lucide-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  const SVG_SUN = '<svg class="lucide lucide-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const SVG_BELL = '<svg class="lucide lucide-bell" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const SVG_BELL_RING = '<svg class="lucide lucide-bell-ring" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/></svg>';
  const SVG_BOOKMARK = '<svg class="lucide lucide-bookmark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
  const SVG_BOOKMARK_FILLED = '<svg class="lucide lucide-bookmark-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/><path d="m9 10 2 2 4-4"/></svg>';

  const themeButtons = [document.getElementById('themeToggle'), ...document.querySelectorAll('.js-theme-toggle')].filter(Boolean);
  if (themeButtons.length) {
    const syncThemeUI = () => {
      const dark = html.getAttribute('data-theme') === 'dark';
      const icoSvg = dark ? SVG_SUN : SVG_MOON;
      const label = dark ? 'Light' : 'Dark';
      themeButtons.forEach((btn) => {
        const icoEl = btn.querySelector('.btn-ico');
        const labelEl = btn.querySelector('.btn-label');
        if (icoEl || labelEl) {
          if (icoEl) icoEl.innerHTML = icoSvg;
          if (labelEl) labelEl.textContent = label;
        } else {
          btn.innerHTML = `<span class="btn-ico">${icoSvg}</span><span class="btn-label">${label}</span>`;
        }
      });
    };
    syncThemeUI();
    themeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('th_theme', next);
        syncThemeUI();
      });
    });
  }

  const mobileBtn = document.getElementById('mobileMenuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const mobileBackdrop = document.getElementById('mobileDrawerBackdrop');
  const mobileCloseBtn = document.getElementById('mobileDrawerClose');

  function setMobileMenuOpen(open) {
    if (!mobileDrawer) return;
    mobileDrawer.classList.toggle('open', open);
    if (mobileBackdrop) {
      mobileBackdrop.classList.toggle('open', open);
      mobileBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    mobileDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (mobileBtn) mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('nav-open', open);
  }

  if (mobileBtn && mobileDrawer) {
    mobileBtn.addEventListener('click', () => {
      const next = !mobileDrawer.classList.contains('open');
      setMobileMenuOpen(next);
    });
    if (mobileCloseBtn) {
      mobileCloseBtn.addEventListener('click', () => setMobileMenuOpen(false));
    }
    if (mobileBackdrop) {
      mobileBackdrop.addEventListener('click', () => setMobileMenuOpen(false));
    }
    mobileDrawer.querySelectorAll('a[href]').forEach((link) => {
      link.addEventListener('click', () => setMobileMenuOpen(false));
    });
    let touchStartX = 0;
    let touchStartY = 0;
    mobileDrawer.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
    }, { passive: true });
    mobileDrawer.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = Math.abs(t.clientY - touchStartY);
      if (dx > 65 && dy < 80) setMobileMenuOpen(false);
    }, { passive: true });
  }

  const searchOverlay = document.getElementById('searchOverlay');
  const searchTrigger = document.getElementById('searchOpenBtn');
  const searchClose = document.getElementById('searchCloseBtn');
  const searchInput = document.getElementById('modalSearchInput');

  function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.add('open');
    if (searchInput) setTimeout(() => searchInput.focus(), 40);
  }

  function closeSearch() {
    if (searchOverlay) searchOverlay.classList.remove('open');
  }

  if (searchTrigger) searchTrigger.addEventListener('click', openSearch);
  if (searchClose) searchClose.addEventListener('click', closeSearch);
  if (searchOverlay) {
    searchOverlay.addEventListener('click', (e) => {
      if (e.target === searchOverlay) closeSearch();
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') {
      closeSearch();
      setMobileMenuOpen(false);
    }
  });

  const progressBar = document.getElementById('readProgress');
  const articleBody = document.getElementById('articleBody');
  if (progressBar && articleBody) {
    window.addEventListener('scroll', () => {
      const rect = articleBody.getBoundingClientRect();
      const total = articleBody.offsetHeight - window.innerHeight * 0.5;
      const walked = -rect.top;
      const pct = total > 0 ? Math.max(0, Math.min(100, (walked / total) * 100)) : 0;
      progressBar.style.width = `${pct.toFixed(1)}%`;
    }, { passive: true });
  }

  const copyBtn = document.getElementById('copyArticleLink');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        const old = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = old; }, 1800);
      } catch {}
    });
  }

  const printBtn = document.getElementById('printArticleBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  // Save Article Bookmarking (Read Later)
  function getSavedSlugs() {
    try {
      return JSON.parse(localStorage.getItem('th_saved_posts') || '[]');
    } catch {
      return [];
    }
  }

  const saveBtn = document.getElementById('saveArticleBtn');
  if (saveBtn) {
    const slug = saveBtn.dataset.slug;
    const postId = saveBtn.dataset.postId;
    const syncSaveBtn = () => {
      const saved = getSavedSlugs().includes(slug);
      saveBtn.innerHTML = `<span class="btn-ico">${saved ? SVG_BOOKMARK_FILLED : SVG_BOOKMARK}</span><span class="btn-label">${saved ? 'Saved' : 'Save'}</span>`;
      saveBtn.classList.toggle('voted', saved);
    };
    syncSaveBtn();
    saveBtn.addEventListener('click', async () => {
      const list = getSavedSlugs();
      const exists = list.includes(slug);
      const nextList = exists ? list.filter((s) => s !== slug) : [slug, ...list];
      localStorage.setItem('th_saved_posts', JSON.stringify(nextList.slice(0, 50)));
      syncSaveBtn();
      try {
        await fetch(`/api/articles/${postId}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: exists ? 'unsave' : 'save' })
        });
      } catch {}
    });
  }

  // Hydrate /saved page
  const savedContainer = document.getElementById('savedArticlesContainer');
  if (savedContainer) {
    const slugs = getSavedSlugs();
    if (!slugs.length) {
      savedContainer.innerHTML = '<div class="page-card"><p style="margin:0;">You have no saved articles yet. Click <strong>Save</strong> on any article to read it later.</p></div>';
    } else {
      fetch(`/api/posts/by-slugs?slugs=${encodeURIComponent(slugs.join(','))}`)
        .then((r) => r.json())
        .then((data) => {
          if (!data.posts || !data.posts.length) {
            savedContainer.innerHTML = '<div class="page-card"><p style="margin:0;">No saved articles available.</p></div>';
            return;
          }
          savedContainer.innerHTML = `<div class="posts-grid two-col">${data.posts.map((p) => `
            <article class="post-card">
              ${p.featured_image_thumb || p.featured_image ? `<a href="/article/${p.slug}" class="post-card-img"><img src="${p.featured_image_thumb || p.featured_image}" alt="${p.title}" loading="lazy"></a>` : ''}
              <div class="post-card-body">
                <h2 class="post-card-title"><a href="/article/${p.slug}">${p.title}</a></h2>
                <p class="post-card-excerpt">${p.excerpt}</p>
              </div>
            </article>
          `).join('')}</div>`;
        })
        .catch(() => {});
    }
  }

  // Article Helpful / Not Helpful Feedback
  const feedbackBar = document.getElementById('articleFeedbackBar');
  if (feedbackBar) {
    const postId = feedbackBar.dataset.postId;
    const voteKey = `th_voted_${postId}`;
    const msgEl = document.getElementById('feedbackStatus');
    feedbackBar.querySelectorAll('[data-vote]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (localStorage.getItem(voteKey)) {
          if (msgEl) msgEl.textContent = 'Thanks, your feedback was recorded.';
          return;
        }
        const vote = btn.dataset.vote;
        const res = await fetch(`/api/articles/${postId}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote })
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.setItem(voteKey, vote);
          btn.classList.add('voted');
          const yesEl = document.getElementById('yesCount');
          const noEl = document.getElementById('noCount');
          if (yesEl) yesEl.textContent = data.helpful_yes;
          if (noEl) noEl.textContent = data.helpful_no;
          if (msgEl) msgEl.textContent = 'Thank you for rating this article!';
        }
      });
    });
  }

  // AI Article Assistant
  const aiForm = document.getElementById('aiAssistantForm');
  if (aiForm) {
    const postId = aiForm.dataset.postId;
    const inputEl = document.getElementById('aiQuestionInput');
    const answerEl = document.getElementById('aiAnswerBox');

    function formatAiAnswerHtml(text) {
      const escaped = String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const lines = escaped.split(/\r?\n/);
      let html = '';
      let inList = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          if (inList) {
            html += '</ul>';
            inList = false;
          }
          continue;
        }
        const formatted = line
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');
        const bulletMatch = formatted.match(/^([-*•]|\d+\.)\s+(.+)/);
        if (bulletMatch) {
          if (!inList) {
            html += '<ul style="margin:0.45rem 0 0.55rem;padding-left:1.2rem;">';
            inList = true;
          }
          html += `<li style="margin-bottom:0.25rem;">${bulletMatch[2]}</li>`;
        } else {
          if (inList) {
            html += '</ul>';
            inList = false;
          }
          html += `<p style="margin:0 0 0.5rem;">${formatted}</p>`;
        }
      }
      if (inList) html += '</ul>';
      return html || '<p style="margin:0;">No response generated.</p>';
    }

    async function askAi(q) {
      if (!q.trim() || !answerEl) return;
      answerEl.style.display = 'block';
      answerEl.innerHTML = '<p style="margin:0;color:var(--text-soft);">Thinking...</p>';
      try {
        const res = await fetch(`/api/articles/${postId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        });
        const data = await res.json();
        if (!data.ok) {
          answerEl.textContent = data.error || 'Could not process question.';
          return;
        }
        answerEl.innerHTML = formatAiAnswerHtml(data.answer);
      } catch {
        answerEl.textContent = 'Assistant unavailable right now.';
      }
    }

    aiForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inputEl) askAi(inputEl.value);
    });

    document.querySelectorAll('[data-ai-prompt]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.aiPrompt;
        if (inputEl) inputEl.value = q;
        askAi(q);
      });
    });
  }

  // Personalized News Feed Preferences Form
  const prefForm = document.getElementById('prefsForm');
  if (prefForm) {
    prefForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const categories = Array.from(prefForm.querySelectorAll('input[name="categories"]:checked')).map((i) => i.value);
      const regions = Array.from(prefForm.querySelectorAll('input[name="regions"]:checked')).map((i) => i.value);
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories, regions })
      });
      const data = await res.json();
      if (data.ok) window.location.reload();
    });
  }

  document.querySelectorAll('.js-newsletter-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = form.querySelector('input[name="email"]');
      const consentInput = form.querySelector('input[name="gdpr_consent"]');
      const msgEl = form.querySelector('.newsletter-msg');
      if (!emailInput) return;
      const gdprConsent = consentInput ? consentInput.checked : true;
      try {
        const res = await fetch('/api/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailInput.value,
            source: form.dataset.source || 'sidebar',
            gdpr_consent: gdprConsent
          })
        });
        const data = await res.json();
        if (msgEl) {
          msgEl.textContent = data.message || 'Subscribed!';
          if (data.confirmUrl) {
            const link = document.createElement('a');
            link.href = data.confirmUrl;
            link.textContent = ' Confirm Subscription Now →';
            link.style.color = '#93c5fd';
            link.style.fontWeight = '700';
            link.style.textDecoration = 'underline';
            msgEl.appendChild(link);
          }
        }
        if (data.ok) emailInput.value = '';
      } catch {
        if (msgEl) msgEl.textContent = 'Unable to subscribe right now.';
      }
    });
  });

  const banner = document.getElementById('cookieBanner');
  if (banner && !localStorage.getItem('th_consent')) {
    banner.classList.add('show');
    const acceptBtn = document.getElementById('cookieAccept');
    const essentialBtn = document.getElementById('cookieEssential');
    const saveConsent = (mode) => {
      localStorage.setItem('th_consent', mode);
      banner.classList.remove('show');
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', {
          ad_storage: mode === 'all' ? 'granted' : 'denied',
          ad_user_data: mode === 'all' ? 'granted' : 'denied',
          ad_personalization: mode === 'all' ? 'granted' : 'denied',
          analytics_storage: mode === 'all' ? 'granted' : 'denied'
        });
      }
    };
    if (acceptBtn) acceptBtn.addEventListener('click', () => saveConsent('all'));
    if (essentialBtn) essentialBtn.addEventListener('click', () => saveConsent('essential'));
  }

  // Lite YouTube / Shorts Facade Click-to-Play
  document.querySelectorAll('.yt-lite[data-yt-id]').forEach((box) => {
    box.addEventListener('click', () => {
      if (box.dataset.loaded === '1') return;
      box.dataset.loaded = '1';
      const id = box.dataset.ytId;
      const title = box.dataset.ytTitle || 'YouTube Video Player';
      const iframe = document.createElement('iframe');
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      const params = new URLSearchParams({
        autoplay: '1',
        rel: '0',
        playsinline: '1'
      });
      if (/^https?:\/\//i.test(window.location.origin)) {
        params.set('origin', window.location.origin);
      }
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
      iframe.title = title;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      box.innerHTML = '';
      box.appendChild(iframe);
    });
  });

  // Web Push Breaking News Subscription
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const pushButtons = [
    document.getElementById('pushAlertBtn'),
    document.getElementById('pushBannerBtn'),
    ...document.querySelectorAll('.js-push-toggle')
  ].filter(Boolean);
  if (pushButtons.length && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    const syncPushUI = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        const active = Boolean(sub);
        pushButtons.forEach((btn) => {
          btn.classList.toggle('push-active', active);
          const icoEl = btn.querySelector('.btn-ico');
          const labelEl = btn.querySelector('.btn-label');
          const icoSvg = active ? SVG_BELL_RING : SVG_BELL;
          if (icoEl || labelEl) {
            if (icoEl) icoEl.innerHTML = icoSvg;
            if (labelEl) {
              labelEl.textContent = btn.id === 'pushBannerBtn'
                ? (active ? 'Breaking Alerts On' : 'Enable Breaking Alerts')
                : (active ? 'Alerts On' : 'Alerts');
            }
          } else if (btn.id === 'pushBannerBtn') {
            btn.innerHTML = `<span class="btn-ico">${icoSvg}</span><span class="btn-label">${active ? 'Breaking Alerts On' : 'Enable Breaking Alerts'}</span>`;
          } else {
            btn.innerHTML = `<span class="btn-ico">${icoSvg}</span><span class="btn-label">${active ? 'Alerts On' : 'Alerts'}</span>`;
          }
        });
      } catch {}
    };
    syncPushUI();

    pushButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js');
          const existing = await reg.pushManager.getSubscription();
          if (existing) {
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: existing.endpoint })
            });
            await existing.unsubscribe();
            await syncPushUI();
            return;
          }

          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            alert('Please allow notifications in your browser settings to receive Breaking News alerts.');
            return;
          }

          const keyRes = await fetch('/api/push/vapid-key');
          const keyData = await keyRes.json();
          if (!keyData.ok || !keyData.publicKey) return;

          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
          });
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON())
          });
          await syncPushUI();
        } catch (err) {
          console.error('Push setup failed:', err);
        }
      });
    });
  }
})();
