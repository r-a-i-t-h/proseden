import { describe, expect, it } from "vitest";
import { expandCuratedLink, formatInline, formatProse } from "./prose.js";

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

  it("expands curated links and formats labels", () => {
    expect(formatInline("[Moss](pedia:Moss)")).toBe(
      '<a href="https://en.wikipedia.org/wiki/Moss" rel="noopener noreferrer" target="_blank">Moss</a>',
    );
    expect(formatInline("[*look*](media:stone lintel)")).toBe(
      '<a href="https://commons.wikimedia.org/wiki/Special:MediaSearch?search=stone%20lintel" rel="noopener noreferrer" target="_blank"><strong>look</strong></a>',
    );
    expect(formatInline("[find](srch:proseden)")).toBe(
      '<a href="https://www.ecosia.org/search?q=proseden" rel="noopener noreferrer" target="_blank">find</a>',
    );
  });

  it("strips unknown link schemes to the label", () => {
    expect(formatInline("[x](https://example.com)")).toBe("x");
    expect(formatInline("[nope](javascript:alert(1))")).toBe("nope");
  });

  it("does not expand link syntax inside code", () => {
    expect(formatInline("`[x](pedia:y)`")).toBe("<code>[x](pedia:y)</code>");
  });
});

describe("expandCuratedLink", () => {
  it("builds Wikipedia titles with underscores", () => {
    expect(expandCuratedLink("pedia", "Albert Einstein")).toBe(
      "https://en.wikipedia.org/wiki/Albert_Einstein",
    );
  });

  it("builds Commons MediaSearch and Ecosia query URLs", () => {
    expect(expandCuratedLink("media", "deckle edge")).toBe(
      "https://commons.wikimedia.org/wiki/Special:MediaSearch?search=deckle%20edge",
    );
    expect(expandCuratedLink("srch", "a & b")).toBe(
      "https://www.ecosia.org/search?q=a%20%26%20b",
    );
  });
});

describe("formatProse", () => {
  it("escapes HTML then applies adornments", () => {
    expect(formatProse("Say <hi> and *go*")).toBe(
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

  it("renders horizontal rules and block quotes", () => {
    expect(formatProse("before\n\n---\n\nafter")).toBe("<p>before</p><hr /><p>after</p>");
    expect(formatProse("> a said\n> *this*")).toBe(
      "<blockquote><p>a said<br /><strong>this</strong></p></blockquote>",
    );
  });
});
