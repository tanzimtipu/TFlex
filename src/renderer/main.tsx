// TFlex renderer entry. Loads the global Inter font + our stylesheet, then
// mounts the React app. The Windows frame is native (kept on); main renders
// into the whole viewport.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
