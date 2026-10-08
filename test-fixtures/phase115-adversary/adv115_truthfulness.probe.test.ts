// Phase 115 adversarial probe - truthfulness invariants
// Run: npx vitest run --config test-fixtures/phase115-adversary/vitest.probe.config.ts

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import the actual modules for runtime checks
import { nonFillableFieldReason, isFillableFieldKind } from '../../src/renderer/forms/model';

const SRC_ROOT = path.resolve(__dirname, '../../src');

describe('Phase 115 truthfulness invariants', () => {
  
  // Vector 1: Required-summary honesty
  describe('Vector 1 - Required flag derivation', () => {
    it('REQUIRED_FLAG must be bit 2 (value 2), not bit 1 or inferred', () => {
      const formsSource = fs.readFileSync(
        path.join(SRC_ROOT, 'main/services/forms.ts'),
        'utf-8'
      );
      // Check that REQUIRED_FLAG is defined as 2
      const match = formsSource.match(/const\s+REQUIRED_FLAG\s*=\s*(\d+)/);
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('2');
    });

    it('getFormFields must set required only from REQUIRED_FLAG bit check', () => {
      const formsSource = fs.readFileSync(
        path.join(SRC_ROOT, 'main/services/forms.ts'),
        'utf-8'
      );
      // The required flag should only be set via bit flag check
      expect(formsSource).toMatch(/\(field\.acroField\.getFlags\(\)\s*&\s*REQUIRED_FLAG\)\s*!==\s*0/);
      // Should NOT infer required from name, label, or tooltip
      const getFormFieldsStart = formsSource.indexOf('export function getFormFields');
      const nextExport = formsSource.indexOf('export function', getFormFieldsStart + 1);
      const getFormFieldsFn = formsSource.slice(getFormFieldsStart, nextExport);
      expect(getFormFieldsFn).not.toMatch(/required\s*:\s*true\s*,\s*\/\//); // no commented-out inference
      expect(getFormFieldsFn).not.toMatch(/label.*required/);
    });
  });

  // Vector 2: No silent conversion  
  describe('Vector 2 - Unsupported field handling', () => {
    it('signature kind must have a truthful reason', () => {
      expect(nonFillableFieldReason('signature')).toBe('Signature fields cannot be filled');
    });

    it('orphan kind must have a truthful reason', () => {
      expect(nonFillableFieldReason('orphan')).toBe('Orphan widgets cannot be filled');
    });

    it('unknown kind must fall back to generic reason', () => {
      expect(nonFillableFieldReason('unknown-future-kind')).toBe('This field cannot be filled');
    });

    it('fillable kinds must return true', () => {
      expect(isFillableFieldKind('text')).toBe(true);
      expect(isFillableFieldKind('checkbox')).toBe(true);
      expect(isFillableFieldKind('radio')).toBe(true);
      expect(isFillableFieldKind('dropdown')).toBe(true);
      expect(isFillableFieldKind('listbox')).toBe(true);
    });

    it('signature must be non-fillable', () => {
      expect(isFillableFieldKind('signature')).toBe(false);
    });

    it('orphan must be non-fillable', () => {
      expect(isFillableFieldKind('orphan')).toBe(false);
    });
  });

  // Vector 3: Fill never flattens
  describe('Vector 3 - Fill/flatten separation', () => {
    it('GuidedFillPanel must not import or call flattenForm', () => {
      const panelSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/GuidedFillPanel.tsx'),
        'utf-8'
      );
      expect(panelSource).not.toContain('flattenForm');
      expect(panelSource).not.toMatch(/\bflatten\s*\(/);
    });

    it('FormFieldControl must not import or call flattenForm', () => {
      const controlSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/FormFieldControl.tsx'),
        'utf-8'
      );
      expect(controlSource).not.toContain('flattenForm');
      expect(controlSource).not.toMatch(/\bflatten\s*\(/);
    });

    it('GuidedFillPrimitives must not import or call flattenForm', () => {
      const primitivesSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/GuidedFillPrimitives.tsx'),
        'utf-8'
      );
      expect(primitivesSource).not.toContain('flattenForm');
      expect(primitivesSource).not.toMatch(/\bflatten\s*\(/);
    });
  });

  // Vector 4: No signature-validity claim
  describe('Vector 4 - No validity claims', () => {
    it('FieldProperties must not claim signature validity', () => {
      const propsSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/FieldProperties.tsx'),
        'utf-8'
      );
      // These strings would indicate a validity claim
      expect(propsSource).not.toContain('verified');
      expect(propsSource).not.toContain('legally binding');
      expect(propsSource).not.toContain('signature is valid');
    });

    it('model.ts must not claim signature validity', () => {
      const modelSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/model.ts'),
        'utf-8'
      );
      expect(modelSource).not.toContain('verified');
      expect(modelSource).not.toContain('legally binding');
    });

    it('FormFieldControl must not claim signature validity', () => {
      const controlSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/FormFieldControl.tsx'),
        'utf-8'
      );
      expect(controlSource).not.toContain('verified');
      expect(controlSource).not.toContain('legally binding');
    });
  });

  // Vector 5: No pixel/content change
  describe('Vector 5 - Fill does not alter PDF content', () => {
    it('fillFormField must only call field-specific setters', () => {
      const formsSource = fs.readFileSync(
        path.join(SRC_ROOT, 'main/services/forms.ts'),
        'utf-8'
      );
      // The fill path should only use these methods
      expect(formsSource).toContain('field.setText');
      expect(formsSource).toContain('field.check');
      expect(formsSource).toContain('field.uncheck');
      expect(formsSource).toContain('field.select');
      
      // Extract the fillFormField function
      const fillFunctionStart = formsSource.indexOf('export function fillFormField');
      const nextExport = formsSource.indexOf('export function', fillFunctionStart + 1);
      const fillFunction = formsSource.slice(fillFunctionStart, nextExport);
      
      // It should NOT call page.drawText or modify content streams directly
      expect(fillFunction).not.toContain('page.drawText');
      expect(fillFunction).not.toContain('page.insertText');
    });
  });

  // Vector 6: Seams reconciled
  describe('Vector 6 - Validation scope', () => {
    it('validateFieldValue must know only one rule (required + empty)', () => {
      const primitivesSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/GuidedFillPrimitives.tsx'),
        'utf-8'
      );
      // Extract the validateFieldValue function
      const fnStart = primitivesSource.indexOf('export function validateFieldValue');
      const fnEnd = primitivesSource.indexOf('}', primitivesSource.indexOf('{', fnStart)) + 1;
      const validateFn = primitivesSource.slice(fnStart, fnEnd);
      
      // Should only check required and emptiness
      expect(validateFn).toContain('field.required');
      expect(validateFn).toContain('fieldHasValue');
      // Should NOT check format, maxLength, email pattern, etc.
      expect(validateFn).not.toContain('maxLength');
      expect(validateFn).not.toContain('pattern');
      expect(validateFn).not.toContain('email');
      expect(validateFn).not.toMatch(/\bformat\b/);
    });

    it('FieldProperties must be read-only (no mutation handlers)', () => {
      const propsSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/FieldProperties.tsx'),
        'utf-8'
      );
      // Remove comments before checking
      const withoutComments = propsSource.replace(/\/\/.*$/gm, '');
      // Should have no onChange, no dispatch (the word "dispatches" in comments is ok)
      expect(withoutComments).not.toContain('onChange');
      expect(withoutComments).not.toContain('dispatch');
      expect(withoutComments).not.toMatch(/\bsetField\b/);
    });

    it('GuidedFillPanel must not have parallel forms store', () => {
      const panelSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/GuidedFillPanel.tsx'),
        'utf-8'
      );
      // Should import from model.ts, not create a new store
      expect(panelSource).toContain('from "./model"');
      expect(panelSource).not.toContain('createStore');
      expect(panelSource).not.toContain('useReducer');
    });
  });

  // Additional integrity checks
  describe('Vector 7 - Document/page scope separation', () => {
    it('RequiredSummary must compute document and page totals separately', () => {
      const primitivesSource = fs.readFileSync(
        path.join(SRC_ROOT, 'renderer/forms/GuidedFillPrimitives.tsx'),
        'utf-8'
      );
      // Look for the separate computation pattern
      expect(primitivesSource).toMatch(/documentCompleted[\s\S]*?pageCompleted/);
      // Should have separate data attributes for scope
      expect(primitivesSource).toContain('data-form-required-scope="document"');
      expect(primitivesSource).toContain('data-form-required-scope="page"');
    });
  });
});
