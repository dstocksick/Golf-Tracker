const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const GEMINI_MODEL = "gemini-3.6-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    players: {
      type: "array",
      items: {
        type: "object",
        properties: {
          writtenName: {type: "string"},
          matchedRosterName: {type: "string", nullable: true},
          holes: {
            type: "array",
            items: {type: "integer"},
          },
          holeDots: {
            type: "array",
            items: {type: "integer"},
          },
        },
        required: ["writtenName", "holes", "holeDots"],
      },
    },
    notes: {type: "string"},
  },
  required: ["players"],
};

function buildPrompt(rosterNames) {
  return `You are reading a photo of a handwritten golf scorecard. Each row on the card is one player; each column is one of 18 holes, showing that player's gross strokes for that hole.

Work column-by-column, not just row-by-row, to avoid drift:
1. First locate the printed hole-number header row (1 through 18) and note the horizontal position of each hole's column.
2. For each player row, read each hole's value by lining it up with that same hole's column position from the header — do not just read left-to-right and assume even spacing, since handwritten digits are not always evenly spaced or perfectly aligned under their column. If a row looks shifted relative to the header, re-check which column each digit actually falls under before recording it.
3. After reading all 18 holes for a player, sanity-check that you have exactly 18 values and that none were skipped or double-counted into the wrong column.

Digit accuracy: handwritten digits are easy to confuse — pay close attention to pairs that commonly get mixed up, especially 4 vs 7 (a 4 has a closed or crossed vertical stroke; a 7 has a single diagonal stroke with no vertical crossbar), as well as 3 vs 8, 1 vs 7, and 0 vs 6. When genuinely uncertain between two digits for a cell, pick your best guess but mention the ambiguity in notes.

Dots: on this card, a "dot" won on a hole is marked as a small dot/period written directly above that hole's score number — it is NOT a separate written total anywhere on the card. Each hole cell independently has zero, one, or occasionally two or more of these small marks clustered close together above the digit(s). Treat this as a per-hole counting task, not a summing task: for EACH of the 18 holes separately, zoom in mentally on just that one cell and count exactly how many distinct small dot marks appear above (or immediately around) that hole's score digit(s) — 0 if you see none, 1 if you see one, 2 if you see two separate marks, etc. Do not try to keep a running total in your head across holes; just report the count you observe in that one cell, hole by hole. Take care to distinguish the gross-score digit(s) from the small dot mark(s) above them — they are two different pieces of information in the same cell, and a dot is much smaller than a digit.

For each player row, return:
- writtenName: the name exactly as handwritten on the card (best-effort transcription).
- matchedRosterName: if the written name clearly matches one of these known roster names, return that exact roster name; otherwise null. Known roster names: ${rosterNames.length ? rosterNames.join(", ") : "(none provided)"}.
- holes: an array of exactly 18 integers, the gross strokes for holes 1 through 18 in order (the number itself, not counting any dot mark above it). If a value is illegible or missing, use 0 for that hole and mention it in notes.
- holeDots: an array of exactly 18 integers, aligned index-for-index with holes — the number of dot marks you counted directly above that specific hole's score (0, 1, 2, ...). Do not sum these; just report each hole's own count.

Also return a top-level "notes" string describing anything ambiguous, illegible, or uncertain that a human reviewer should double check — including any hole where you had to choose between two similar-looking digits, any row where column alignment was unclear, and any hole where a dot count was hard to tell (e.g. a smudge that might be one dot or two).

Respond with JSON matching the given schema only.`;
}

exports.parseScorecard = onRequest(
    {secrets: [geminiApiKey], cors: true, memory: "512MiB", timeoutSeconds: 60},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({error: "Method not allowed"});
        return;
      }

      const {imageBase64, mimeType, rosterNames} = req.body || {};
      if (!imageBase64) {
        res.status(400).json({error: "imageBase64 is required"});
        return;
      }

      const body = {
        contents: [{
          parts: [
            {text: buildPrompt(Array.isArray(rosterNames) ? rosterNames : [])},
            {inline_data: {mime_type: mimeType || "image/jpeg", data: imageBase64}},
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      };

      try {
        const apiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey.value()}`,
            {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify(body),
            },
        );
        const data = await apiRes.json();
        if (!apiRes.ok) {
          res.status(502).json({error: "Gemini API error", detail: data});
          return;
        }
        const text = data.candidates && data.candidates[0] &&
          data.candidates[0].content && data.candidates[0].content.parts &&
          data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        if (!text) {
          res.status(502).json({error: "No response text from Gemini", detail: data});
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          res.status(502).json({error: "Could not parse Gemini JSON output", raw: text});
          return;
        }
        if (Array.isArray(parsed.players)) {
          parsed.players = parsed.players.map((p) => ({
            ...p,
            dots: Array.isArray(p.holeDots) ? p.holeDots.reduce((a, b) => a + (Number(b) || 0), 0) : 0,
          }));
        }
        res.json(parsed);
      } catch (e) {
        res.status(500).json({error: String(e && e.message || e)});
      }
    },
);
