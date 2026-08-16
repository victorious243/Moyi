(() => {
  let chatHistory = [];
  let isSending = false;

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('content')) {
      return meta.getAttribute('content');
    }
    if (document.body && document.body.dataset && document.body.dataset.csrfToken) {
      return document.body.dataset.csrfToken;
    }
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function parseMarkdown(text) {
    if (!text) return '';
    let html = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="cmo-msg-h3">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="cmo-msg-h2">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="cmo-msg-h1">$1</h2>');

    // Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Inline Code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Lists
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Paragraphs / line breaks
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
  }

  function appendMessage(role, content) {
    const messagesFeed = document.getElementById('cmo-chat-messages');
    if (!messagesFeed) return;

    const msgEl = document.createElement('div');
    msgEl.className = `cmo-message cmo-message-${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'cmo-message-avatar';
    avatar.textContent = role === 'user' ? 'YOU' : 'CMO';

    const body = document.createElement('div');
    body.className = 'cmo-message-content';
    body.innerHTML = role === 'user' ? `<p>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : parseMarkdown(content);

    msgEl.appendChild(avatar);
    msgEl.appendChild(body);
    messagesFeed.appendChild(msgEl);
    messagesFeed.scrollTop = messagesFeed.scrollHeight;

    chatHistory.push({ role, content });
  }

  function showTypingIndicator() {
    const messagesFeed = document.getElementById('cmo-chat-messages');
    if (!messagesFeed) return null;

    const indicator = document.createElement('div');
    indicator.className = 'cmo-message cmo-message-assistant cmo-typing-indicator';
    indicator.id = 'cmo-typing-indicator';
    indicator.innerHTML = `
      <div class="cmo-message-avatar">CMO</div>
      <div class="cmo-message-content">
        <div class="cmo-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesFeed.appendChild(indicator);
    messagesFeed.scrollTop = messagesFeed.scrollHeight;
    return indicator;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('cmo-typing-indicator');
    if (indicator) indicator.remove();
  }

  async function sendMessage(text) {
    if (!text || !text.trim() || isSending) return;

    const widget = document.getElementById('cmo-chat-widget');
    const projectId = widget ? widget.getAttribute('data-project-id') : '';

    const input = document.getElementById('cmo-chat-input');
    if (input) input.value = '';

    appendMessage('user', text);
    isSending = true;
    showTypingIndicator();

    const csrfToken = getCsrfToken();
    const endpoint = projectId ? `/projects/${projectId}/cmo-chat` : '/api/cmo-chat';

    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          projectId: projectId || undefined,
          history: chatHistory.slice(-6),
          _csrf: csrfToken
        })
      });

      removeTypingIndicator();

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      appendMessage('assistant', data.reply || 'Strategy analysis complete.');
    } catch (err) {
      removeTypingIndicator();
      appendMessage('assistant', `⚠️ Connection note: ${err.message}. Retrying fallback analysis.`);
    } finally {
      isSending = false;
    }
  }

  function toggleDrawer(forceOpen) {
    const drawer = document.getElementById('cmo-chat-drawer');
    const trigger = document.getElementById('cmo-chat-trigger-btn');
    if (!drawer) return;

    const shouldOpen = forceOpen !== undefined ? forceOpen : !drawer.classList.contains('is-open');
    if (shouldOpen) {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      const input = document.getElementById('cmo-chat-input');
      if (input) setTimeout(() => input.focus(), 150);
    } else {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // Document-level event delegation
  document.addEventListener('click', (e) => {
    // Trigger button click
    const trigger = e.target.closest('#cmo-chat-trigger-btn, .cmo-chat-trigger-btn');
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer();
      return;
    }

    // Close button click
    const closeBtn = e.target.closest('#cmo-chat-close-btn, .cmo-chat-close-btn');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer(false);
      return;
    }

    // Send button click
    const sendBtn = e.target.closest('#cmo-chat-send-btn');
    if (sendBtn) {
      e.preventDefault();
      const input = document.getElementById('cmo-chat-input');
      if (input && input.value.trim()) {
        sendMessage(input.value.trim());
      }
      return;
    }

    // Quick prompt chip click
    const chip = e.target.closest('.cmo-prompt-chip');
    if (chip) {
      e.preventDefault();
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) sendMessage(prompt);
      return;
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('#cmo-chat-form, .cmo-chat-form');
    if (form) {
      e.preventDefault();
      const input = form.querySelector('#cmo-chat-input, textarea');
      if (input && input.value.trim()) {
        sendMessage(input.value.trim());
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    // Enter without Shift submits chat
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'cmo-chat-input') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) sendMessage(val);
      return;
    }

    // Escape closes drawer
    if (e.key === 'Escape') {
      toggleDrawer(false);
    }
  });
})();
