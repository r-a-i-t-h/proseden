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
});
