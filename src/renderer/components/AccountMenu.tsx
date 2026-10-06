// Phase 44 (operator amendment) — the top-bar account section.
//
// Replaces the retired single header button. Signed out it is a "Sign in"
// entry that opens the existing sign-in / sign-up surface (AccountsDialog);
// signed in it is a ROUND avatar whose click EXPANDS a panel anchored to it.
// The panel shows the profile (avatar, name, email) and offers Update profile,
// Sync now (with the live sync status) and Sign out.
//
// Motion: the panel reveals through usePopAnimation (the shared Drop Reveal
// preset the title-bar menus use) and the avatar presses through
// useScaleAnimation — tokens only, transform/opacity, reduced-motion fallback.
// The SDK never appears here: the component talks to AccountsAuthAdapter.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogOut, RefreshCcw, UserCog, UserRound } from "lucide-react";
import { Icon } from "../icons/Icon";
import { Button } from "./Button";
import type { AccountUser, SyncReport } from "../../shared/accounts";
import type { AccountsAuthAdapter } from "../accounts/adapter";
import { createNeonAuthAdapter } from "../accounts/adapter";
import { accountsBridge } from "../accounts/bridge";
import { messageForError } from "../accounts/machine";
import { describeSyncReport } from "../accounts/syncStatus";
import { avatarAccessibleName, avatarText, hasAvatarImage } from "../accounts/identity";
import { usePopAnimation, useScaleAnimation } from "../hooks/useAnimations";

/** The accessible name of the signed-out entry point. */
export const ACCOUNT_SIGNED_OUT_ACCESSIBLE_NAME = "Sign in or create an account";

/** The one-line explanation shown beside the read-only email / password: the
 *  Managed identity provider does not permit changing either on this path. */
export const PROFILE_IMMUTABLE_NOTE =
  "Email and password are managed by your sign-in provider and can't be changed here.";

export interface AccountMenuProps {
  signedIn: boolean;
  /** The signed-in identity when known (email always, name when the adapter
   *  returned one). Null while signed out. */
  user: AccountUser | null;
  onOpenSignIn: () => void;
  onSignedOut: () => void;
  onProfileUpdated: (user: AccountUser) => void;
  /** Test seam: build the adapter from the config base URL. Defaults to the
   *  real Neon SDK adapter. */
  createAdapter?: (baseUrl: string) => AccountsAuthAdapter;
  /** The provider-supplied avatar URL, read from the encrypted session on a
   *  cold boot (no network call). Null when no image is held. */
  imageUrl?: string | null;
}

type PanelView = "menu" | "profile";

/** The round avatar glyph: the provider image when set and loadable, else
 *  initials, else the email letter, else the person icon. The image URL is
 *  DATA from the provider and is always passed straight to `src`. */
function AvatarFace({ user, imageUrl }: { user: AccountUser; imageUrl?: string | null }): ReactElement {
  const [failed, setFailed] = useState(false);
  // Re-arm the image branch when the provider swaps the URL (a different user
  // or a fresh avatar), so a previous load failure never sticks.
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);
  if (hasAvatarImage(imageUrl) && !failed) {
    return (
      <img
        className="account-avatar-img"
        src={imageUrl}
        alt={avatarAccessibleName(user)}
        onError={(): void => setFailed(true)}
      />
    );
  }
  const text = avatarText(user);
  if (text.length === 0) return <Icon icon={UserRound} size="sm" />;
  return <span className="account-avatar-text" aria-hidden>{text}</span>;
}

