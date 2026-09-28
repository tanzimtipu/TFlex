// Phase 52 (feature B) — the truthful protection banner.
//
// Shown above the canvas when the active document is encrypted. It reports
// the cipher / revision read from the file and the permission flags the
// document asks for, and states plainly that TFlex does not enforce them.
// The document stays fully usable: nothing is hidden and no tool is greyed
// out (the phase ruling).
//
// The banner is a flow element inside the pane's document column; motion for
// its mount is the shared motion token set (see .protection-notice CSS).

import type { ReactElement } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { DocumentProtectionState } from '../../shared/types';
import {
  PROTECTION_ENFORCEMENT_TEXT,
  protectionPermissionRows,
  protectionSummary,
} from '../security/protection';

export interface ProtectionNoticeProps {
  protection: DocumentProtectionState;
  /** Optional dismiss for the current session; the document stays open. */
  onDismiss?: () => void;
}

export function ProtectionNotice(props: ProtectionNoticeProps): ReactElement {
  const { protection, onDismiss } = props;
  const rows = protectionPermissionRows(protection.permissions);
  const allowed = rows.filter((r) => r.allowed).map((r) => r.label);
  const denied = rows.filter((r) => !r.allowed).map((r) => r.label);

  return (
    <div
      className="protection-notice"
      role="note"
      aria-label="Document protection"
      data-protection-notice
    >
      <ShieldAlert size={18} aria-hidden className="protection-notice-icon" />
      <div className="protection-notice-body">
        <p className="protection-notice-title">
          Protected document
          <span className="protection-notice-algorithm" data-protection-algorithm>
            {protectionSummary(protection)}
          </span>
        </p>
        <p className="protection-notice-line" data-protection-permissions>
          <span className="protection-notice-key">Allowed:</span>{' '}
          {allowed.length > 0 ? allowed.join(', ') : 'none'}
          {denied.length > 0 ? (
            <>
              {' '}
              <span className="protection-notice-key">Not allowed:</span>{' '}
              {denied.join(', ')}
            </>
          ) : null}
        </p>
        <p className="protection-notice-enforcement" data-protection-enforcement>
          {PROTECTION_ENFORCEMENT_TEXT}
        </p>
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          className="protection-notice-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss protection notice"
          data-protection-dismiss
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
