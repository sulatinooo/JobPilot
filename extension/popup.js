const API_URL = "https://hackathon-agent-503129348124.us-central1.run.app";

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Save Profile
document.getElementById('saveProfile').addEventListener('click', () => {
  const profile = {
    first_name: document.getElementById('firstName').value,
    last_name: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    linkedin_url: document.getElementById('linkedin').value,
    github_url: document.getElementById('github').value,
    city: document.getElementById('city').value,
    state: document.getElementById('state').value,
    country: document.getElementById('country').value,
    school: document.getElementById('school').value,
    degree: document.getElementById('degree').value,
    discipline: document.getElementById('discipline').value,
    start_month: document.getElementById('startMonth').value,
    start_year: document.getElementById('startYear').value,
    end_month: document.getElementById('endMonth').value,
    end_year: document.getElementById('endYear').value,
    authorized_to_work: document.getElementById('workAuth').value === 'yes',
    requires_sponsorship: document.getElementById('sponsorship').value === 'yes',
    returning_student: document.getElementById('returningStudent').value === 'yes',
    previously_worked: document.getElementById('previouslyWorked').value === 'no',
  };
  chrome.storage.local.set({ userProfile: profile }, () => {
    document.getElementById('profileSaved').classList.remove('hidden');
    setTimeout(() => document.getElementById('profileSaved').classList.add('hidden'), 2000);
  });
});

// Load saved profile
chrome.storage.local.get(['userProfile'], (data) => {
  if (data.userProfile) {
    const p = data.userProfile;
    document.getElementById('firstName').value = p.first_name || '';
    document.getElementById('lastName').value = p.last_name || '';
    document.getElementById('email').value = p.email || '';
    document.getElementById('phone').value = p.phone || '';
    document.getElementById('linkedin').value = p.linkedin_url || '';
    document.getElementById('github').value = p.github_url || '';
    document.getElementById('city').value = p.city || '';
    document.getElementById('state').value = p.state || '';
    document.getElementById('country').value = p.country || '';
    document.getElementById('school').value = p.school || '';
    document.getElementById('degree').value = p.degree || '';
    document.getElementById('discipline').value = p.discipline || '';
    document.getElementById('startMonth').value = p.start_month || '';
    document.getElementById('startYear').value = p.start_year || '';
    document.getElementById('endMonth').value = p.end_month || '';
    document.getElementById('endYear').value = p.end_year || '';
    document.getElementById('workAuth').value = p.authorized_to_work ? 'yes' : 'no';
    document.getElementById('sponsorship').value = p.requires_sponsorship ? 'yes' : 'no';
    document.getElementById('returningStudent').value = p.returning_student ? 'yes' : 'no';
    document.getElementById('previouslyWorked').value = p.previously_worked ? 'no' : 'yes';
  }
});

// Save Resume
document.getElementById('saveResume').addEventListener('click', () => {
  const latex = document.getElementById('resumeLatex').value;
  chrome.storage.local.set({ resumeLatex: latex }, () => {
    document.getElementById('resumeSaved').classList.remove('hidden');
    setTimeout(() => document.getElementById('resumeSaved').classList.add('hidden'), 2000);
  });
});

// Load saved resume
chrome.storage.local.get(['resumeLatex'], (data) => {
  if (data.resumeLatex) {
    document.getElementById('resumeLatex').value = data.resumeLatex;
  }
});

// Store results
let tailoredLatex = '';
let currentPdfId = '';
let currentFieldMapping = null;
let currentWrittenAnswers = null;

// Load previous results when popup opens
chrome.storage.local.get(['lastResults'], (data) => {
  if (data.lastResults) {
    displayResults(data.lastResults);
  }
});

