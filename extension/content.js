// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getFormHTML') {
    // Capture all form-related HTML from the page
    const formHTML = captureFormHTML();
    sendResponse({ formHTML: formHTML });
  }

  if (message.action === 'autofill') {
    if (message.fieldMapping && message.fieldMapping.fields) {
      executeAIMapping(message.fieldMapping.fields);
    } else {
      regexFallback(message.profile);
    }
  }

  if (message.action === 'fillWrittenAnswers') {
    if (message.answers) {
      fillWrittenAnswers(message.answers);
    }
  }

  return true; // Keep message channel open for async
});

// ========== FORM HTML CAPTURE ==========

function captureFormHTML() {
  const forms = document.querySelectorAll('form');
  let html = '';
  
  if (forms.length > 0) {
    html = Array.from(forms).map(f => f.outerHTML).join('\n');
  } else {
    const inputs = document.querySelectorAll('input, textarea, select');
    if (inputs.length === 0) return '';
    const containers = new Set();
    inputs.forEach(input => {
      let parent = input.closest('form') || input.closest('[role="form"]') || input.closest('section') || input.parentElement?.parentElement;
      if (parent) containers.add(parent);
    });
    html = Array.from(containers).map(c => c.outerHTML).join('\n');
  }

  // Clean the HTML to reduce size
  html = cleanFormHTML(html);
  
  // Hard limit - if still too large, truncate
  if (html.length > 15000) {
    html = html.substring(0, 15000);
  }
  
  return html;
}

function cleanFormHTML(html) {
  // Remove SVG content
  html = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
  
  // Remove style attributes
  html = html.replace(/\sstyle="[^"]*"/gi, '');
  
  // Remove data attributes except data-testid
  html = html.replace(/\sdata-(?!testid)[a-z-]+="[^"]*"/gi, '');
  
  // Remove class attributes (keep id, name, for, type, aria-label, placeholder)
  html = html.replace(/\sclass="[^"]*"/gi, '');
  
  // Trim country/state dropdown options - keep only first 3 and last as indicator
  html = html.replace(/<ul[^>]*country-list[^>]*>[\s\S]*?<\/ul>/gi, '<ul>[country dropdown - options available]</ul>');
  
  // Remove hidden elements
  html = html.replace(/<[^>]*visually-hidden[^>]*>[\s\S]*?<\/[^>]*>/gi, '');
  
  // Remove excessive whitespace
  html = html.replace(/\s{2,}/g, ' ');
  
  return html;
}

// ========== AI MAPPING EXECUTOR ==========

function executeAIMapping(fields) {
  let filled = 0;
  let failed = 0;
  let skipped = 0;

  fields.forEach(field => {
    // Skip low confidence
    if (field.confidence && field.confidence < 0.5) {
      console.log(`[AutoFill] Skipped low confidence: ${field.name} (${field.confidence})`);
      skipped++;
      return;
    }

    try {
      const element = findElement(field.selector);
      if (!element) {
        console.log(`[AutoFill] Element not found: ${field.selector}`);
        failed++;
        return;
      }

      switch (field.action) {
        case 'fill':
          fillInput(element, field.value);
          filled++;
          break;
        case 'select':
          selectOption(element, field.value);
          filled++;
          break;
        case 'check':
          checkBox(element, field.value);
          filled++;
          break;
        case 'radio':
          selectRadio(element, field.value);
          filled++;
          break;
        case 'upload':
          console.log(`[AutoFill] File upload needed: ${field.name}`);
          skipped++;
          break;
        default:
          fillInput(element, field.value);
          filled++;
      }
    } catch (e) {
      console.error(`[AutoFill] Error filling ${field.name}:`, e);
      failed++;
    }
  });

  showNotification(`Auto-fill complete: ${filled} filled, ${skipped} skipped, ${failed} failed`);
  console.log(`[AutoFill] Summary: ${filled} filled, ${skipped} skipped, ${failed} failed`);
}

