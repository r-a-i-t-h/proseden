import { describe, expect, it } from "vitest";
import {
  displayJsonTextarea,
  formatJsonTextarea,
  prepareJsonTextarea,
} from "./json-textarea.js";

describe("formatJsonTextarea", () => {
  it("pretty-prints and turns in-string \\n into real line breaks", () => {
    const formatted = formatJsonTextarea({ card: "line1\nline2" });
    expect(formatted).toBe(`{\n  "card": "line1\nline2"\n}`);
  });

  it("leaves structural newlines as newlines", () => {
    const formatted = formatJsonTextarea({ a: 1, b: 2 });
    expect(formatted).toBe(`{\n  "a": 1,\n  "b": 2\n}`);
  });

  it("does not treat \\\\n as a line break", () => {
    const formatted = formatJsonTextarea({ raw: "\\n" });
    expect(formatted).toBe(`{\n  "raw": "\\\\n"\n}`);
  });
});

describe("displayJsonTextarea", () => {
  it("keeps compact structural layout and only unescapes in-string \\n", () => {
    const source = `{
  "rules": [
    { "id": "hamlet", "when": { "all": [{ "scenesOwned": 5 }] } }
  ],
  "card": "line1\\nline2"
}
`;
    expect(displayJsonTextarea(source)).toBe(`{
  "rules": [
    { "id": "hamlet", "when": { "all": [{ "scenesOwned": 5 }] } }
  ],
  "card": "line1
line2"
}`);
  });
});

describe("prepareJsonTextarea", () => {
  it("escapes in-string line breaks while keeping structural whitespace", () => {
    const prepared = prepareJsonTextarea(`{\n  "card": "line1\nline2"\n}`);
    expect(prepared).toBe(`{\n  "card": "line1\\nline2"\n}`);
    expect(JSON.parse(prepared)).toEqual({ card: "line1\nline2" });
  });

  it("normalizes CRLF inside strings to \\n", () => {
    const prepared = prepareJsonTextarea(`{"card": "line1\r\nline2"}`);
    expect(prepared).toBe(`{"card": "line1\\nline2"}`);
    expect(JSON.parse(prepared)).toEqual({ card: "line1\nline2" });
  });
});

describe("json textarea round-trip", () => {
  it("round-trips objects with multiline string values", () => {
    const value = {
      card: "Closer look.\nSecond paragraph.",
      window: "Rain beads on the glass.",
    };
    const edited = formatJsonTextarea(value);
    expect(JSON.parse(prepareJsonTextarea(edited))).toEqual(value);
  });

  it("round-trips arrays used for grants", () => {
    const value = [{ who: "visitor", rights: ["read"] }];
    const edited = formatJsonTextarea(value);
    expect(JSON.parse(prepareJsonTextarea(edited))).toEqual(value);
  });
});
