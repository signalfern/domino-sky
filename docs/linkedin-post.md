A 90-minute thunderstorm in Mumbai can cancel a flight five hours later, in a city with clear skies. ✈⛈

For #PromptWars I built **Domino Sky**: an interactive simulator that shows how one airport closure spreads across an airline network like falling dominoes.

🔹 Close any airport for any time window and watch the delay ripple through 70 flights and 16 aircraft on a live map and timeline.
🔹 Every late flight shows *why* it is late: closed airport, late inbound aircraft, held for a connection, crew out of legal duty hours.
🔹 Count stranded passengers, broken connections and crew duty breaches.
🔹 A Gemini-powered AI dispatcher recommends recovery plans (cancel a leg, swap in a spare aircraft, hold a flight for connecting passengers) and shows before vs after.

The key design rule: **the AI explains, the code calculates.** A deterministic TypeScript engine produces every number. Gemini must cite numbers as references to engine facts, and a verifier checks every number it writes before the answer is shown ("✓ 15/15 numbers match the engine"). If a check fails, a rule-based dispatcher takes over.

🔗 Live: https://domino-sky-five.vercel.app
💻 Code: https://github.com/signalfern/domino-sky

Built live in 3 hours with React, TypeScript, Vite, Vercel and the Gemini API.

@Google for Developers @Hack2skill

#PromptWars #GoogleForDevelopers #Hack2skill #Gemini #AI #Aviation #BuildInPublic
