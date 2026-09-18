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
          dots: {type: "integer"},
        },
        required: ["writtenName", "holes", "dots"],
      },
    },
    notes: {type: "string"},
  },
  required: ["players"],
};

function buildPrompt(rosterNames) {
  return `You are reading a photo of a handwritten golf scorecard. Each row on the card is one player; each column is one of 18 holes, showing that player's gross strokes for that hole.

Dots: on this card, a "dot" won on a hole is marked as a small dot/period written directly above (or immediately beside) that hole's score number — it is NOT a separate written total. Some hole scores will have no dot, some will have one, and occasionally a hole could have more than one dot mark. To get a player's total dots, carefully look at every one of their 18 hole cells for these small marks and count them up across all 18 holes.

For each player row, return:
- writtenName: the name exactly as handwritten on the card (best-effort transcription).
- matchedRosterName: if the written name clearly matches one of these known roster names, return that exact roster name; otherwise null. Known roster names: ${rosterNames.length ? rosterNames.join(", ") : "(none provided)"}.
- holes: an array of exactly 18 integers, the gross strokes for holes 1 through 18 in order (the number itself, not counting any dot mark above it). If a value is illegible or missing, use 0 for that hole and mention it in notes.
- dots: the player's total dot count for the round, computed by counting the small dot marks above their 18 hole scores as described above (0 if none visible).

Take care to distinguish the gross-score digit from the small dot mark above it — they are two different pieces of information in the same cell. Also return a top-level "notes" string describing anything ambiguous, illegible, or uncertain that a human reviewer should double check.

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
        res.json(parsed);
      } catch (e) {
        res.status(500).json({error: String(e && e.message || e)});
      }
    },
);
