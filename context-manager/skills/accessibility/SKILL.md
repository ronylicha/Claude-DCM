---
name: accessibility
description: "Comprehensive web accessibility skill: WCAG 2.1/2.2 auditing, ARIA implementation, screen reader testing (VoiceOver, NVDA, JAWS, TalkBack), inclusive design, keyboard navigation, and ADA/Section 508 compliance. Use when asked to audit, fix, or implement accessibility — a11y audit, WCAG compliance, screen reader support, keyboard navigation, or make accessible."
license: MIT
metadata:
  author: web-quality-skills
  version: "2.0"
---

# Accessibility (a11y)

Comprehensive accessibility skill covering WCAG 2.1/2.2 compliance, screen reader testing, ARIA patterns, keyboard navigation, and inclusive design. Goal: make content usable by everyone, including people with disabilities.

## When to Use This Skill

- Auditing websites for accessibility compliance (WCAG 2.1/2.2 Level AA/AAA)
- Fixing accessibility violations and errors
- Testing with screen readers (VoiceOver, NVDA, JAWS, TalkBack)
- Ensuring keyboard navigation works correctly
- Implementing ARIA attributes and landmarks
- Preparing for ADA or Section 508 compliance audits
- Designing inclusive user experiences
- Verifying form accessibility and dynamic content announcements

---

## WCAG Principles: POUR

| Principle | Description |
|-----------|-------------|
| **P**erceivable | Content can be perceived through different senses |
| **O**perable | Interface can be operated by all users |
| **U**nderstandable | Content and interface are understandable |
| **R**obust | Content works with assistive technologies |

## Conformance Levels

| Level | Requirement | Target |
|-------|-------------|--------|
| **A** | Minimum accessibility | Must pass |
| **AA** | Standard compliance | Should pass (legal requirement in many jurisdictions) |
| **AAA** | Enhanced accessibility | Nice to have |

---

## Perceivable

### Text Alternatives (1.1)

**Images require alt text:**
```html
<!-- Informative image -->
<img src="chart.png" alt="Bar chart showing 40% increase in Q3 sales">

<!-- Decorative image (empty alt) -->
<img src="decorative-border.png" alt="" role="presentation">

<!-- Complex image with longer description -->
<figure>
  <img src="infographic.png" alt="2024 market trends infographic"
       aria-describedby="infographic-desc">
  <figcaption id="infographic-desc">
    <!-- Detailed description -->
  </figcaption>
</figure>

<!-- Logo that links -->
<a href="/">
  <img src="/logo.png" alt="Company Name - Home">
</a>
```

**Alt text rules:**
- Informative images: Describe the content/function
- Decorative images: Use empty alt (`alt=""`)
- Functional images: Describe the action
- Complex images: Provide detailed description nearby

**Icon buttons need accessible names:**
```html
<!-- Using aria-label -->
<button aria-label="Open menu">
  <svg aria-hidden="true"><!-- menu icon --></svg>
</button>

<!-- Using visually hidden text -->
<button>
  <svg aria-hidden="true"><!-- menu icon --></svg>
  <span class="visually-hidden">Open menu</span>
</button>
```

**Visually hidden class:**
```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Color Contrast (1.4.3, 1.4.6, 1.4.11)

| Text Size | AA minimum | AAA enhanced |
|-----------|------------|--------------|
| Normal text (< 18px / < 14px bold) | 4.5:1 | 7:1 |
| Large text (>= 18px / >= 14px bold) | 3:1 | 4.5:1 |
| UI components & graphics | 3:1 | 3:1 |

```css
/* Sufficient contrast (7:1) */
.high-contrast {
  color: #333;
  background: #fff;
}

/* Focus states need contrast too */
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}
```

**Don't rely on color alone:**
```html
<!-- Color + icon + text -->
<div class="field-error">
  <input aria-invalid="true" aria-describedby="email-error">
  <span id="email-error" class="error-message">
    <svg aria-hidden="true"><!-- error icon --></svg>
    Please enter a valid email address
  </span>
