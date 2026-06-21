// ... inside POST handler, after systemPrompt definition

const providers = resolveChatModels();
if (providers.length === 0) {
  return new Response(JSON.stringify({ error: "No AI providers configured. Please add an API key." }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

let result = null;
let lastError: Error | null = null;

for (const provider of providers) {
  try {
    result = streamText({
      model: provider.model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(8),
      onError: ({ error }) => {
        console.error(`[chat] ${provider.name} error:`, error);
      },
    });
    console.log(`[JARVIS] Using ${provider.name}`);
    break;
  } catch (error: any) {
    console.warn(`[JARVIS] ${provider.name} failed:`, error.message);
    lastError = error;
    continue;
  }
}

if (!result) {
  console.error("[JARVIS] All providers failed:", lastError);
  return new Response(JSON.stringify({ error: "All AI providers are currently unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}
