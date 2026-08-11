import { describe, expect, it } from "vitest";
import { expandCuratedLink, formatInline, formatProse, resolveLinkHref } from "./prose.js";

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
    expect(formatInline("[Moss](wikipedia:Moss)")).toBe(
      '<a href="https://en.wikipedia.org/wiki/Moss" rel="noopener noreferrer" target="_blank">Moss</a>',
    );
    expect(formatInline("[find](search:proseden)")).toBe(
      '<a href="https://www.ecosia.org/search?q=proseden" rel="noopener noreferrer" target="_blank">find</a>',
    );
  });

  it("turns http(s) destinations into links", () => {
    expect(formatInline("[x](https://example.com/path)")).toBe(
      '<a href="https://example.com/path" rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(formatInline("[in](http://localhost:8787/s/1)")).toBe(
      '<a href="http://localhost:8787/s/1" rel="noopener noreferrer" target="_blank">in</a>',
    );
  });

  it("strips unknown or unsafe link schemes to the label", () => {
    expect(formatInline("[ftp](ftp://files.example/x)")).toBe("ftp");
    expect(formatInline("[old](pedia:Moss)")).toBe("old");
    expect(formatInline("[old](media:stone)")).toBe("old");
    expect(formatInline("[nope](javascript:alert(1))")).toBe("nope");
  });

  it("does not expand link syntax inside code", () => {
    expect(formatInline("`[x](wikipedia:y)`")).toBe("<code>[x](wikipedia:y)</code>");
  });
});

describe("resolveLinkHref", () => {
  it("accepts http(s) and curated schemes", () => {
    expect(resolveLinkHref("https://example.com/a?q=1&x=2")).toBe(
      "https://example.com/a?q=1&x=2",
    );
    expect(resolveLinkHref("wikipedia:Moss")).toBe("https://en.wikipedia.org/wiki/Moss");
  });

  it("rejects non-http schemes and junk", () => {
    expect(resolveLinkHref("javascript:alert(1)")).toBeNull();
    expect(resolveLinkHref("data:text/html,x")).toBeNull();
    expect(resolveLinkHref("//evil.example")).toBeNull();
    expect(resolveLinkHref("not a url")).toBeNull();
  });
});

describe("expandCuratedLink", () => {
  it("builds Wikipedia titles with underscores", () => {
    expect(expandCuratedLink("wikipedia", "Albert Einstein")).toBe(
      "https://en.wikipedia.org/wiki/Albert_Einstein",
    );
  });

  it("builds Ecosia query URLs", () => {
    expect(expandCuratedLink("search", "a & b")).toBe(
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

  it("keeps query ampersands in http(s) links after HTML escaping", () => {
    expect(formatProse("[q](https://example.com/s?a=1&b=2)")).toBe(
      '<p><a href="https://example.com/s?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">q</a></p>',
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
