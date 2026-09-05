// Phase C — renderer unit-test motion setup.
//
// Renderer tests run in jsdom where real rAF frames never resolve
// inside synchronous `act()`. Phase C gives every dialog/panel/toast
// an EXIT animation via AnimatePresence; without this flag a closing
// surface would stay mounted forever in tests, so "dialog is gone
// after close" assertions would fail.
//
// `skipAnimations` completes every motion animation immediately (on
// the next frame, ~1 tick under vitest's real timers), which keeps
// the exit -> unmount path deterministic while the e2e suite (real
// Electron, real frames) still gets the full springs.
//
// The guard matters for the main-process (node env) tests: vitest
// runs this file for every test file, and node env has no DOM — the
// flag is a renderer-only concern.

import { MotionGlobalConfig } from "motion/react";

if (typeof document !== "undefined") {
  MotionGlobalConfig.skipAnimations = true;
}