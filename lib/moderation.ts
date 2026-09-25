// Moderation for flares: short public notes shown on a user's dot to
// everyone. Strangers + public text is where abuse starts, so this is strict
// by design. A real product would add a maintained word list or a classifier;
// this covers the common cases cheaply and runs on every write.

export const FLARE_MAX_LENGTH = 60;

export type ModerationResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

// Leetspeak / look-alike folding so "s3x", "n.u.d.e.s" etc. still match.
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0@4]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

// Sexual solicitation and the most common slurs. Matched against the folded
// text, so separators and look-alike characters don't get around it.
const BLOCKED_TERMS = [
  "nude",
  "nudes",
  "naked",
  "horny",
  "sexting",
  "porn",
  "onlyfans",
  "dick",
  "cock",
  "pussy",
  "boobs",
  "tits",
  "blowjob",
  "cum",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "kys",
  "killyourself",
];

// Moving a stranger off-platform is the classic first step of scams and
// grooming, so contact details and handles aren't allowed in flares.
const CONTACT_PATTERNS: [RegExp, string][] = [
  [/\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|me|gg|ly|app|xyz|ru|co|tv|link)\b/i, "Links aren't allowed"],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "Email addresses aren't allowed"],
  [/(\+?\d[\s().-]*){7,}/, "Phone numbers aren't allowed"],
  [/(^|\s)@[a-z0-9_.]{3,}/i, "Social handles aren't allowed"],
  [/\b(snap(chat)?|insta(gram)?|telegram|whats ?app|discord|kik|wechat|tiktok|onlyfans)\b/i, "Please keep contact apps out of flares"],
];

export function moderateFlare(input: unknown): ModerationResult {
  if (typeof input !== "string") return { ok: false, reason: "Invalid flare" };

  const text = input
    .normalize("NFKC")
    // control + zero-width characters (used to sneak past filters or break layout)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return { ok: false, reason: "Write something first" };
  if ([...text].length > FLARE_MAX_LENGTH) {
    return { ok: false, reason: `Keep it under ${FLARE_MAX_LENGTH} characters` };
  }

  for (const [pattern, reason] of CONTACT_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason };
  }

  const folded = fold(text);
  const words = text.toLowerCase().split(/[^a-z0-9@$!|]+/).map(fold);
  const hit = BLOCKED_TERMS.some((term) =>
    // Short terms must be whole words ("cum" in "document" is fine); longer
    // ones also match inside run-together text ("sendnudes").
    term.length <= 4 ? words.includes(term) : folded.includes(term),
  );
  if (hit) return { ok: false, reason: "That flare breaks the community rules" };

  return { ok: true, text };
}
