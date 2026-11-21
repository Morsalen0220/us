(function () {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function uploadImageToWebp(file, meta = {}) {
    const fd = new FormData();
    fd.append('image', file);
    if (meta.title) fd.append('title', meta.title);
    if (meta.alt_text) fd.append('alt_text', meta.alt_text);
    if (meta.caption) fd.append('caption', meta.caption);
    if (meta.description) fd.append('description', meta.description);

    const res = await fetch('/admin/api/media/upload', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      body: fd
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'WebP upload failed');
    }
    return data;
  }

  // Post Editor Logic
  const postForm = document.getElementById('postEditorForm');
  if (postForm) {
    const titleEl = document.getElementById('postTitle');
    const subtitleEl = document.getElementById('postSubtitle');
    const slugEl = document.getElementById('postSlug');
    const excerptEl = document.getElementById('postExcerpt');
    const contentEl = document.getElementById('postContent');
    const metaTitleEl = document.getElementById('metaTitle');
    const metaSubtitleEl = document.getElementById('metaSubtitle');
    const metaDescEl = document.getElementById('metaDesc');
    const metaTagsEl = document.getElementById('metaTags');
    const focusKwEl = document.getElementById('focusKeyword');
    const featImgEl = document.getElementById('featuredImage');
    const featThumbEl = document.getElementById('featuredImageThumb');
    const featWEl = document.getElementById('featuredImageWidth');
    const featHEl = document.getElementById('featuredImageHeight');
    const featTitleEl = document.getElementById('featuredImageTitle');
    const featAltEl = document.getElementById('featuredImageAlt');
    const featCaptionEl = document.getElementById('featuredImageCaption');
    const featDescEl = document.getElementById('featuredImageDescription');
    const featPreviewWrap = document.getElementById('featuredPreviewWrap');
    const featPreviewImg = document.getElementById('featuredPreviewImg');
    const uploadStatus = document.getElementById('featuredUploadStatus');

    let slugTouched = Boolean(slugEl && slugEl.value.trim());
    if (slugEl) {
      slugEl.addEventListener('input', () => {
        slugTouched = slugEl.value.trim().length > 0;
        updateSeoPreviewAndScore();
      });
    }

    if (titleEl) {
      titleEl.addEventListener('input', () => {
        if (!slugTouched && slugEl) {
          slugEl.value = slugify(titleEl.value);
        }
        updateSeoPreviewAndScore();
      });
    }

    function updateCounter(el, counterId, minGood, maxGood) {
      const target = document.getElementById(counterId);
      if (!el || !target) return;
      const len = el.value.trim().length;
      target.textContent = `${len} chars`;
      target.classList.remove('good', 'warn');
      if (len >= minGood && len <= maxGood) target.classList.add('good');
      else if (len > maxGood) target.classList.add('warn');
    }

    function updateSeoPreviewAndScore() {
      updateCounter(metaTitleEl, 'metaTitleCount', 45, 65);
      updateCounter(metaSubtitleEl, 'metaSubtitleCount', 40, 120);
      updateCounter(metaDescEl, 'metaDescCount', 120, 160);

      const serpTitle = document.getElementById('serpTitle');
      const serpUrl = document.getElementById('serpUrl');
      const serpDesc = document.getElementById('serpDesc');
      const siteUrl = postForm.dataset.siteUrl || 'https://techhavenus.com';

      const mTitle = (metaTitleEl?.value || titleEl?.value || 'Your Headline Preview').trim();
      const mSlug = (slugEl?.value || slugify(titleEl?.value) || 'article-slug').trim();
      const mDesc = (metaDescEl?.value || excerptEl?.value || 'Meta description preview for US & Europe Google search results...').trim();

      if (serpTitle) serpTitle.textContent = mTitle;
      if (serpUrl) serpUrl.textContent = `${siteUrl}/article/${mSlug}`;
      if (serpDesc) serpDesc.textContent = mDesc;

      // Live SEO Score
      const bodyText = contentEl?.value || '';
      const words = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
      const kw = (focusKwEl?.value || '').trim().toLowerCase();

      const checks = [
        { label: `Title & Meta Title set (${mTitle.length} chars, ideal 45–65)`, pass: mTitle.length >= 30 && mTitle.length <= 70 },
        { label: `Meta Description optimized (${mDesc.length} chars, ideal 120–160)`, pass: mDesc.length >= 100 && mDesc.length <= 165 },
        { label: `Meta Subtitle & Tags filled`, pass: Boolean((metaSubtitleEl?.value || subtitleEl?.value || '').trim()) && Boolean((metaTagsEl?.value || '').trim()) },
        { label: `Word count >= 300 words (current: ${words})`, pass: words >= 300 },
        { label: `Has H2 subheadings (## ) for Google featured snippets`, pass: /^##\s+/m.test(bodyText) },
        { label: `WebP Featured Image with Alt Text & Caption`, pass: Boolean(featImgEl?.value.trim()) && Boolean(featAltEl?.value.trim()) && Boolean(featCaptionEl?.value.trim()) },
        { label: kw ? `Focus keyword "${kw}" appears in title/meta/body` : 'Set a Focus Keyword to track keyword optimization', pass: kw ? (mTitle.toLowerCase().includes(kw) || bodyText.toLowerCase().includes(kw)) : false }
      ];

      const passed = checks.filter((c) => c.pass).length;
      const score = Math.round((passed / checks.length) * 100);
      const scoreEl = document.getElementById('seoScoreLabel');
      const fillEl = document.getElementById('seoMeterFill');
      const listEl = document.getElementById('seoChecklist');

      if (scoreEl) scoreEl.textContent = `${score}/100`;
      if (fillEl) {
        fillEl.style.width = `${score}%`;
        fillEl.style.background = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
      }
      if (listEl) {
        listEl.innerHTML = checks
          .map((c) => `<li class="${c.pass ? 'seo-check-pass' : 'seo-check-fail'}">${c.pass ? '✓' : '○'} ${c.label}</li>`)
          .join('');
      }
    }

    [subtitleEl, excerptEl, contentEl, metaTitleEl, metaSubtitleEl, metaDescEl, metaTagsEl, focusKwEl, featImgEl, featAltEl, featCaptionEl]
      .filter(Boolean)
      .forEach((el) => el.addEventListener('input', updateSeoPreviewAndScore));

    updateSeoPreviewAndScore();

    // Featured Image Upload + Auto WebP
    const featDropzone = document.getElementById('featuredDropzone');
    const featFileInput = document.getElementById('featuredFileInput');

    async function handleFeaturedUpload(file) {
      if (!file) return;
      if (uploadStatus) uploadStatus.textContent = `Converting ${file.name} to WebP...`;
      try {
        const res = await uploadImageToWebp(file, {
          title: featTitleEl?.value || titleEl?.value || '',
          alt_text: featAltEl?.value || titleEl?.value || '',
          caption: featCaptionEl?.value || '',
          description: featDescEl?.value || ''
        });
        const item = res.item;
        if (featImgEl) featImgEl.value = item.url;
        if (featThumbEl) featThumbEl.value = item.thumb_url;
        if (featWEl) featWEl.value = item.width;
        if (featHEl) featHEl.value = item.height;
        if (featTitleEl && !featTitleEl.value) featTitleEl.value = item.title;
        if (featAltEl && !featAltEl.value) featAltEl.value = item.alt_text;
        if (featDescEl && !featDescEl.value && item.description) featDescEl.value = item.description;
        if (featPreviewImg) featPreviewImg.src = item.url;
        if (featPreviewWrap) featPreviewWrap.style.display = 'block';
        if (uploadStatus) {
          const widthWarn = (Number(item.width) > 0 && Number(item.width) < 1200)
            ? ' <div style="margin-top:4px;color:#b45309;font-weight:600;">Note: Width is below 1200px — 1400 × 788 px (min 1200 × 675 px) is recommended for Google Discover.</div>'
            : '';
          uploadStatus.innerHTML = `<span class="badge badge-webp">Auto-WebP Ready</span> ${item.width}×${item.height} px • ${res.conversion.originalFormat.toUpperCase()} (${formatBytes(res.conversion.originalSize)}) → WebP (${formatBytes(res.conversion.webpSize)}, saved ${res.conversion.savingsPercent}%)${widthWarn}`;
        }
        updateSeoPreviewAndScore();
      } catch (err) {
        if (uploadStatus) uploadStatus.textContent = `Error: ${err.message}`;
      }
    }

    if (featDropzone && featFileInput) {
      featDropzone.addEventListener('click', () => featFileInput.click());
      featFileInput.addEventListener('change', (e) => handleFeaturedUpload(e.target.files[0]));
      featDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        featDropzone.classList.add('dragover');
      });
      featDropzone.addEventListener('dragleave', () => featDropzone.classList.remove('dragover'));
      featDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        featDropzone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFeaturedUpload(e.dataTransfer.files[0]);
      });
    }

    // Markdown Toolbar
    function wrapSelection(before, after, placeholder) {
      if (!contentEl) return;
      const start = contentEl.selectionStart;
      const end = contentEl.selectionEnd;
      const selected = contentEl.value.slice(start, end) || placeholder;
      const replacement = `${before}${selected}${after}`;
      contentEl.setRangeText(replacement, start, end, 'select');
      contentEl.focus();
      updateSeoPreviewAndScore();
    }

    document.querySelectorAll('[data-md-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.mdAction;
        if (act === 'h2') wrapSelection('\n## ', '\n', 'Section Heading');
        if (act === 'h3') wrapSelection('\n### ', '\n', 'Subheading');
        if (act === 'bold') wrapSelection('**', '**', 'bold text');
        if (act === 'italic') wrapSelection('*', '*', 'italic text');
        if (act === 'link') wrapSelection('[', '](https://techhavenus.com/)', 'anchor text');
        if (act === 'quote') wrapSelection('\n> ', '\n', 'Key takeaway quote');
        if (act === 'list') wrapSelection('\n- ', '\n- Second point\n', 'First key point');
        if (act === 'code') wrapSelection('\n```\n', '\n```\n', 'code snippet');
        if (act === 'youtube') wrapSelection('\n{{youtube:', '}}\n', 'https://www.youtube.com/watch?v=VIDEO_ID');
      });
    });

    // Media Picker Modal
    const modal = document.getElementById('mediaModal');
    const modalGrid = document.getElementById('mediaModalGrid');
    const modalUploadInput = document.getElementById('modalUploadInput');
    const modalTitleInput = document.getElementById('modalImgTitle');
    const modalAltInput = document.getElementById('modalImgAlt');
    const modalCaptionInput = document.getElementById('modalImgCaption');
    const modalDescInput = document.getElementById('modalImgDesc');
    let modalMode = 'insert';

    async function refreshModalMedia() {
      if (!modalGrid) return;
      modalGrid.innerHTML = '<p>Loading WebP library...</p>';
      const res = await fetch('/admin/api/media');
      const data = await res.json();
      if (!data.ok || !data.items.length) {
        modalGrid.innerHTML = '<p>No WebP images yet. Upload one above!</p>';
        return;
      }
      modalGrid.innerHTML = data.items.map((item) => `
        <div class="media-card">
          <img src="${item.thumb_url || item.url}" alt="${item.alt_text || ''}" loading="lazy">
          <div class="media-card-body">
            <div style="font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.title || item.filename}</div>
            <div style="color:#64748b;margin-bottom:8px;">${item.width}×${item.height} WebP • ${formatBytes(item.webp_size)}</div>
            <button type="button" class="btn btn-primary btn-sm js-pick-media"
              data-url="${item.url}"
              data-thumb="${item.thumb_url || item.url}"
              data-width="${item.width}"
              data-height="${item.height}"
              data-title="${(item.title || '').replace(/"/g, '&quot;')}"
              data-alt="${(item.alt_text || '').replace(/"/g, '&quot;')}"
              data-caption="${(item.caption || '').replace(/"/g, '&quot;')}"
              data-description="${(item.description || '').replace(/"/g, '&quot;')}"
            >${modalMode === 'featured' ? 'Set as Featured' : 'Insert Into Article'}</button>
          </div>
        </div>
      `).join('');

      modalGrid.querySelectorAll('.js-pick-media').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = btn.dataset;
          if (modalMode === 'featured') {
            if (featImgEl) featImgEl.value = d.url;
            if (featThumbEl) featThumbEl.value = d.thumb;
            if (featWEl) featWEl.value = d.width;
            if (featHEl) featHEl.value = d.height;
            if (featTitleEl && d.title) featTitleEl.value = d.title;
            if (featAltEl && d.alt) featAltEl.value = d.alt;
            if (featCaptionEl && d.caption) featCaptionEl.value = d.caption;
            if (featDescEl && d.description) featDescEl.value = d.description;
            if (featPreviewImg) featPreviewImg.src = d.url;
            if (featPreviewWrap) featPreviewWrap.style.display = 'block';
            updateSeoPreviewAndScore();
          } else if (contentEl) {
            const descAttr = d.description ? ` aria-description="${d.description}" data-description="${d.description}"` : '';
            const fig = `\n<figure>\n  <img src="${d.url}" alt="${d.alt || d.title}" title="${d.title || d.alt}"${descAttr} width="${d.width}" height="${d.height}" loading="lazy">\n  <figcaption>${d.caption || d.title || d.alt}</figcaption>\n</figure>\n`;
            const pos = contentEl.selectionStart || contentEl.value.length;
            contentEl.setRangeText(fig, pos, pos, 'end');
            updateSeoPreviewAndScore();
          }
          if (modal) modal.classList.remove('open');
        });
      });
    }

    const modalSizeHint = document.getElementById('mediaModalSizeHint');
    document.querySelectorAll('[data-open-media-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        modalMode = btn.dataset.openMediaModal || 'insert';
        if (modalSizeHint) {
          modalSizeHint.innerHTML = modalMode === 'featured'
            ? '<strong>Featured / Hero Cover Recommended Size:</strong> <code>1400 × 788 px</code> (16:9) — minimum <code>1200 × 675 px</code> for Google Discover &amp; Hero Banner.'
            : '<strong>In-Article Body Image Recommended Size:</strong> <code>1200 × 675 px</code> (16:9) or <code>1200 × 900 px</code> (4:3) — ideal width 800–1200 px.';
        }
        if (modal) modal.classList.add('open');
        refreshModalMedia();
      });
    });

    const closeModalBtn = document.getElementById('closeMediaModal');
    if (closeModalBtn && modal) {
      closeModalBtn.addEventListener('click', () => modal.classList.remove('open'));
    }

    if (modalUploadInput) {
      modalUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          await uploadImageToWebp(file, {
            title: modalTitleInput?.value || '',
            alt_text: modalAltInput?.value || '',
            caption: modalCaptionInput?.value || '',
            description: modalDescInput?.value || ''
          });
          modalUploadInput.value = '';
          refreshModalMedia();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    // Internal Link Suggestions
    const suggestBtn = document.getElementById('fetchInternalLinksBtn');
    const suggestBox = document.getElementById('internalLinkSuggestions');
    if (suggestBtn && suggestBox) {
      suggestBtn.addEventListener('click', async () => {
        const q = `${titleEl?.value || ''} ${metaTagsEl?.value || ''} ${focusKwEl?.value || ''}`;
        const postId = postForm.dataset.postId || '0';
        suggestBox.innerHTML = '<div style="font-size:0.8rem;color:#64748b;">Finding related articles...</div>';
        const res = await fetch(`/admin/api/seo/internal-links?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(postId)}`);
        const data = await res.json();
        if (!data.ok || !data.suggestions.length) {
          suggestBox.innerHTML = '<div style="font-size:0.8rem;color:#64748b;">No suggestions found yet.</div>';
          return;
        }
        suggestBox.innerHTML = data.suggestions.map((s) => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;padding:0.35rem 0;border-bottom:1px solid #e2e8f0;font-size:0.8rem;">
            <span>${s.title}</span>
            <button type="button" class="btn btn-outline btn-sm js-insert-int-link" data-title="${s.title.replace(/"/g, '&quot;')}" data-slug="${s.slug}">Insert</button>
          </div>
        `).join('');
        suggestBox.querySelectorAll('.js-insert-int-link').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!contentEl) return;
            const linkMd = `[${btn.dataset.title}](/article/${btn.dataset.slug})`;
            const pos = contentEl.selectionStart || contentEl.value.length;
            contentEl.setRangeText(linkMd, pos, pos, 'end');
            contentEl.focus();
          });
        });
      });
    }

    // YouTube URL Live Validation Hint
    const videoUrlEl = document.getElementById('videoUrl');
    const videoUrlHintEl = document.getElementById('videoUrlHint');
    function validateVideoUrlInput() {
      if (!videoUrlEl || !videoUrlHintEl) return;
      let val = videoUrlEl.value.trim();
      if (!val) {
        videoUrlHintEl.style.color = '#64748b';
        videoUrlHintEl.textContent = 'Supports youtube.com/watch?v=..., youtu.be/..., /shorts/..., or /embed/...';
        return;
      }
      if (!/^https?:\/\//i.test(val)) val = 'https://' + val;
      try {
        const u = new URL(val);
        const h = u.hostname.toLowerCase();
        const isYt = h.includes('youtube.com') || h.includes('youtu.be') || h.includes('youtube-nocookie.com');
        let vid = '';
        let isShort = false;
        if (h.includes('youtu.be')) {
          vid = u.pathname.replace(/^\/+/, '').split('/')[0] || '';
        } else if (u.pathname.startsWith('/shorts/')) {
          vid = u.pathname.split('/')[2] || '';
          isShort = true;
        } else if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/live/') || u.pathname.startsWith('/v/')) {
          vid = u.pathname.split('/')[2] || '';
        } else {
          vid = u.searchParams.get('v') || '';
        }
        if (isYt && /^[a-zA-Z0-9_-]{6,20}$/.test(vid)) {
          videoUrlHintEl.style.color = '#16a34a';
          videoUrlHintEl.textContent = `Valid YouTube ${isShort ? 'Short' : 'Video'} detected (ID: ${vid})`;
        } else {
          videoUrlHintEl.style.color = '#d97706';
          videoUrlHintEl.textContent = 'Could not detect a valid YouTube video ID. Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        }
      } catch {
        videoUrlHintEl.style.color = '#d97706';
        videoUrlHintEl.textContent = 'Invalid URL format. Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      }
    }
    if (videoUrlEl) {
      videoUrlEl.addEventListener('input', validateVideoUrlInput);
      validateVideoUrlInput();
    }

    // Dynamic Primary Publish CTA Label
    const postStatusEl = document.getElementById('postStatus');
    const primaryPublishBtn = document.getElementById('primaryPublishBtn');
    if (postStatusEl && primaryPublishBtn && primaryPublishBtn.value === 'publish') {
      const syncPublishLabel = () => {
        const s = postStatusEl.value;
        const iconSvg = '<svg class="lucide lucide-send" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg> ';
        if (s === 'scheduled') {
          primaryPublishBtn.innerHTML = iconSvg + 'Schedule Article';
        } else if (s === 'in_review') {
          primaryPublishBtn.innerHTML = iconSvg + 'Submit for Review';
        } else {
          primaryPublishBtn.innerHTML = iconSvg + 'Publish Article';
        }
      };
      postStatusEl.addEventListener('change', syncPublishLabel);
      syncPublishLabel();
    }

    // Draft Autosave (LocalStorage + Server API for existing articles)
    const autosaveLabel = document.getElementById('autosaveStatus');
    const postId = postForm.dataset.postId;
    const localKey = `th_draft_${postId || 'new'}`;
    let dirty = false;
    [titleEl, subtitleEl, contentEl].filter(Boolean).forEach((el) => {
      el.addEventListener('input', () => {
        dirty = true;
        if (autosaveLabel) autosaveLabel.textContent = 'Unsaved edits...';
      });
    });

    setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      localStorage.setItem(localKey, JSON.stringify({
        title: titleEl?.value || '',
        subtitle: subtitleEl?.value || '',
        content_md: contentEl?.value || '',
        ts: Date.now()
      }));
      if (postId) {
        try {
          const res = await fetch(`/admin/api/posts/${postId}/autosave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({
              title: titleEl?.value || '',
              subtitle: subtitleEl?.value || '',
              content_md: contentEl?.value || ''
            })
          });
          const data = await res.json();
          if (autosaveLabel) autosaveLabel.textContent = data.ok ? `Autosaved at ${data.savedAt}` : 'Saved locally';
        } catch {
          if (autosaveLabel) autosaveLabel.textContent = 'Saved locally';
        }
      } else if (autosaveLabel) {
        autosaveLabel.textContent = `Draft cached locally (${new Date().toLocaleTimeString('en-US')})`;
      }
    }, 20000);
  }

  // Standalone Media Library Page
  const mediaDropzone = document.getElementById('mediaLibraryDropzone');
  const mediaFileInput = document.getElementById('mediaLibraryInput');
  const mediaProgress = document.getElementById('mediaUploadProgress');

  if (mediaDropzone && mediaFileInput) {
    const handleBulkUpload = async (files) => {
      for (const file of files) {
        if (mediaProgress) mediaProgress.textContent = `Converting ${file.name} to WebP...`;
        try {
          await uploadImageToWebp(file, {
            title: document.getElementById('newMediaTitle')?.value || '',
            alt_text: document.getElementById('newMediaAlt')?.value || '',
            caption: document.getElementById('newMediaCaption')?.value || '',
            description: document.getElementById('newMediaDescription')?.value || ''
          });
        } catch (err) {
          alert(`Failed on ${file.name}: ${err.message}`);
        }
      }
      window.location.reload();
    };

    mediaDropzone.addEventListener('click', () => mediaFileInput.click());
    mediaFileInput.addEventListener('change', (e) => handleBulkUpload(e.target.files));
    mediaDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      mediaDropzone.classList.add('dragover');
    });
    mediaDropzone.addEventListener('dragleave', () => mediaDropzone.classList.remove('dragover'));
    mediaDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      mediaDropzone.classList.remove('dragover');
      handleBulkUpload(e.dataTransfer.files);
    });
  }

  document.querySelectorAll('.js-save-media-meta').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = form.dataset.id;
      const body = {
        title: form.querySelector('[name="title"]').value,
        alt_text: form.querySelector('[name="alt_text"]').value,
        caption: form.querySelector('[name="caption"]').value,
        description: form.querySelector('[name="description"]')?.value || ''
      };
      const res = await fetch(`/admin/api/media/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const statusEl = form.querySelector('.js-meta-status');
      if (statusEl) statusEl.textContent = data.ok ? 'Saved!' : (data.error || 'Error');
    });
  });

  document.querySelectorAll('.js-delete-media').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this WebP file permanently?')) return;
      const id = btn.dataset.id;
      const res = await fetch(`/admin/api/media/${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken }
      });
      const data = await res.json();
      if (data.ok) btn.closest('.media-card')?.remove();
    });
  });

  document.querySelectorAll('.js-copy-url').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1400);
      } catch {}
    });
  });
})();