</div>
```

### Media Alternatives (1.2)

```html
<!-- Video with captions -->
<video controls>
  <source src="video.mp4" type="video/mp4">
  <track kind="captions" src="captions.vtt" srclang="en" label="English" default>
  <track kind="descriptions" src="descriptions.vtt" srclang="en" label="Descriptions">
</video>

<!-- Audio with transcript -->
<audio controls>
  <source src="podcast.mp3" type="audio/mp3">
</audio>
<details>
  <summary>Transcript</summary>
  <p>Full transcript text...</p>
</details>
```

### Text Spacing (1.4.12)

No content loss with increased spacing:
- Line height 1.5x font size
- Paragraph spacing 2x font size
- Letter spacing 0.12x font size
- Word spacing 0.16x font size

---

## Operable

### Keyboard Accessible (2.1)

**All functionality must be keyboard accessible:**
```javascript
element.addEventListener('click', handleAction);
element.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleAction();
  }
});
```

**No keyboard traps - Modal focus management:**
```javascript
function openModal(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  // Store previous focus for restoration
  const previousFocus = document.activeElement;

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
    if (e.key === 'Escape') {
      closeModal();
      previousFocus.focus(); // Return focus
    }
  });

  firstElement.focus();
}
```

### Focus Visible (2.4.7)

```css
/* Use :focus-visible for keyboard-only focus */
:focus {
  outline: none;
}
:focus-visible {
  outline: 2px solid #005fcc;
  outline-offset: 2px;
}
button:focus-visible {
  box-shadow: 0 0 0 3px rgba(0, 95, 204, 0.5);
}
```

### Skip Links (2.4.1)

```html
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header><!-- navigation --></header>
  <main id="main-content" tabindex="-1">
    <!-- main content -->
  </main>
</body>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: #000;
  color: #fff;
  padding: 8px 16px;
  z-index: 100;
}
.skip-link:focus {
  top: 0;
}
```

### Motion (2.3)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Focus Not Obscured (2.4.11 - WCAG 2.2)

- Focused element must not be fully hidden
- Sticky headers/footers must not obscure focused elements

---

## Understandable

### Page Language (3.1.1)

```html
<html lang="en">
<!-- Language changes within page -->
<p>The French word for hello is <span lang="fr">bonjour</span>.</p>
```

### Form Labels (3.3.2)

```html
<!-- Explicit label -->
<label for="email">Email address</label>
<input type="email" id="email" name="email"
       autocomplete="email" required>

<!-- With instructions -->
<label for="password">Password</label>
<input type="password" id="password"
       aria-describedby="password-requirements">
<p id="password-requirements">
  Must be at least 8 characters with one number.
</p>
```

### Error Handling (3.3.1, 3.3.3)

```html
<form novalidate>
  <div class="field" aria-live="polite">
    <label for="email">Email</label>
    <input type="email" id="email"
           aria-invalid="true"
           aria-describedby="email-error">
    <p id="email-error" class="error" role="alert">
      Please enter a valid email address (e.g., name@example.com)
    </p>
  </div>
</form>
```

```javascript
// Focus first error on submit
form.addEventListener('submit', (e) => {
  const firstError = form.querySelector('[aria-invalid="true"]');
  if (firstError) {
    e.preventDefault();
    firstError.focus();
  }
});
```

---

## Robust

### Semantic HTML First (4.1.2)

```html
<!-- Prefer native elements over ARIA roles -->
<button>Click me</button>          <!-- NOT <div role="button"> -->
<label><input type="checkbox"> Option</label>  <!-- NOT <div role="checkbox"> -->
```

### ARIA Landmarks

```html
<header role="banner">
  <nav aria-label="Main navigation">...</nav>
</header>
<main role="main">
  <h1>Page Title</h1>
</main>
<aside role="complementary" aria-label="Related articles">...</aside>
<footer role="contentinfo">...</footer>
```

### ARIA States & Properties

**States:** `aria-checked`, `aria-disabled`, `aria-expanded`, `aria-hidden`, `aria-pressed`, `aria-selected`
**Properties:** `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-live`, `aria-required`, `aria-invalid`

### Custom Component: Tabs

```html
<div role="tablist" aria-label="Product information">
  <button role="tab" id="tab-1" aria-selected="true"
          aria-controls="panel-1">Description</button>
  <button role="tab" id="tab-2" aria-selected="false"
          aria-controls="panel-2" tabindex="-1">Reviews</button>
