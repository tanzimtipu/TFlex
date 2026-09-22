// TFlex renderer entry. Loads the global Inter font + our stylesheet, then
// mounts either the app or - when main opened the standalone print window
// (`?tfWindow=print&context=...`) - the print-only UI. The Windows frame is
// native (kept on); main renders into the whole viewport.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveRendererEntry, rendererEntryTitle } from "./print-window/context";
import { PrintWindowApp } from "./print-window/PrintWindowApp";
import "./styles.css";

// Resolved ONCE at module scope: the entry (and the print context inside it)
// must keep a stable identity, because the print surface seeds its controls
// from that context and re-seeds whenever it changes.
const entry = resolveRendererEntry(window.location.search);

// DEF-298: the loaded document's <title> overrides the BrowserWindow `title`
// option, so the standalone print window sets its own document title here (both
// the print UI and its error state). The normal app entry leaves the main
// window's title untouched.
const entryTitle = rendererEntryTitle(entry);
if (entryTitle !== null) {
  document.title = entryTitle;
}

const container = document.getElementById("root");
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      {entry.kind === "app" ? <App /> : <PrintWindowApp entry={entry} />}
    </StrictMode>,
  );
}
