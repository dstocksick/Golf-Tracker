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
        },
        required: ["writtenName", "holes"],
      },
    },
    notes: {type: "string"},
  },
  required: ["players"],
};

const HOLE_RANGES = {
  front: {startHole: 1, count: 9, label: "holes 1 through 9 (the front nine)"},
  back: {startHole: 10, count: 9, label: "holes 10 through 18 (the back nine)"},
  full: {startHole: 1, count: 18, label: "all 18 holes"},
};

function buildPrompt(rosterNames, range) {
  const {startHole, count, label} = range;
  const endHole = startHole + count - 1;
  return `You are reading a photo of a handwritten golf scorecard. This photo shows ${label} — physical scorecards are often folded in half, so you may only be looking at one half of the full card. Each row on the card is one player; each column is one of the ${count} holes visible here (hole ${startHole} through hole ${endHole}), showing that player's gross strokes for that hole. Do not expect to see any holes outside this range on this photo — if the photo shows more or fewer columns than ${count}, read exactly what's there and note the discrepancy.

Work column-by-column, not just row-by-row, to avoid drift:
1. First locate the printed hole-number header row (it should read ${startHole} through ${endHole}, though a folded card may also show a printed "OUT" or "IN" subtotal column at the end — ignore that subtotal column, it is not a hole) and note the horizontal position of each hole's column.
2. For each player row, read each hole's value by lining it up with that same hole's column position from the header — do not just read left-to-right and assume even spacing, since handwritten digits are not always evenly spaced or perfectly aligned under their column. If a row looks shifted relative to the header, re-check which column each digit actually falls under before recording it.
3. After reading all ${count} holes for a player, sanity-check that you have exactly ${count} values and that none were skipped or double-counted into the wrong column.

Digit accuracy: handwritten digits are easy to confuse — pay close attention to pairs that commonly get mixed up, especially 4 vs 7 (a 4 has a closed or crossed vertical stroke; a 7 has a single diagonal stroke with no vertical crossbar), as well as 3 vs 8, 1 vs 7, and 0 vs 6. When genuinely uncertain between two digits for a cell, pick your best guess but mention the ambiguity in notes.

Ignore any small dot/period marks written above the score numbers — those are not part of the score and should not be transcribed or reported.

For each player row, return:
- writtenName: the name exactly as handwritten on the card (best-effort transcription).
- matchedRosterName: if the written name clearly matches one of these known roster names, return that exact roster name; otherwise null. Known roster names: ${rosterNames.length ? rosterNames.join(", ") : "(none provided)"}.
- holes: an array of exactly ${count} integers, the gross strokes for hole ${startHole} through hole ${endHole} in that order (not the subtotal column). If a value is illegible or missing, use 0 for that hole and mention it in notes.

Also return a top-level "notes" string describing anything ambiguous, illegible, or uncertain that a human reviewer should double check — including any hole where you had to choose between two similar-looking digits, any row where column alignment was unclear, or if the photo didn't actually seem to show ${label}.

Respond with JSON matching the given schema only.`;
}

exports.parseScorecard = onRequest(
    {secrets: [geminiApiKey], cors: true, memory: "512MiB", timeoutSeconds: 60},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({error: "Method not allowed"});
        return;
      }

      const {imageBase64, mimeType, rosterNames, model, temperature, holeRange} = req.body || {};
      if (!imageBase64) {
        res.status(400).json({error: "imageBase64 is required"});
        return;
      }
      const range = HOLE_RANGES[holeRange] || HOLE_RANGES.full;

      const modelToUse = model || GEMINI_MODEL;
      const body = {
        contents: [{
          parts: [
            {text: buildPrompt(Array.isArray(rosterNames) ? rosterNames : [], range)},
            {inline_data: {mime_type: mimeType || "image/jpeg", data: imageBase64}},
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: typeof temperature === "number" ? temperature : 0,
        },
      };

      try {
        const apiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${geminiApiKey.value()}`,
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
        res.json(parsed);
      } catch (e) {
        res.status(500).json({error: String(e && e.message || e)});
      }
    },
);
