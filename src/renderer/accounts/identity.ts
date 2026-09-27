// Phase 44 (operator amendment) — the avatar identity derivation.
//
// Pure helpers for the round avatar in the top bar. Kept out of the component
// so every fallback branch (profile image -> initials -> email letter, and the
// accessible name) is unit-tested directly, with no DOM and no SDK.
//
// The identity provider permits ONE editable profile field (the display name);
// `AccountUser` carries that name when the SDK returns it. `AccountUser.image`
// is now part of the shared contract and is served from the encrypted session
// on a cold boot (no network read), so the image branch is driven by a URL the
// caller passes in.

import type { AccountUser } from "../../shared/accounts";

/** True when `image` is a usable, non-empty URL (null/undefined/blank = none).
 *  The provider's value is DATA: the caller feeds it straight to an <img src>,
 *  never a source literal. */
export function hasAvatarImage(image?: string | null): image is string {
  return typeof image === "string" && image.trim().length > 0;
}

/** First letter of the first name + first letter of the last name, uppercased.
 *  A single-word name yields one letter. A blank / missing name yields null so
 *  the caller can fall through to the email letter. */
export function initialsFromName(name?: string | null): string | null {
  if (name === undefined || name === null) return null;
  const tokens = name.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const first = tokens[0].charAt(0);
  const second = tokens.length > 1 ? tokens[1].charAt(0) : "";
  return (first + second).toUpperCase();
}

/** First letter of the email, uppercased, or null for a missing / empty email. */
export function emailInitial(email?: string | null): string | null {
  if (email === undefined || email === null) return null;
  const trimmed = email.trim();
  if (trimmed.length === 0) return null;
  return trimmed.charAt(0).toUpperCase();
}

/** The avatar's glyph text: image is handled by the caller; this is the text
 *  fallback chain — name initials first, then the email's first letter. An
 *  empty string means neither is available (the caller shows the person icon). */
export function avatarText(user: Pick<AccountUser, "name" | "email"> | null | undefined): string {
  if (user === null || user === undefined) return "";
  return initialsFromName(user.name) ?? emailInitial(user.email) ?? "";
}

/** The avatar's accessible name: the user's name, else the email, else a
 *  generic "Account" so the control is never unnamed. */
export function avatarAccessibleName(
  user: Pick<AccountUser, "name" | "email"> | null | undefined,
): string {
  if (user === null || user === undefined) return "Account";
  const name = (user.name ?? "").trim();
  if (name.length > 0) return name;
  const email = (user.email ?? "").trim();
  if (email.length > 0) return email;
  return "Account";
}