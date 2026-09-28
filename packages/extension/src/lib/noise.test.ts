import { describe, expect, it } from "vitest";
import { cssModulePrefix, isGeneratedId, isHashedClass, isSemanticClass, isUtilityClass } from "./noise";

describe("class heuristics", () => {
  it.each([
    "flex", "inline-flex", "px-4", "py-1", "p-6", "mt-8", "mx-auto", "bg-blue-600", "text-white",
    "text-sm", "hover:bg-blue-700", "md:flex", "w-1/2", "top-[3px]", "min-w-full", "max-w-5xl",
    "divide-y", "divide-gray-200", "rounded-lg", "border", "sr-only", "w-8", "h-8", "gap-2",
    "grid-cols-3", "items-center", "justify-between", "tracking-tight", "font-bold", "top-0", "list-disc",
    "transition-all", "transition-colors", "ring-sidebar-ring", "ring-offset-background",
  ])("%s is a utility", (name) => {
    expect(isUtilityClass(name)).toBe(true);
    expect(isSemanticClass(name)).toBe(false);
  });

  it.each(["css-1a2b3c", "sc-bdVaJa", "kUgNyR", "bdVaJa", "svelte-xyz123", "jsx-123456", "ng-star-inserted", "item-20231105"])(
    "%s is hashed",
    (name) => {
      expect(isHashedClass(name)).toBe(true);
      expect(isSemanticClass(name)).toBe(false);
    },
  );

  it.each(["toolbar", "primary", "delete-row", "private-note", "card", "cards", "list-item", "top-bar", "navItem", "MuiButton-root"])(
    "%s is semantic",
    (name) => {
      expect(isSemanticClass(name)).toBe(true);
    },
  );

  it("extracts the stable prefix of CSS-module classes", () => {
    expect(cssModulePrefix("Toolbar_export__3xKz1")).toBe("Toolbar_export__");
    expect(cssModulePrefix("Toolbar_toolbar__a8Kd2")).toBe("Toolbar_toolbar__");
    expect(cssModulePrefix("delete-row")).toBeUndefined();
    expect(isSemanticClass("Toolbar_export__3xKz1")).toBe(false);
  });
});

describe("isGeneratedId", () => {
  it.each([":r1:", "radix-:r2:", "«r3»", "headlessui-menu-button-5", "mui-42", "row-123456", "3f2b8c1e-8a9d-4c1e-9f0a-1b2c3d4e5f60", " "])(
    "%s is generated",
    (id) => expect(isGeneratedId(id)).toBe(true),
  );

  it.each(["export-btn", "orders", "orders-table", "settings-form", "display-name", "step2"])("%s is stable", (id) => {
    expect(isGeneratedId(id)).toBe(false);
  });
});
