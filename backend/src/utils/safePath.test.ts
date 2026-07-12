import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "./safePath.js";

describe("resolveInsideRoot", () => {
  it("允许解析工作区内部路径", () => {
    const result = resolveInsideRoot("D:/workspace", "books", "demo", "book.json");
    expect(result.replaceAll("\\", "/")).toContain("D:/workspace/books/demo/book.json");
  });

  it("拒绝逃逸到工作区外的路径", () => {
    expect(() => resolveInsideRoot("D:/workspace", "..", "secret.json")).toThrow("非法文件路径");
  });
});
