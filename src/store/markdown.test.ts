import { describe, expect, it } from "vitest";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";

describe("parseProseDocument", () => {
  it("splits ## detail sections from the body", () => {
    const raw = `---
title: Test
---
Hello

## afternoon
still body

## detail:card
Closer look.
`;
    const { body, details } = parseProseDocument(raw);
    expect(body).toBe("Hello\n\n## afternoon\nstill body");
    expect(details).toEqual({ card: "Closer look." });
  });

  it("treats escaped hash-leading lines as body text", () => {
    const raw = `---
title: Escaped
---
\\# subtitle
\\## detail:oopsie
literal

## detail:card
real
`;
    const { body, details } = parseProseDocument(raw);
    expect(body).toBe("# subtitle\n## detail:oopsie\nliteral");
    expect(details).toEqual({ card: "real" });
  });

  it("accepts detail slugs with spaces and punctuation", () => {
    const raw = `---
title: Spaced
---
Body.

## detail:look closer
First detail.

## detail:foo.bar
Second detail.

## detail:café-door
Third detail.
`;
    const { body, details } = parseProseDocument(raw);
    expect(body).toBe("Body.");
    expect(details).toEqual({
      "look closer": "First detail.",
      "foo.bar": "Second detail.",
      "café-door": "Third detail.",
    });
  });
});

describe("serializeProseDocument", () => {
  it("escapes every hash-leading line in body and detail text", () => {
    const raw = serializeProseDocument(
      { title: "T" },
      "Hi\n# subtitle\n## detail:oopsie\nscene #3",
      { card: "look\n## nested" },
    );
    expect(raw).toContain("\\# subtitle");
    expect(raw).toContain("\\## detail:oopsie");
    expect(raw).toContain("scene #3");
    expect(raw).toContain("## detail:card\nlook\n\\## nested");
    const { body, details } = parseProseDocument(raw);
    expect(body).toBe("Hi\n# subtitle\n## detail:oopsie\nscene #3");
    expect(details).toEqual({ card: "look\n## nested" });
  });

  it("preserves author detail key order (does not alphabetize)", () => {
    const raw = serializeProseDocument({ title: "T" }, "body", {
      zebra: "last alphabetically",
      apple: "first alphabetically",
    });
    expect(raw.indexOf("## detail:zebra")).toBeLessThan(raw.indexOf("## detail:apple"));
    const { details } = parseProseDocument(raw);
    expect(Object.keys(details)).toEqual(["zebra", "apple"]);
  });

  it("round-trips detail keys with spaces", () => {
    const raw = serializeProseDocument({ title: "T" }, "Scene body.", {
      "look closer": "First.",
      card: "Second.",
    });
    expect(raw).toContain("## detail:look closer\nFirst.");
    const { body, details } = parseProseDocument(raw);
    expect(body).toBe("Scene body.");
    expect(details).toEqual({ "look closer": "First.", card: "Second." });
  });
});
