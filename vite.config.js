import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev: serves /api/* (the same files Vercel runs in production) so AI generation works with plain `npm run dev`.
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')          // reads .env and .env.local (secrets never reach the browser: only VITE_* is exposed there)
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v
      server.middlewares.use('/api', async (req, res, next) => {
        // TEST MODE (START-TEST.bat): never run the server routes, because they use the real Supabase service key and Gemini key from .env.local.
        if (process.env.VITE_TEST_MODE === '1') { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'Test mode: server features (AI generation, email) are switched off so the live database is never touched.' })) }
        const name = (req.url || '').split('?')[0].replace(/^\/+|\/+$/g, '')
        if (!/^[a-z0-9-]+$/i.test(name)) return next()
        const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        try {
          let mod
          try { mod = await server.ssrLoadModule(`/api/${name}.js`) } catch (e) { if (/Failed to load url|Cannot find module/i.test(String(e.message))) return send(404, { error: 'Unknown API route.' }); throw e }
          let raw = ''; for await (const chunk of req) raw += chunk
          req.body = raw ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : {}
          res.status = c => { res.statusCode = c; return res }
          res.json = o => send(res.statusCode || 200, o)
          await mod.default(req, res)
        } catch (e) { console.error('[api]', e); if (!res.headersSent) send(500, { error: String(e.message || e) }) }
      })
    },
  }
}

// v84: older WebViews (Facebook / Messenger / Instagram in-app browsers) choke on very new syntax: build for older engines and lower the CSS too.
export default defineConfig({
  plugins: [react(), devApi()],
  build: { target: ['es2018', 'chrome64', 'safari12', 'firefox68'], cssTarget: ['chrome64', 'safari12'] },
})