function findElement(selector) {
  // Try the selector directly
  let el = document.querySelector(selector);
  if (el) return el;

  // Try common variations
  if (selector.includes('[name=')) {
    const name = selector.match(/name=['"]?([^'"\]]+)/)?.[1];
    if (name) {
      el = document.querySelector(`[name="${name}"]`);
      if (el) return el;
    }
  }

  if (selector.includes('#')) {
    const id = selector.match(/#([^\s\[\.]+)/)?.[1];
    if (id) {
      el = document.getElementById(id);
      if (el) return el;
    }
  }

  return null;
}

function fillInput(element, value) {
  if (!value) return;

  // Focus the element
  element.focus();
  element.click();

  // Clear existing value
  element.value = '';

  // Use native input setter to work with React forms
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  if (element.tagName === 'TEXTAREA' && nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(element, value);
  } else if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Dispatch events that React and other frameworks listen for
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function selectOption(element, value) {
  if (!value || element.tagName !== 'SELECT') return;

  const options = Array.from(element.options);
  const valueLower = value.toLowerCase().trim();

  // Try exact value match
  let match = options.find(opt => opt.value.toLowerCase() === valueLower);

  // Try text match
  if (!match) match = options.find(opt => opt.text.toLowerCase().trim() === valueLower);

  // Try contains match
  if (!match) match = options.find(opt =>
    opt.text.toLowerCase().includes(valueLower) || valueLower.includes(opt.text.toLowerCase().trim())
  );

  // Try boolean mapping
  if (!match && (valueLower === 'true' || valueLower === 'yes')) {
    match = options.find(opt => /^yes$/i.test(opt.text.trim()));
  }
  if (!match && (valueLower === 'false' || valueLower === 'no')) {
    match = options.find(opt => /^no$/i.test(opt.text.trim()));
  }

  if (match) {
    element.value = match.value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    console.log(`[AutoFill] No matching option for "${value}" in select`);
  }
}

function checkBox(element, value) {
  const shouldCheck = value === true || value === 'true' || value === 'yes' || value === 'Yes';
  if (element.checked !== shouldCheck) {
    element.click();
  }
}

function selectRadio(element, value) {
  const valueLower = (value || '').toLowerCase().trim();
  const name = element.getAttribute('name');
  if (!name) return;

  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  radios.forEach(radio => {
    const radioValue = radio.value.toLowerCase().trim();
    const label = getLabel(radio).toLowerCase().trim();

    if (radioValue === valueLower || label.includes(valueLower)) {
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

// ========== WRITTEN ANSWERS ==========

function fillWrittenAnswers(answers) {
  let filled = 0;
  answers.forEach(answer => {
    try {
      const element = findElement(answer.selector);
      if (element) {
        fillInput(element, answer.answer);
        filled++;
      }
    } catch (e) {
      console.error(`[AutoFill] Error filling answer:`, e);
    }
  });
  showNotification(`Filled ${filled} written answers. Please review before submitting.`);
}

// ========== REGEX FALLBACK ==========

function regexFallback(profile) {
  if (!profile) return;

  const personal = profile.personal || profile;
  const links = profile.links || {};
  const location = profile.location || {};
  const workAuth = profile.work_auth || {};

  const fieldMap = {
    'first.?name': personal.first_name,
    'last.?name': personal.last_name,
    'full.?name': `${personal.first_name || ''} ${personal.last_name || ''}`.trim(),
    'preferred.?name': personal.preferred_name,
    'email': personal.email,
    'phone|mobile|tel': personal.phone,
    'linkedin': links.linkedin || personal.linkedin_url,
    'github': links.github || personal.github_url,
    'portfolio': links.portfolio,
    'website': links.website,
    'country': location.country,
    'state|province': location.state,
    'city': location.city,
    'street|address.?1': location.street_address_1,
    'address.?2|apt|suite': location.street_address_2,
    'zip|postal': location.zip_code,
  };

  const inputs = document.querySelectorAll('input, textarea, select');
  let filled = 0;

  inputs.forEach(input => {
    const searchText = `${input.name || ''} ${input.id || ''} ${getLabel(input)} ${input.placeholder || ''}`.toLowerCase();

    for (const [pattern, value] of Object.entries(fieldMap)) {
      if (value && new RegExp(pattern, 'i').test(searchText)) {
        if (input.tagName === 'SELECT') {
          selectOption(input, value);
        } else {
          fillInput(input, value);
        }
        filled++;
        break;
      }
    }

    if (/sponsor/i.test(searchText)) {
      handleYesNo(input, workAuth.requires_sponsorship);
    }
    if (/authorized|authorization|eligible/i.test(searchText)) {
      handleYesNo(input, workAuth.authorized_us);
    }
  });

  showNotification(`Regex fallback: filled ${filled} fields. Please review.`);
}

function handleYesNo(input, value) {
  const yes = value ? 'yes' : 'no';
  if (input.tagName === 'SELECT') {
    selectOption(input, yes);
  } else if (input.type === 'radio') {
    selectRadio(input, yes);
  }
}

// ========== HELPERS ==========

function getLabel(input) {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent;
  }
  const parentLabel = input.closest('label');
  if (parentLabel) return parentLabel.textContent;
  return input.getAttribute('aria-label') || '';
}

function showNotification(text) {
  const notif = document.createElement('div');
  notif.textContent = text;
  notif.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 99999;
    background: #1a1a2e; color: #4fc3f7; padding: 16px 24px;
    border-radius: 8px; font-family: -apple-system, sans-serif;
    font-size: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    border: 1px solid #4fc3f7;
  `;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 4000);
}