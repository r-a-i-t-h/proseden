import { describe, expect, it } from "vitest";
import { formatInline, formatProse } from "./prose.js";

describe("formatInline", () => {
  it("maps *strong*, _em_, ~strike~, and `code`", () => {
    expect(formatInline("*bold*")).toBe("<strong>bold</strong>");
    expect(formatInline("_soft_")).toBe("<em>soft</em>");
    expect(formatInline("~gone~")).toBe("<s>gone</s>");
    expect(formatInline("`x = 1`")).toBe("<code>x = 1</code>");
  });

  it("does not treat snake_case as emphasis", () => {
    expect(formatInline("snake_case_words")).toBe("snake_case_words");
  });

  it("allows nested different markers", () => {
    expect(formatInline("_*both*_")).toBe("<em><strong>both</strong></em>");
  });
});

describe("formatProse", () => {
  it("escapes HTML then applies adornments", () => {
    expect(formatProse('Say <hi> and *go*')).toBe(
      "<p>Say &lt;hi&gt; and <strong>go</strong></p>",
    );
  });

  it("keeps soft line breaks and blank-line paragraphs", () => {
    expect(formatProse("a\nb\n\nc")).toBe("<p>a<br />b</p><p>c</p>");
  });

  it("renders # / ## as in-description headings (not h1/h2)", () => {
    expect(formatProse("# Subtitle\n\nbody\n\n## Minor")).toBe(
      '<h3 class="desc-heading">Subtitle</h3><p>body</p><h4 class="desc-heading-minor">Minor</h4>',
    );
  });

  it("formats markers inside headings", () => {
    expect(formatProse("# Look *here*")).toBe(
      '<h3 class="desc-heading">Look <strong>here</strong></h3>',
    );
  });
});
