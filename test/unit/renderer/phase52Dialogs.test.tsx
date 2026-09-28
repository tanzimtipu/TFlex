// @vitest-environment jsdom
//
// Phase 52 — component-level checks for the new surfaces: the password
// prompt, the protection banner, the decrypted-save note and the Encrypt
// dialog. Mounted with the same raw react-dom/client + act pattern the other
// renderer tests use.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DocumentProtectionState } from '../../../src/shared/types';
import { PasswordPromptDialog } from '../../../src/renderer/components/PasswordPromptDialog';
import { ProtectionNotice } from '../../../src/renderer/components/ProtectionNotice';
import { EncryptDialog } from '../../../src/renderer/components/EncryptDialog';
import { SaveAsDialog } from '../../../src/renderer/components/SaveAsDialog';
import { ALL_PERMISSIONS_ALLOWED } from '../../../src/renderer/security/protection';

function mount(node: React.ReactElement): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const PROTECTION: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: 'AESV3',
  algorithm: 'AES-256',
  permissions: { ...ALL_PERMISSIONS_ALLOWED, copy: false },
};

describe('phase 52 — PasswordPromptDialog', () => {
  it('shows the prompt copy and forwards the typed password on submit', () => {
    const onSubmit = vi.fn();
    const { container, cleanup } = mount(
      <PasswordPromptDialog
        open
        target="secret.pdf"
        error={null}
        busy={false}
        attempts={0}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Password required');
    expect(container.textContent).toContain('secret.pdf');
    const input = container.querySelector<HTMLInputElement>('[data-password-input]');
    expect(input).not.toBeNull();
    act((): void => {
      setInputValue(input as HTMLInputElement, 'hunter2-not-in-the-ui');
    });
    act((): void => {
      (container.querySelector('[data-password-submit]') as HTMLButtonElement).click();
    });
    expect(onSubmit).toHaveBeenCalledWith('hunter2-not-in-the-ui');
    cleanup();
  });

  it('shows the inline incorrect message and never echoes the password', () => {
    const { container, cleanup } = mount(
      <PasswordPromptDialog
        open
        target="secret.pdf"
        error="That password did not open the document. Try again."
        busy={false}
        attempts={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('did not open');
    expect(container.textContent).not.toContain('hunter2-not-in-the-ui');
    cleanup();
  });
});

describe('phase 52 — ProtectionNotice', () => {
  it('reports the algorithm/revision, the permissions and the no-enforcement note', () => {
    const { container, cleanup } = mount(<ProtectionNotice protection={PROTECTION} />);
    const text = container.textContent ?? '';
    expect(text).toContain('AES-256');
    expect(text).toContain('/R 6');
    expect(text).toContain('/V 5');
    expect(text).toContain('/CFM AESV3');
    expect(text).toContain('Copy');
    expect(text).toContain('does not enforce');
    cleanup();
  });
});

describe('phase 52 — SaveAsDialog decrypted-save note', () => {
  it('renders the note only for a protected document', () => {
    const first = mount(
      <SaveAsDialog
        open
        saveAsLinearize={false}
        protectedDocument
        onSaveAsLinearizeChange={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(first.container.textContent).toContain(
      'Saving removes the protection. The saved file will open without a password.',
    );
    first.cleanup();

    const second = mount(
      <SaveAsDialog
        open
        saveAsLinearize={false}
        onSaveAsLinearizeChange={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(second.container.textContent).not.toContain('Saving removes the protection');
    second.cleanup();
  });
});

describe('phase 52 — EncryptDialog', () => {
  const defaults = {
    algorithm: 'aes-256' as const,
    permissions: { ...ALL_PERMISSIONS_ALLOWED },
  };

  it('defaults to AES-256 with every permission checked', () => {
    const { container, cleanup } = mount(
      <EncryptDialog open defaults={defaults} busy={false} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const aes256 = container.querySelector<HTMLInputElement>('[data-encrypt-algorithm="aes-256"]');
    const aes128 = container.querySelector<HTMLInputElement>('[data-encrypt-algorithm="aes-128"]');
    expect(aes256?.checked).toBe(true);
    expect(aes128?.checked).toBe(false);
    const perms = container.querySelectorAll<HTMLInputElement>('[data-encrypt-permission]');
    expect(perms).toHaveLength(8);
    for (const p of Array.from(perms)) expect(p.checked).toBe(true);
    cleanup();
  });

  it('blocks an empty user password and never echoes the input', () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = mount(
      <EncryptDialog open defaults={defaults} busy={false} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    act((): void => {
      (container.querySelector('[data-encrypt-confirm]') as HTMLButtonElement).click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector('[data-encrypt-error]')?.textContent).toContain(
      'user password',
    );
    expect(container.textContent).not.toContain('hunter2');
    cleanup();
  });

  it('confirms with the options + password-free defaults', () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = mount(
      <EncryptDialog open defaults={defaults} busy={false} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    const user = container.querySelector<HTMLInputElement>('[data-encrypt-user-password]');
    act((): void => {
      setInputValue(user as HTMLInputElement, 'hunter2-not-in-the-ui');
    });
    // Uncheck Copy via its permission checkbox.
    const copy = container.querySelector<HTMLInputElement>('[data-encrypt-permission="copy"]');
    act((): void => {
      (copy as HTMLInputElement).click();
    });
    act((): void => {
      (container.querySelector('[data-encrypt-confirm]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0] as {
      options: { userPassword: string; permissions: { copy: boolean } };
      defaults: unknown;
    };
    expect(arg.options.userPassword).toBe('hunter2-not-in-the-ui');
    expect(arg.options.permissions.copy).toBe(false);
    expect(JSON.stringify(arg.defaults)).not.toContain('hunter2-not-in-the-ui');
    cleanup();
  });
});