function displayResults(result) {
  const results = document.getElementById('results');
  results.classList.remove('hidden');

  // Update gauge
  if (result.validation) {
    const confidence = result.validation.confidence || 0;
    const rotation = -90 + (confidence * 180);
    document.getElementById('needle').style.transform = `rotate(${rotation}deg)`;
    document.getElementById('validityLabel').textContent = result.validation.reason;
    document.getElementById('validityScore').textContent =
      `Score: ${result.validation.score}/${result.validation.max_score}`;

    const label = document.getElementById('validityLabel');
    if (confidence >= 0.6) label.style.color = '#4caf50';
    else if (confidence >= 0.4) label.style.color = '#ff9800';
    else label.style.color = '#ef5350';
  }

  // Show keywords
  if (result.keywords) {
    const section = document.getElementById('keywordsSection');
    section.classList.remove('hidden');
    const list = document.getElementById('keywordsList');
    list.innerHTML = '';
    const allKeywords = [
      ...(result.keywords.required_skills || []),
      ...(result.keywords.preferred_skills || []),
      ...(result.keywords.technologies || [])
    ];
    [...new Set(allKeywords)].forEach(kw => {
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.textContent = kw;
      list.appendChild(tag);
    });
  }

  // Show resume section
  if (result.tailored_resume) {
    tailoredLatex = result.tailored_resume.tailored_latex;
    document.getElementById('resumeSection').classList.remove('hidden');
  }

  if (result.pdf_available && result.pdf_id) {
    currentPdfId = result.pdf_id;
  }

  // Store field mapping for auto-fill
  if (result.field_mapping) {
    currentFieldMapping = result.field_mapping;
  }

  // Show auto-fill button if validation passed
  if (result.validation && result.validation.is_valid) {
    document.getElementById('fillSection').classList.remove('hidden');
  }
}

// Analyze button
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('analyzeBtn');
  const loading = document.getElementById('loading');
  const results = document.getElementById('results');
  const error = document.getElementById('error');

  // Reset
  results.classList.add('hidden');
  error.classList.add('hidden');
  loading.classList.remove('hidden');
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Get page text
    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.substring(0, 4000)
    });

    // Get form HTML from content script
    document.getElementById('loadingText').textContent = 'Capturing form data...';
    let formHTML = '';
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getFormHTML' });
      formHTML = response?.formHTML || '';
    } catch (e) {
      console.log('[Popup] No form HTML captured:', e.message);
    }

    // Get saved resume and profile
    const data = await new Promise(resolve => {
      chrome.storage.local.get(['resumeLatex', 'userProfile'], resolve);
    });

    if (!data.resumeLatex) {
      throw new Error('Please save your LaTeX resume in the Resume tab first.');
    }

    // Build form data
    const formData = new FormData();
    formData.append('job_text', pageText);
    formData.append('resume_latex', data.resumeLatex);
    formData.append('user_profile', JSON.stringify(data.userProfile || {}));
    formData.append('form_html', formHTML);

    // Send to backend
    document.getElementById('loadingText').textContent = 'Analyzing job posting...';
    const apiResponse = await fetch(`${API_URL}/process`, {
      method: 'POST',
      body: formData
    });

    if (!apiResponse.ok) throw new Error('Backend error: ' + apiResponse.statusText);

    const result = await apiResponse.json();

    // Save results
    chrome.storage.local.set({ lastResults: result });

    // Store field mapping and written answers
    currentFieldMapping = result.field_mapping || null;
    currentWrittenAnswers = result.written_answers || null;

    loading.classList.add('hidden');
    displayResults(result);

  } catch (err) {
    loading.classList.add('hidden');
    error.classList.remove('hidden');
    document.getElementById('errorText').textContent = err.message;
  }

  btn.disabled = false;
});

// Download PDF
document.getElementById('downloadBtn').addEventListener('click', async () => {
  // Check for base64 PDF in last results
  const data = await new Promise(resolve => {
    chrome.storage.local.get(['lastResults'], resolve);
  });

  const pdfBase64 = data.lastResults?.pdf_base64;

  if (pdfBase64) {
    const byteCharacters = atob(pdfBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tailored_resume.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } else if (tailoredLatex) {
    // Fallback to .tex
    const blob = new Blob([tailoredLatex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tailored_resume.tex';
    a.click();
    URL.revokeObjectURL(url);
  }
});

// Copy LaTeX
document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(tailoredLatex).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy LaTeX', 2000);
  });
});

