import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[Transcribe] Request received");

        // --- Get Groq API key from environment ---
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          console.error("[Transcribe] GROQ_API_KEY is missing");
          return new Response(JSON.stringify({ error: "GROQ_API_KEY missing" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        console.log("[Transcribe] GROQ_API_KEY present (first 8 chars):", apiKey.slice(0, 8));

        // --- Parse form data ---
        let formData;
        try {
          formData = await request.formData();
        } catch (err) {
          console.error("[Transcribe] Failed to parse form data:", err);
          return new Response(JSON.stringify({ error: "Invalid form data" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const file = formData.get("file");
        if (!(file instanceof Blob)) {
          console.error("[Transcribe] No file or file is not a Blob");
          return new Response(JSON.stringify({ error: "Missing audio file" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.log(`[Transcribe] File received: size=${file.size}, type=${file.type || "unknown"}`);

        if (file.size < 1024) {
          console.warn("[Transcribe] File too small (< 1024 bytes)");
          return new Response(JSON.stringify({ error: "Recording too short" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // --- Determine file extension from MIME type ---
        const mime = (file.type || "audio/webm").split(";")[0];
        const extMap: Record<string, string> = {
          "audio/webm": "webm",
          "audio/mp4": "mp4",
          "audio/mpeg": "mp3",
          "audio/wav": "wav",
          "audio/ogg": "ogg",
        };
        const ext = extMap[mime] ?? "webm";
        console.log(`[Transcribe] MIME: ${mime}, using extension: ${ext}`);

        // --- Build request to Groq ---
        const groqForm = new FormData();
        groqForm.append("file", file, `recording.${ext}`);
        // whisper-large-v3 = highest accuracy (turbo trades accuracy for speed)
        groqForm.append("model", "whisper-large-v3");
        groqForm.append("language", "en");
        groqForm.append("temperature", "0");
        groqForm.append(
          "prompt",
          "English only. Transcribe verbatim in English. Ignore non-English speech."
        );
        groqForm.append("response_format", "json");


        const url = "https://api.groq.com/openai/v1/audio/transcriptions";
        console.log(`[Transcribe] Sending request to Groq: ${url}`);

        let response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: groqForm,
          });
        } catch (err) {
          console.error("[Transcribe] Network error calling Groq:", err);
          return new Response(JSON.stringify({ error: "Failed to connect to Groq API" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.log(`[Transcribe] Groq response status: ${response.status}`);

        // --- Handle response ---
        let data;
        try {
          data = await response.json();
        } catch (err) {
          console.error("[Transcribe] Failed to parse Groq JSON response:", err);
          // fallback: try to get text
          const text = await response.text();
          console.error("[Transcribe] Raw response text:", text);
          return new Response(JSON.stringify({ error: "Invalid response from Groq", details: text }), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!response.ok) {
          console.error("[Transcribe] Groq returned error:", data);
          return new Response(JSON.stringify({ error: "Transcription failed", details: data }), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        const transcript = data.text;
        console.log(`[Transcribe] Transcription successful, length: ${transcript?.length || 0}`);

        return new Response(JSON.stringify({ text: transcript }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
