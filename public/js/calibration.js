(() => {
  const form = document.querySelector('[data-calibration-form]');
  if (!form) return;

  const toneInput = form.querySelector('[data-calibration-tone]');
  const valuePropsInput = form.querySelector('[data-calibration-value-props]');
  const personasInput = form.querySelector('[data-calibration-personas]');
  const competitorsInput = form.querySelector('[data-calibration-competitors]');

  const toneList = document.querySelector('[data-tone-list]');
  const valuePropList = document.querySelector('[data-value-prop-list]');
  const personaGrid = document.querySelector('[data-persona-grid]');
  const competitorGrid = document.querySelector('[data-competitor-grid]');

  function safeParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function renderTone(items) {
    toneList.innerHTML = items.map((item) => `<span class="status">${item}</span>`).join('');
    toneInput.value = JSON.stringify(items);
  }

  function renderValueProps(items) {
    valuePropList.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
    valuePropsInput.value = JSON.stringify(items);
  }

  function renderPersonas(items) {
    personaGrid.innerHTML = items.map((persona) => `
      <article class="persona-card">
        <h3>${persona.name || ''}</h3>
        <p class="persona-role">${persona.role || ''}</p>
        <p>${persona.summary || ''}</p>
        <p class="small-label">Who they are</p>
        <p>${persona.demographics || ''}</p>
        <p class="small-label">Core objections</p>
        <ul class="clean-list">${(persona.objections || []).map((item) => `<li>${item}</li>`).join('')}</ul>
        <p class="small-label">Copy hooks</p>
        <ul class="clean-list">${(persona.copyHooks || []).map((item) => `<li>${item}</li>`).join('')}</ul>
      </article>
    `).join('');
    personasInput.value = JSON.stringify(items);
  }

  function renderCompetitors(items) {
    competitorGrid.innerHTML = items.map((competitor) => `
      <article class="recommendation-card">
        <div class="panel-title"><span class="status">${String(competitor.classification || 'direct').replace(/_/g, ' ')} / ${competitor.confidence ? `${competitor.confidence}% match` : 'review'}</span></div>
        <h3>${competitor.name || competitor.websiteUrl || ''}</h3>
        ${competitor.websiteUrl ? `<p><a href="${competitor.websiteUrl}" target="_blank" rel="noreferrer">${competitor.websiteUrl}</a></p>` : ''}
        <p>${competitor.rationale || 'Competitive context discovered during onboarding.'}</p>
        <p class="empty">${String(competitor.businessModel || 'other').replace(/_/g, ' ')} / ${String(competitor.locationRelevance || 'unknown').replace(/_/g, ' ')}</p>
      </article>
    `).join('');
    competitorsInput.value = JSON.stringify(items);
  }

  document.querySelectorAll('[data-dialog-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.getAttribute('data-dialog-open'));
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    });
  });

  document.querySelector('[data-save-dialog="tone-dialog"]')?.addEventListener('click', () => {
    const items = document.querySelector('[data-tone-editor]').value.split('\n').map((item) => item.trim()).filter(Boolean);
    renderTone(items);
    document.getElementById('tone-dialog').close();
  });

  document.querySelector('[data-save-dialog="value-props-dialog"]')?.addEventListener('click', () => {
    const items = document.querySelector('[data-value-props-editor]').value.split('\n').map((item) => item.trim()).filter(Boolean);
    renderValueProps(items);
    document.getElementById('value-props-dialog').close();
  });

  document.querySelector('[data-save-dialog="personas-dialog"]')?.addEventListener('click', () => {
    const items = safeParse(document.querySelector('[data-personas-editor]').value, []);
    if (Array.isArray(items) && items.length) {
      renderPersonas(items);
      document.getElementById('personas-dialog').close();
    }
  });

  document.querySelector('[data-save-dialog="competitors-dialog"]')?.addEventListener('click', () => {
    const items = safeParse(document.querySelector('[data-competitors-editor]').value, []);
    if (Array.isArray(items)) {
      renderCompetitors(items);
      document.getElementById('competitors-dialog').close();
    }
  });
})();