// Auto-fill button
document.getElementById('fillBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const data = await new Promise(resolve => {
    chrome.storage.local.get(['userProfile'], resolve);
  });

  if (!data.userProfile) {
    alert('Please fill in your profile first.');
    return;
  }

  const profile = data.userProfile;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: (profile) => {

      function fillInput(element, value) {
        if (!value) return;
        element.focus();
        element.click();
        const nativeSetter = Object.getOwnPropertyDescriptor(
          element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      function fillReactSelect(inputElement, value) {
        if (!value) return;
        inputElement.focus();
        inputElement.click();
        fillInput(inputElement, value);
        // Wait for dropdown to appear then click first match
        setTimeout(() => {
          const options = document.querySelectorAll('[class*="option"], [id*="option"], [role="option"]');
          for (const opt of options) {
            if (opt.textContent.toLowerCase().includes(value.toLowerCase())) {
              opt.click();
              return;
            }
          }
          // If no option found, try pressing Enter
          inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }, 300);
      }

      function selectOption(element, value) {
        if (!value || element.tagName !== 'SELECT') return;
        const valueLower = value.toLowerCase().trim();
        const options = Array.from(element.options);
        let match = options.find(opt => opt.value.toLowerCase() === valueLower)
          || options.find(opt => opt.text.toLowerCase().trim() === valueLower)
          || options.find(opt => opt.text.toLowerCase().includes(valueLower));
        if (!match && (valueLower === 'true' || valueLower === 'yes'))
          match = options.find(opt => /^yes$/i.test(opt.text.trim()));
        if (!match && (valueLower === 'false' || valueLower === 'no'))
          match = options.find(opt => /^no$/i.test(opt.text.trim()));
        if (match) {
          element.value = match.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      function checkBox(element) {
        if (!element.checked) {
          element.click();
        }
      }

      // Field mapping with all profile fields
      const fieldMap = {
        'first.?name': { value: profile.first_name, type: 'input' },
        'last.?name': { value: profile.last_name, type: 'input' },
        'preferred': { value: profile.first_name, type: 'input' },
        'email': { value: profile.email, type: 'input' },
        'phone|mobile|tel': { value: profile.phone, type: 'input' },
        'linkedin': { value: profile.linkedin_url, type: 'input' },
        'github': { value: profile.github_url, type: 'input' },
        'country': { value: profile.country, type: 'react-select' },
        'candidate.?location|location.?city|city': { value: profile.city, type: 'react-select' },
        'school': { value: profile.school, type: 'react-select' },
        'degree': { value: profile.degree, type: 'react-select' },
        'discipline|major': { value: profile.discipline, type: 'react-select' },
        'start.?month': { value: profile.start_month, type: 'react-select' },
        'start.?year': { value: profile.start_year, type: 'input' },
        'end.?month': { value: profile.end_month, type: 'react-select' },
        'end.?year': { value: profile.end_year, type: 'input' },
      };

      // Yes/No question patterns
      const yesNoMap = {
        'sponsor': profile.requires_sponsorship ? 'Yes' : 'No',
        'authorized|authorization|eligible|legally': profile.authorized_to_work ? 'Yes' : 'No',
        'previously.?work|worked.?for|former': profile.previously_worked ? 'Yes' : 'No',
        'returning.?to.?school|undergraduate|graduate.?after|student.?after': profile.returning_student ? 'Yes' : 'No',
      };

      const inputs = document.querySelectorAll('input, textarea, select');
      let filled = 0;

      inputs.forEach(input => {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
        const labelText = (labelEl?.textContent || '').toLowerCase();
        const searchText = `${name} ${id} ${ariaLabel} ${placeholder} ${labelText}`;

        // Skip if already filled
        if (input.value && input.value.length > 0) return;

        // Match against field map
        for (const [pattern, config] of Object.entries(fieldMap)) {
          if (config.value && new RegExp(pattern, 'i').test(searchText)) {
            if (config.type === 'react-select' && input.getAttribute('role') === 'combobox') {
              fillReactSelect(input, config.value);
            } else if (input.tagName === 'SELECT') {
              selectOption(input, config.value);
            } else {
              fillInput(input, config.value);
            }
            filled++;
            break;
          }
        }

        // Match yes/no questions
        for (const [pattern, value] of Object.entries(yesNoMap)) {
          if (new RegExp(pattern, 'i').test(searchText)) {
            if (input.getAttribute('role') === 'combobox') {
              fillReactSelect(input, value);
            } else if (input.tagName === 'SELECT') {
              selectOption(input, value);
            }
            filled++;
            break;
          }
        }
      });

      // Handle checkboxes (acknowledgment/confirmation)
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        const labelEl = cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null;
        const labelText = (labelEl?.textContent || '').toLowerCase();
        const desc = (cb.getAttribute('description') || '').toLowerCase();
        if (/acknowledge|confirm|privacy|policy|agree/i.test(`${labelText} ${desc}`)) {
          checkBox(cb);
          filled++;
        }
      });
// Attach resume PDF if available
      // This is handled separately since file inputs need special treatment
      const notif = document.createElement('div');
      notif.textContent = `Auto-fill complete: ${filled} fields filled. Please review before submitting.`;
      notif.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:#1a1a2e;color:#4fc3f7;padding:16px 24px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #4fc3f7;';
      document.body.appendChild(notif);
      setTimeout(() => notif.remove(), 4000);
    },
    args: [profile]
  });
});