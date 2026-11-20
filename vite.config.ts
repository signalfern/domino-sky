import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Local dev only: serve /api/dispatch with the same code the Vercel function uses. */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/dispatch', async (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'Use POST' });
        if (!env.GEMINI_API_KEY) return send(503, { error: 'AI dispatcher is not configured (GEMINI_API_KEY missing)' });
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          const mod = await server.ssrLoadModule('/src/server/gemini.ts');
          const input = mod.validateBody(raw);
          send(200, await mod.callGemini(input, env.GEMINI_API_KEY, env.GEMINI_MODEL));
        } catch (e) {
          send(502, { error: e instanceof Error ? e.message : 'Gemini call failed' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), devApi(env)],
    build: { target: 'es2022', cssMinify: true, sourcemap: false },
    server: { port: 5173 },
  };
});
