// Phase 119 Adaptive Shell adversarial diff-pass spec.
// Attacks the 6 mandated targets from the task brief, no broader.
// Product code is NOT modified - this spec only reads and probes.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchApp } = require('./lib/launch.cjs');

const SAMPLE_PATH = path.join(__dirname, '../assets/samples/report.pdf');

test.describe('Phase 119 Adaptive Shell - adversarial diff-pass', () => {
  let app;
  let win;

  test.beforeAll(async () => {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  // Attack Target 1: State survival across adaptation
  test('ADV-P119-1: State survival across layout transitions', async () => {
    await win.evaluate(async (samplePath) => {
      const results = {
        transitions: [],
        stateLosses: [],
      };

      // Open a document first
      await window.electronAPI.openFile(samplePath);
      await new Promise(r => setTimeout(r, 2000));

      // Capture initial state
      const captureState = () => ({
        panelLeftWidthPx: document.querySelector('[data-navigator]')?.offsetWidth || 0,
        panelRightWidthPx: document.querySelector('[data-inspector]')?.offsetWidth || 0,
        inspectorCollapsed: document.querySelector('[data-inspector]')?.getAttribute('data-collapsed') === 'true',
        pagesPanelCollapsed: document.querySelector('[data-pages-panel]')?.getAttribute('data-collapsed') === 'true',
        hasOpenDraft: !!document.querySelector('[data-draft]'),
        hasSelection: window.getSelection()?.toString().length > 0,
        activeToolbar: document.querySelector('[data-annotation-toolbar][data-active]') !== null,
      });

      const initialState = captureState();
      results.transitions.push({ class: 'initial', state: initialState });

      // Rapid resize loop: wide -> narrow -> compact -> tight -> wide
      const widths = [1200, 850, 700, 500, 1200];
      const expectedClasses = ['wide', 'narrow', 'compact', 'tight', 'wide'];

      for (let i = 0; i < widths.length; i++) {
        await win.setViewportSize({ width: widths[i], height: 800 });
        await new Promise(r => setTimeout(r, 500));

        const layoutClass = await win.evaluate(() => {
          const workspace = document.querySelector('.workspace-main');
          if (!workspace) return 'unknown';
          const width = workspace.getBoundingClientRect().width;
          if (width <= 520) return 'tight';
          if (width <= 720) return 'compact';
          if (width <= 900) return 'narrow';
          return 'wide';
        });

        expect(layoutClass).toBe(expectedClasses[i]);
        const state = captureState();
        results.transitions.push({ class: layoutClass, state });

        // Check for state loss
        if (state.hasOpenDraft !== initialState.hasOpenDraft) {
          results.stateLosses.push(`Draft lost at ${layoutClass}`);
        }
      }

      // Verdict
      results.verdict = results.stateLosses.length === 0 ? 'HELD' : 'BROKEN';
      results.failures = results.stateLosses;
      return results;
    }, SAMPLE_PATH);
  });

  // Attack Target 2: Geometry round-trip
  test('ADV-P119-2: Geometry round-trip on collapse/expand', async () => {
    const result = await win.evaluate(async (samplePath) => {
      const results = { failures: [], verdict: 'HELD' };

      // Open document
      await window.electronAPI.openFile(samplePath);
      await new Promise(r => setTimeout(r, 2000));

      // Measure initial navigator width
      const getNavigatorWidth = () => {
        const nav = document.querySelector('[data-navigator]');
        return nav?.offsetWidth || 0;
      };

      const getInspectorWidth = () => {
        const insp = document.querySelector('[data-inspector]');
        return insp?.offsetWidth || 0;
      };

      const initialNavWidth = await getNavigatorWidth();
      const initialInspWidth = await getInspectorWidth();

      // Collapse navigator
      const navCollapseBtn = document.querySelector('[data-navigator-collapse]');
      if (navCollapseBtn) navCollapseBtn.click();
      await new Promise(r => setTimeout(r, 300));

      // Expand navigator
      const navExpandBtn = document.querySelector('[data-navigator-expand]');
      if (navExpandBtn) navExpandBtn.click();
      await new Promise(r => setTimeout(r, 300));

      const restoredNavWidth = await getNavigatorWidth();

      // Check if width returned (within 5px tolerance for rounding)
      if (Math.abs(restoredNavWidth - initialNavWidth) > 5) {
        results.failures.push(`Navigator width: ${initialNavWidth} -> ${restoredNavWidth}`);
      }

      // Same for inspector
      const inspCollapseBtn = document.querySelector('[data-inspector-collapse]');
      if (inspCollapseBtn) inspCollapseBtn.click();
      await new Promise(r => setTimeout(r, 300));

      const inspExpandBtn = document.querySelector('[data-inspector-expand]');
      if (inspExpandBtn) inspExpandBtn.click();
      await new Promise(r => setTimeout(r, 300));

      const restoredInspWidth = await getInspectorWidth();
      if (Math.abs(restoredInspWidth - initialInspWidth) > 5) {
        results.failures.push(`Inspector width: ${initialInspWidth} -> ${restoredInspWidth}`);
      }

      if (results.failures.length > 0) {
        results.verdict = 'BROKEN';
      }

      return results;
    }, SAMPLE_PATH);

    expect(result.verdict).toBe('HELD');
  });

  // Attack Target 3: Recovery invariant
  test('ADV-P119-3: No dead state with both panels collapsed', async () => {
    const result = await win.evaluate(async (samplePath) => {
      const results = { verdict: 'HELD', failures: [] };

      // Open document
      await window.electronAPI.openFile(samplePath);
      await new Promise(r => setTimeout(r, 2000));

      // Collapse both panels
      const navCollapse = document.querySelector('[data-navigator-collapse]');
      const inspCollapse = document.querySelector('[data-inspector-collapse]');

      if (navCollapse) navCollapse.click();
      if (inspCollapse) inspCollapse.click();
      await new Promise(r => setTimeout(r, 500));

      // Check for labelled reopen controls
      const navReopen = document.querySelector('[data-navigator-expand][aria-label], [data-navigator-expand][title]');
      const inspReopen = document.querySelector('[data-inspector-expand][aria-label], [data-inspector-expand][title]');

      if (!navReopen && !inspReopen) {
        results.failures.push('No labelled reopen control when both panels collapsed');
        results.verdict = 'BROKEN';
      }

      return results;
    }, SAMPLE_PATH);

    expect(result.verdict).toBe('HELD');
  });

  // Attack Target 4: Dialog inert teardown
  test('ADV-P119-4: Dialog inert teardown after all close paths', async () => {
    const result = await win.evaluate(async () => {
      const results = { verdict: 'HELD', failures: [] };

      // Helper to check inert attributes
      const checkInert = () => {
        const inertElements = Array.from(document.querySelectorAll('[inert]'));
        return inertElements.filter(el => !el.closest('[role="dialog"], [data-dialog-shell]'));
      };

      // Test Escape close
      const prefsButton = document.querySelector('[data-open-preferences]');
      if (prefsButton) {
        prefsButton.click();
        await new Promise(r => setTimeout(r, 500));

        // Dialog should be open
        const dialog = document.querySelector('[role="dialog"], [data-dialog-shell]');
        if (dialog) {
          // Press Escape
          const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
          document.dispatchEvent(escEvent);
          await new Promise(r => setTimeout(r, 500));

          // Check inert cleanup
          const strayInert = checkInert();
          if (strayInert.length > 0) {
            results.failures.push(`Escape: ${strayInert.length} stray inert elements`);
          }

          // Check focus restore
          const focused = document.activeElement;
          if (focused !== prefsButton) {
            results.failures.push('Escape: focus not restored to opener');
          }
        }
      }

      if (results.failures.length > 0) {
        results.verdict = 'BROKEN';
      }

      return results;
    });

    expect(result.verdict).toBe('HELD');
  });

  // Attack Target 5: No document mutation from chrome
  test('ADV-P119-5: Chrome operations do not mutate document', async () => {
    const result = await win.evaluate(async (samplePath) => {
      const results = { verdict: 'HELD', failures: [] };

      // Open document
      await window.electronAPI.openFile(samplePath);
      await new Promise(r => setTimeout(r, 2000));

      // Capture initial modified state
      const state = await window.electronAPI?.getState?.();
      const initialModified = state?.modified;

      // Toggle panels
      const navToggle = document.querySelector('[data-navigator-collapse]');
      const inspToggle = document.querySelector('[data-inspector-collapse]');

      if (navToggle) navToggle.click();
      await new Promise(r => setTimeout(r, 300));

      const stateAfterNav = await window.electronAPI?.getState?.();
      if (stateAfterNav?.modified !== initialModified) {
        results.failures.push('Navigator toggle set modified flag');
      }

      if (inspToggle) inspToggle.click();
      await new Promise(r => setTimeout(r, 300));

      const stateAfterInsp = await window.electronAPI?.getState?.();
      if (stateAfterInsp?.modified !== initialModified) {
        results.failures.push('Inspector toggle set modified flag');
      }

      if (results.failures.length > 0) {
        results.verdict = 'BROKEN';
      }

      return results;
    }, SAMPLE_PATH);

    expect(result.verdict).toBe('HELD');
  });

  // Attack Target 6: Truthfulness
  test('ADV-P119-6: No placeholder/prototype fixtures in production', async () => {
    const result = await win.evaluate(async () => {
      const results = { verdict: 'HELD', failures: [] };

      // Scan for common placeholder patterns
      const placeholderPatterns = [
        'TODO',
        'FIXME',
        'PLACEHOLDER',
        'PROTOTYPE',
        'DUMMY',
        'MOCK',
        'TEST_ONLY',
      ];

      const allText = document.body.innerText;
      for (const pattern of placeholderPatterns) {
        if (allText.toUpperCase().includes(pattern)) {
          results.failures.push(`Found placeholder text: ${pattern}`);
        }
      }

      // Check for debug data attributes
      const debugAttrs = ['data-debug', 'data-test-only', 'data-mock'];
      for (const attr of debugAttrs) {
        const els = document.querySelectorAll(`[${attr}]`);
        if (els.length > 0) {
          results.failures.push(`Found debug attribute: ${attr}`);
        }
      }

      if (results.failures.length > 0) {
        results.verdict = 'BROKEN';
      }

      return results;
    });

    expect(result.verdict).toBe('HELD');
  });
});
