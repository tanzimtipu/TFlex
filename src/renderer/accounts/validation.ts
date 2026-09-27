// Phase 46 - pre-send field validation for the account surface.
//
// Pure, DOM-free helpers so the exact copy ("a user must never have to guess")
// is unit-tested directly. The rules mirror the provider's own schema:
//   - `sign-up/email` requires a non-empty `name` (Better Auth `z.string()`);
//   - a valid email;
//   - a password of at least 8 characters.
//
// The 8-character floor is the installed Better Auth default
// (`emailAndPassword.minPasswordLength || 8`, see create-context.mjs and
// sign-up.mjs's `password.length < minPasswordLength`). Validation runs BEFORE
// the request so a missing field never burns a round trip and never surfaces
// as the provider's raw zod text.

/** The provider's minimum password length (Better Auth default: 8). */
export const MIN_PASSWORD_LENGTH = 8;

/** A pragmatic email shape check: one `@`, a dotted domain, no whitespace.
 *  The provider validates strictly too; this is only the fast local gate. */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface CredentialsInput {
  email: string;
  password: string;
  name: string;
}

/**
 * The precise, user-facing reason the credentials form cannot be submitted, or
 * null when they are ready. `mode` selects the sign-up rules (name + 8-char
 * password) versus the sign-in rules (both fields present).
 */
export function credentialsFieldError(
  mode: "sign-in" | "sign-up",
  input: CredentialsInput,
): string | null {
  const email = input.email.trim();
  if (email.length === 0) return "Enter your email address.";
  if (!isValidEmail(email)) return "Enter a valid email address.";
  if (mode === "sign-up") {
    if (input.name.trim().length === 0) return "Enter a display name for your account.";
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return null;
  }
  if (input.password.length === 0) return "Enter your password.";
  return null;
}