export function AccountMenu(props: AccountMenuProps): ReactElement {
  const { signedIn, user, onOpenSignIn, onSignedOut, onProfileUpdated, createAdapter, imageUrl = null } = props;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("menu");
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [authBaseUrl, setAuthBaseUrl] = useState<string | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelPop = usePopAnimation({ scale: false });
  const press = useScaleAnimation();

  const adapter = useMemo(
    () => (authBaseUrl === null ? null : (createAdapter ?? createNeonAuthAdapter)(authBaseUrl)),
    [authBaseUrl, createAdapter],
  );
  const identity: AccountUser = user ?? { id: "", email: "", emailVerified: false };
  // A saved display name shows immediately, before the host echoes it back.
  const shownUser: AccountUser = localName !== null ? { ...identity, name: localName } : identity;
  // Drop the local override if the underlying name changes (a different user).
  useEffect(() => {
    setLocalName(null);
  }, [identity.name]);

  // Resolve the auth base URL once a session is held, so Update profile can
  // reach the adapter. Local IPC only; no network call is made here.
  useEffect(() => {
    if (!signedIn) return;
    const api = accountsBridge();
    if (api === null) return;
    void api.getConfig().then((config) => {
      if (config.configured && config.authBaseUrl !== null) setAuthBaseUrl(config.authBaseUrl);
    }).catch(() => undefined);
  }, [signedIn]);

  // Live sync status while the panel is open.
  useEffect(() => {
    if (!open || !signedIn) return undefined;
    const api = accountsBridge();
    if (api === null || typeof api.onSyncReport !== "function") return undefined;
    return api.onSyncReport((report) => setSyncReport(report));
  }, [open, signedIn]);

  // Reset the panel to its menu and seed the name draft every time it opens.
  useEffect(() => {
    if (!open) return;
    setView("menu");
    setProfileError(null);
    setDraftName(shownUser.name ?? "");
    // identity is derived from props; keying on the name keeps the seed fresh
    // without re-running while the panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape and on a click outside the wrap. Neither handler calls
  // preventDefault / stopPropagation, so a click meant for a control beneath
  // still completes (the cross-bubbling rule).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (wrapRef.current !== null && target !== null && wrapRef.current.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return (): void => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const runSync = useCallback((): void => {
    const api = accountsBridge();
    if (api === null) return;
    setSyncing(true);
    void api.syncNow().then((report) => setSyncReport(report)).finally(() => setSyncing(false));
  }, []);

  const signOut = useCallback((): void => {
    const api = accountsBridge();
    if (adapter !== null) void adapter.signOut();
    setOpen(false);
    if (api === null) {
      onSignedOut();
      return;
    }
    void api.clearSession().then(() => onSignedOut()).catch(() => onSignedOut());
  }, [adapter, onSignedOut]);

  const saveProfile = useCallback((): void => {
    const name = draftName.trim();
    if (adapter === null) {
      setProfileError("Profile changes are not available on this install.");
      return;
    }
    setSaving(true);
    setProfileError(null);
    void adapter.updateName({ name }).then((res) => {
      setSaving(false);
      if (res.ok) {
        setLocalName(name);
        onProfileUpdated({ ...shownUser, name });
        setView("menu");
      } else {
        setProfileError(messageForError(res.code, res));
      }
    }).catch(() => {
      setSaving(false);
      setProfileError("Something went wrong. Try again in a moment.");
    });
  }, [adapter, draftName, shownUser, onProfileUpdated]);

  const syncView = describeSyncReport(syncReport);
  const accessibleName = avatarAccessibleName(shownUser);

  if (!signedIn) {
    return (
      <Button
        type="button"
        intent="secondary"
        kind="action"
        className="header-accounts account-signin"
        onClick={onOpenSignIn}
        aria-haspopup="dialog"
        aria-label={ACCOUNT_SIGNED_OUT_ACCESSIBLE_NAME}
        title="Sign in or create an account"
        data-header-accounts="signed-out"
      >
        <Icon icon={UserRound} size="sm" />
        <span className="account-signin-label">Sign in</span>
      </Button>
    );
  }

  return (
    <div className="account-menu-wrap" ref={wrapRef}>
      <motion.button
        type="button"
        className="account-avatar"
        onClick={(): void => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accessibleName}
        title={accessibleName}
        data-header-accounts="signed-in"
        data-account-avatar
        {...press.press}
      >
        <AvatarFace user={shownUser} imageUrl={imageUrl} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="account-panel"
            role="menu"
            aria-label="Account menu"
            data-account-panel
            variants={panelPop}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {view === "menu" ? (
              <>
                <div className="account-panel-profile">
                  <span className="account-panel-avatar" aria-hidden>
                    <AvatarFace user={shownUser} imageUrl={imageUrl} />
                  </span>
                  <span className="account-panel-identity">
                    <span className="account-panel-name" data-account-panel-name>
                      {(shownUser.name ?? "").trim().length > 0 ? shownUser.name : "Signed in"}
                    </span>
                    <span className="account-panel-email" data-account-panel-email>{identity.email}</span>
                  </span>
                </div>
                <Button
                  type="button"
                  intent="secondary"
                  kind="action"
                  className="account-panel-action"
                  role="menuitem"
                  onClick={(): void => { setView("profile"); setProfileError(null); setDraftName(shownUser.name ?? ""); }}
                  data-account-update-profile
                >
                  <Icon icon={UserCog} size="sm" />
                  Update profile
                </Button>
                <Button
                  type="button"
                  intent="secondary"
                  kind="action"
                  className="account-panel-action"
                  role="menuitem"
                  onClick={runSync}
                  disabled={syncing}
                  busy={syncing}
                  busyLabel="Syncing"
                  data-account-sync-now
                >
                  <Icon icon={RefreshCcw} size="sm" />
                  Sync now
                </Button>
                <div
                  className={`account-sync-status accounts-sync-${syncView.tone}`}
                  data-sync-phase={syncView.phase}
                  role="status"
                >
                  <span className="account-sync-label">{syncView.label}</span>
                  {syncView.detail !== null && (
                    <span className="account-sync-detail">{syncView.detail}</span>
                  )}
                </div>
                <Button
                  type="button"
                  intent="secondary"
                  kind="action"
                  className="account-panel-action account-panel-signout"
                  role="menuitem"
                  onClick={signOut}
                  data-account-signout
                >
                  <Icon icon={LogOut} size="sm" />
                  Sign out
                </Button>
              </>
            ) : (
              <div className="account-profile-form" data-account-profile-form>
                <p className="account-profile-title">Update profile</p>
                <label className="account-field" htmlFor="account-display-name">
                  <span className="account-label">Display name</span>
                  <input
                    id="account-display-name"
                    type="text"
                    className="account-input"
                    value={draftName}
                    autoComplete="name"
                    onChange={(e): void => setDraftName(e.target.value)}
                    data-account-name-input
                  />
                </label>
                <label className="account-field" htmlFor="account-email-readonly">
                  <span className="account-label">Email</span>
                  <input
                    id="account-email-readonly"
                    type="email"
                    className="account-input account-input-readonly"
                    value={identity.email}
                    readOnly
                    data-account-email-readonly
                  />
                </label>
                <label className="account-field" htmlFor="account-password-readonly">
                  <span className="account-label">Password</span>
                  <input
                    id="account-password-readonly"
                    type="password"
                    className="account-input account-input-readonly"
                    value="not-editable"
                    readOnly
                    data-account-password-readonly
                  />
                </label>
                <p className="account-hint" data-account-immutable-note>{PROFILE_IMMUTABLE_NOTE}</p>
                {profileError !== null && (
                  <p className="account-profile-error" role="status" data-account-profile-error>
                    {profileError}
                  </p>
                )}
                <div className="account-profile-actions">
                  <button
                    type="button"
                    className="btn btn-primary account-profile-save"
                    onClick={saveProfile}
                    disabled={saving}
                    data-account-save-profile
                  >
                    {saving ? "Saving" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={(): void => setView("menu")}
                    data-account-profile-cancel
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}