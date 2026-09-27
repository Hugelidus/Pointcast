/**
 * Walking the tree across open shadow roots. `parentElement` stops at a shadow root, so rules
 * that look at ancestors (a data-sensitive subtree, a form value, the readable path) would
 * otherwise ignore everything outside a web component.
 */

const DOCUMENT_FRAGMENT_NODE = 11;

/** A ShadowRoot, told apart without `instanceof` (jsdom and the page can be different realms). */
export function isShadowRoot(node: Node | null | undefined): node is ShadowRoot {
  return node?.nodeType === DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host !== undefined;
}

/** The parent element, or the shadow host for a direct child of a shadow root. */
export function composedParent(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const parent = node.parentNode;
  return isShadowRoot(parent) ? parent.host : null;
}

/** Like `closest` but continues past shadow roots into the host's tree. */
export function composedClosest(el: Element, selector: string): Element | null {
  let current: Element | null = el;
  while (current !== null) {
    const found = current.closest(selector);
    if (found !== null) return found;
    const root = current.getRootNode();
    current = isShadowRoot(root) ? root.host : null;
  }
  return null;
}