</div>
<div role="tabpanel" id="panel-1" aria-labelledby="tab-1">
  <!-- Panel content -->
</div>
<div role="tabpanel" id="panel-2" aria-labelledby="tab-2" hidden>
  <!-- Panel content -->
</div>
```

### Custom Component: Accordion

```html
<div class="accordion">
  <button aria-expanded="false" aria-controls="panel-1" id="accordion-1">
    Section 1
  </button>
  <div id="panel-1" role="region" aria-labelledby="accordion-1" hidden>
    Panel content
  </div>
</div>
```

### Custom Component: Accessible Modal/Dialog

```html
<div role="dialog" aria-modal="true"
     aria-labelledby="modal-title"
     aria-describedby="modal-desc">
  <h2 id="modal-title">Confirm Action</h2>
  <p id="modal-desc">Are you sure you want to delete this item?</p>
  <button>Confirm</button>
  <button>Cancel</button>
</div>
```

**Modal requirements:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, close on Escape, prevent background scroll, restore focus on close.

### Live Regions (4.1.3)

```html
<!-- Status updates (polite) -->
<div aria-live="polite" aria-atomic="true" class="status"></div>

<!-- Urgent alerts (assertive) -->
<div role="alert" aria-live="assertive"></div>

<!-- Progress -->
<div role="progressbar" aria-valuenow="75"
     aria-valuemin="0" aria-valuemax="100"
     aria-label="Upload progress"></div>
```

```javascript
function showNotification(message, type = 'polite') {
  const container = document.getElementById(`${type}-announcer`);
  container.textContent = '';
  requestAnimationFrame(() => {
    container.textContent = message;
  });
}
```

---

## Screen Reader Testing

### Major Screen Readers

| Screen Reader | Platform  | Browser        | Market Share |
|---------------|-----------|----------------|-------------|
| **JAWS**      | Windows   | Chrome/IE      | ~40% |
| **NVDA**      | Windows   | Firefox/Chrome | ~31% |
| **VoiceOver** | macOS/iOS | Safari         | ~15% |
| **TalkBack**  | Android   | Chrome         | ~10% |
| **Narrator**  | Windows   | Edge           | ~4%  |

### Screen Reader Modes

| Mode               | Purpose                | When Used         |
|--------------------|------------------------|-------------------|
| **Browse/Virtual** | Read content           | Default reading   |
| **Focus/Forms**    | Interact with controls | Filling forms     |
| **Application**    | Custom widgets         | ARIA applications |

### Testing Priority

```
Minimum Coverage:
1. NVDA + Firefox (Windows)
2. VoiceOver + Safari (macOS)
3. VoiceOver + Safari (iOS)

Comprehensive Coverage:
+ JAWS + Chrome (Windows)
+ TalkBack + Chrome (Android)
+ Narrator + Edge (Windows)
```

### VoiceOver Commands (macOS)

```
VO = Ctrl + Option (VoiceOver modifier)

Toggle:        Cmd + F5
Next element:  VO + Right Arrow
Prev element:  VO + Left Arrow
Activate:      VO + Space
Read all:      VO + A
Stop speaking: Ctrl
Rotor:         VO + U (Headings, Links, Forms, Landmarks)
Next heading:  VO + Cmd + H
Next form:     VO + Cmd + J
Next link:     VO + Cmd + L
```

### NVDA Commands (Windows)

```
Start:         Ctrl + Alt + N
Stop:          Insert + Q
NVDA modifier: Insert

