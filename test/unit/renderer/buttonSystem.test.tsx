// @vitest-environment jsdom
// Phase 91 — Button / IconButton DOM behaviour.
//
// React 19 needs this flag before react-dom/client is imported.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, IconButton } from "../../../src/renderer/components/Button";

function click(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

let roots: Root[] = [];
let containers: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

function firstButton(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector("button");
  expect(el).not.toBeNull();
  return el as HTMLButtonElement;
}

beforeEach((): void => {
  roots = [];
  containers = [];
});

afterEach((): void => {
  const rs = roots;
  const cs = containers;
  roots = [];
  containers = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const c of cs) c.remove();
});

describe("Phase 91 — Button", () => {
  it("defaults to the secondary category and a safe button type", () => {
    const el = firstButton(mount(<Button>Save</Button>));
    expect(el.classList.contains("btn")).toBe(true);
    expect(el.classList.contains("btn-secondary")).toBe(true);
    expect(el.getAttribute("type")).toBe("button");
    expect(el.textContent).toBe("Save");
  });

  it("composes .btn plus the requested category class", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
      const el = firstButton(mount(<Button variant={variant}>Go</Button>));
      expect(el.classList.contains(`btn-${variant}`)).toBe(true);
    }
  });

  it("adds the btn-sm modifier only for the small size", () => {
    const md = firstButton(mount(<Button>Go</Button>));
    expect(md.classList.contains("btn-sm")).toBe(false);
    const sm = firstButton(mount(<Button size="sm">Go</Button>));
    expect(sm.classList.contains("btn-sm")).toBe(true);
  });

  it("renders the optional icon before the text label", () => {
    const container = mount(
      <Button icon={<span data-glyph>icon</span>}>Label</Button>,
    );
    const el = firstButton(container);
    expect(el.querySelector("[data-glyph]")).not.toBeNull();
    expect(el.firstElementChild?.getAttribute("data-glyph")).not.toBeNull();
    expect(el.textContent).toBe("iconLabel");
  });

  it("forwards native props and every data-* attribute unchanged", () => {
    let clicks = 0;
    const container = mount(
      <Button
        type="submit"
        disabled
        aria-label="Confirm action"
        title="Confirm"
        data-confirm-dialog-action="confirm"
        data-custom-hook="x"
        onClick={(): void => {
          clicks += 1;
        }}
      >
        Confirm
      </Button>,
    );
    const el = firstButton(container);
    expect(el.getAttribute("type")).toBe("submit");
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Confirm action");
    expect(el.getAttribute("title")).toBe("Confirm");
    expect(el.getAttribute("data-confirm-dialog-action")).toBe("confirm");
    expect(el.getAttribute("data-custom-hook")).toBe("x");
    expect(clicks).toBe(0);
  });

  it("is non-interactive while disabled and fires when enabled", () => {
    let clicks = 0;
    const disabled = firstButton(
      mount(
        <Button
          disabled
          onClick={(): void => {
            clicks += 1;
          }}
        >
          Nope
        </Button>,
      ),
    );
    click(disabled);
    expect(clicks).toBe(0);

    const enabled = firstButton(
      mount(
        <Button
          onClick={(): void => {
            clicks += 1;
          }}
        >
          Yes
        </Button>,
      ),
    );
    click(enabled);
    expect(clicks).toBe(1);
  });

  it("forwards a ref to the rendered button", () => {
    const ref = createRef<HTMLButtonElement>();
    const container = mount(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBe(firstButton(container));
  });
});

describe("Phase 91 — IconButton", () => {
  it("defaults to ghost + square and always sets aria-label and title", () => {
    const el = firstButton(
      mount(<IconButton label="Zoom in" icon={<span data-glyph>g</span>} />),
    );
    expect(el.classList.contains("btn")).toBe(true);
    expect(el.classList.contains("btn-ghost")).toBe(true);
    expect(el.classList.contains("btn-icon")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Zoom in");
    expect(el.getAttribute("title")).toBe("Zoom in");
    expect(el.querySelector("[data-glyph]")).not.toBeNull();
    expect(el.textContent).toBe("g");
  });

  it("composes the requested icon category", () => {
    for (const variant of ["ghost", "secondary", "danger", "toggle"] as const) {
      const el = firstButton(
        mount(<IconButton label="Act" variant={variant} icon={<span>g</span>} />),
      );
      expect(el.classList.contains(`btn-${variant}`)).toBe(true);
      expect(el.classList.contains("btn-icon")).toBe(true);
    }
  });

  it("renders the toolbar category without the generic icon square", () => {
    const el = firstButton(
      mount(<IconButton label="Bold" variant="toolbar" icon={<span>g</span>} />),
    );
    expect(el.classList.contains("btn-toolbar")).toBe(true);
    expect(el.classList.contains("btn-icon")).toBe(false);
  });

  it("renders aria-pressed only when pressed is provided", () => {
    const on = firstButton(mount(<IconButton label="Grid" pressed icon={<span>g</span>} />));
    expect(on.getAttribute("aria-pressed")).toBe("true");
    const off = firstButton(
      mount(<IconButton label="Grid" pressed={false} icon={<span>g</span>} />),
    );
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const none = firstButton(mount(<IconButton label="Grid" icon={<span>g</span>} />));
    expect(none.hasAttribute("aria-pressed")).toBe(false);
  });

  it("adds btn-sm for the small size", () => {
    const sm = firstButton(
      mount(<IconButton label="Act" size="sm" icon={<span>g</span>} />),
    );
    expect(sm.classList.contains("btn-sm")).toBe(true);
  });

  it("forwards native props, data-* hooks and clicks unchanged", () => {
    let clicks = 0;
    const container = mount(
      <IconButton
        label="Delete page"
        variant="danger"
        data-inspector-action="delete-page"
        onClick={(): void => {
          clicks += 1;
        }}
        icon={<span>g</span>}
      />,
    );
    const el = firstButton(container);
    expect(el.getAttribute("data-inspector-action")).toBe("delete-page");
    expect(el.getAttribute("type")).toBe("button");
    click(el);
    expect(clicks).toBe(1);
  });

  it("is non-interactive while disabled", () => {
    let clicks = 0;
    const el = firstButton(
      mount(
        <IconButton
          label="Nope"
          disabled
          onClick={(): void => {
            clicks += 1;
          }}
          icon={<span>g</span>}
        />,
      ),
    );
    click(el);
    expect(clicks).toBe(0);
  });

  it("forwards a ref to the rendered button", () => {
    const ref = createRef<HTMLButtonElement>();
    const container = mount(<IconButton ref={ref} label="Ref" icon={<span>g</span>} />);
    expect(ref.current).toBe(firstButton(container));
  });
});
