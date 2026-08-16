(() => {
  let chatHistory = [];
  let isSending = false;

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
    const widget = document.getElementById('cmo-chat-widget');
    if (!widget || !text || isSending) return;

    const projectId = widget.getAttribute('data-project-id');
    if (!projectId) return;

    const input = document.getElementById('cmo-chat-input');
    if (input) input.value = '';

    appendMessage('user', text);
    isSending = true;
    showTypingIndicator();

    try {
      const res = await fetch(`/projects/${projectId}/cmo-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          message: text,
          history: chatHistory.slice(-6)
        })
      });

      removeTypingIndicator();

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      appendMessage('assistant', data.reply || 'Analysis complete. Ready for next question.');
    } catch (err) {
      removeTypingIndicator();
      appendMessage('assistant', `⚠️ Sorry, I encountered a temporary connection issue: ${err.message}. Please try again.`);
    } finally {
      isSending = false;
    }
  }

  function initCmoChat() {
    const widget = document.getElementById('cmo-chat-widget');
    if (!widget) return;

    const triggerBtn = document.getElementById('cmo-chat-trigger-btn');
    const drawer = document.getElementById('cmo-chat-drawer');
    const closeBtn = document.getElementById('cmo-chat-close-btn');
    const form = document.getElementById('cmo-chat-form');
    const input = document.getElementById('cmo-chat-input');

    if (triggerBtn && drawer) {
      triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = drawer.classList.contains('is-open');
        if (isOpen) {
          drawer.classList.remove('is-open');
          drawer.setAttribute('aria-hidden', 'true');
          triggerBtn.setAttribute('aria-expanded', 'false');
        } else {
          drawer.classList.add('is-open');
          drawer.setAttribute('aria-hidden', 'false');
          triggerBtn.setAttribute('aria-expanded', 'true');
          if (input) setTimeout(() => input.focus(), 150);
        }
      });
    }

    if (closeBtn && drawer && triggerBtn) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        triggerBtn.setAttribute('aria-expanded', 'false');
      });
    }

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = input.value.trim();
        if (val) sendMessage(val);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const val = input.value.trim();
          if (val) sendMessage(val);
        }
      });
    }

    // Suggested prompt chips
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.cmo-prompt-chip');
      if (chip) {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt) sendMessage(prompt);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && drawer.classList.contains('is-open')) {
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initCmoChat);
  document.addEventListener('moyi:page-load', initCmoChat);
  document.addEventListener('moyi:after-page-swap', initCmoChat);

  if (document.readyState !== 'loading') {
    initCmoChat();
  }
})();