Read all:      NVDA + Down Arrow
Current line:  NVDA + Up Arrow
Next heading:  H / Shift+H
Next form:     F
Next button:   B
Next link:     K
Next landmark: D / Shift+D
Elements list: NVDA + F7
Browse/Focus:  NVDA + Space (toggle)
```

### JAWS Commands (Windows)

```
Start:         Ctrl + Alt + J
Read all:      Insert + Down Arrow
Next heading:  H
Next table:    T
Next form:     F
Next button:   B
Next landmark: ; (semicolon)
Links list:    Insert + F7
Headings list: Insert + F6
```

### TalkBack Gestures (Android)

```
Explore:   Drag finger across screen
Next:      Swipe right
Previous:  Swipe left
Activate:  Double tap
Scroll:    Two-finger swipe
Reading controls: Swipe up then right
```

### Screen Reader Test Scenarios

1. **Page load** -- Title announced? Main landmark found? Skip link works?
2. **Heading navigation** -- Logical h1-h6 hierarchy? All sections discoverable?
3. **Form testing** -- Labels read with inputs? Errors announced? Focus moves to errors?
4. **Dynamic content** -- Alerts announced? Loading states communicated? Modals trap focus?
5. **Table navigation** -- Headers associated with cells? Navigation works?

---

## WCAG 2.2 Audit Process

### Step 1: Automated Scans

```bash
# axe-core
npx @axe-core/cli https://example.com

# Lighthouse
npx lighthouse https://example.com --only-categories=accessibility

# pa11y
npx pa11y https://example.com
```

```javascript
// axe-core in Playwright/Puppeteer
const axe = require('axe-core');
async function runAccessibilityAudit(page) {
  await page.addScriptTag({ path: require.resolve('axe-core') });
  const results = await page.evaluate(async () => {
    return await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }
    });
  });
  return results;
}
```

### Step 2: Manual Checks

- [ ] **Keyboard navigation:** Tab through entire page, Enter/Space to activate
- [ ] **Screen reader:** Test with VoiceOver or NVDA (see above)
- [ ] **Zoom:** Content usable at 200% zoom, reflow at 400%
- [ ] **High contrast:** Test with Windows High Contrast Mode
- [ ] **Reduced motion:** Test with `prefers-reduced-motion: reduce`
- [ ] **Focus order:** Logical and follows visual order
- [ ] **Skip links:** Present and functional
- [ ] **Focus indicators:** Visible on all interactive elements

### Step 3: Map Issues to WCAG Criteria

Map each finding to a WCAG criterion (e.g., 1.4.3 Contrast), severity (Critical/Serious/Moderate), and provide remediation guidance.

### Step 4: Re-test and Document

Re-test after fixes. Document residual risk and compliance status.

---

## Common Issues by Impact

### Critical (fix immediately)
1. Missing form labels
2. Missing image alt text
3. Insufficient color contrast
4. Keyboard traps
5. No focus indicators

### Serious (fix before launch)
1. Missing page language
2. Missing heading structure
3. Non-descriptive link text ("click here")
4. Auto-playing media
5. Missing skip links
6. Inaccessible modals (no focus trap)

### Moderate (fix soon)
1. Missing ARIA labels on icons
2. Inconsistent navigation
3. Missing error identification
4. Timing without controls
5. Missing landmark regions

---

## Accessibility Statement Template

```markdown
# Accessibility Statement

We are committed to ensuring digital accessibility for people with disabilities.

## Conformance Status
This website is partially conformant with WCAG 2.1 Level AA.

## Feedback
- Email: accessibility@example.com
- Phone: +1-555-0123

## Known Issues
- [List known accessibility issues and planned fixes]

Last updated: [Date]
```

## References

- [WCAG 2.2 Guidelines](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Deque axe Rules](https://dequeuniversity.com/rules/axe/)
- [WebAIM](https://webaim.org/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)
- [VoiceOver User Guide](https://support.apple.com/guide/voiceover/welcome/mac)
- [NVDA User Guide](https://www.nvaccess.org/files/nvda/documentation/userGuide.html)
- [JAWS Documentation](https://support.freedomscientific.com/Products/Blindness/JAWS)
- [WebAIM Screen Reader Survey](https://webaim.org/projects/screenreadersurvey/)
- See also: `references/WCAG.md`, `references/screen-reader-playbook.md`, `references/wcag-audit-playbook.md`
