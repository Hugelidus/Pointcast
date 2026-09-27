import { describe, expect, it } from "vitest";
import { projectRelativePath } from "./paths";

describe("projectRelativePath", () => {
  it("cuts a Vue absolute Windows path at the project marker", () => {
    expect(
      projectRelativePath(
        "C:/Users/hugob/Desktop/Grabadora web para LLM/packages/eval/.apps/vuestic-admin/src/components/va-charts/chart-types/LineChart.vue",
      ),
    ).toBe("src/components/va-charts/chart-types/LineChart.vue");
  });

  it("cuts a Windows path with backslashes the same way", () => {
    expect(projectRelativePath("C:\\Users\\hugob\\project\\src\\components\\Foo.vue")).toBe(
      "src/components/Foo.vue",
    );
  });

  it("cuts a POSIX home-directory path at the project marker", () => {
    expect(projectRelativePath("/home/hugo/project/src/components/Foo.vue")).toBe(
      "src/components/Foo.vue",
    );
  });

  it("strips a file:// URL, drive letter or POSIX, the same way", () => {
    expect(projectRelativePath("file:///C:/Users/hugob/project/src/App.tsx")).toBe("src/App.tsx");
    expect(projectRelativePath("file:///home/hugo/project/src/File.vue")).toBe("src/File.vue");
  });

  it("leaves an already-relative path unchanged", () => {
    expect(projectRelativePath("src/components/Toolbar.tsx")).toBe("src/components/Toolbar.tsx");
    expect(projectRelativePath("src\\App.vue")).toBe("src\\App.vue");
  });

  it("leaves a plain rooted path with no home prefix unchanged (e.g. a container path)", () => {
    expect(projectRelativePath("/app/src/Toolbar.vue")).toBe("/app/src/Toolbar.vue");
  });

  it("shortens a node_modules path to package/… form", () => {
    expect(projectRelativePath("C:/Users/hugob/project/node_modules/vue-router/dist/vue-router.mjs")).toBe(
      "vue-router/dist/vue-router.mjs",
    );
    expect(projectRelativePath("/home/hugo/project/node_modules/@scope/pkg/index.js")).toBe(
      "@scope/pkg/index.js",
    );
  });

  it("never keeps the home directory or username when no marker or node_modules is present", () => {
    expect(projectRelativePath("/home/hugo/randomdir/deep/nested/File.js")).not.toContain("hugo");
    expect(projectRelativePath("/home/hugo/randomdir/deep/nested/File.js")).toBe(
      "deep/nested/File.js",
    );
    expect(projectRelativePath("C:/Users/hugob/Desktop/RandomProject/File.js")).not.toContain("hugob");
    expect(projectRelativePath("/home/hugo/File.js")).not.toContain("hugo");
    expect(projectRelativePath("/home/hugo/File.js")).toBe("File.js");
  });

  it("is a no-op on empty input", () => {
    expect(projectRelativePath("")).toBe("");
  });
});
