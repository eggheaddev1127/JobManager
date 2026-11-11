import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import net from 'node:net';

const API_SOCKET = '/tmp/job-manager-api.sock';

// Route every proxied API connection to the API's Unix domain socket. http-proxy
// uses this agent to open the upstream connection; overriding createConnection
// makes it dial the socket regardless of the (otherwise ignored) target host.
// Why a Unix socket: this host's TCP loopback stalls ~30% of POST request bodies
// for seconds — the body never arrives, the save hangs, and the Cloudflare
// tunnel returns a 524. Unix sockets bypass the TCP/IP stack entirely, so this
// proxy→API hop is reliable. The API also keeps a TCP listener on [::1]:4000.
// On Windows (local dev) there's no Unix socket — proxy over TCP to the API's
// 127.0.0.1:4000 listener instead. Override with API_TARGET if needed.
const useSocket = process.platform !== 'win32' && !process.env.API_TARGET;
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:4000';
const socketAgent = new http.Agent({ keepAlive: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(socketAgent as any).createConnection = () => net.connect(API_SOCKET);

// Shared server options: listen on dual-stack IPv6, allow the tunnel hosts, and
// proxy /api to the API's Unix socket. Used by BOTH the dev server and preview.
const commonServer = {
  port: 5173,
  // Listen on IPv6 (dual-stack) so the Cloudflare tunnel can reach us over the
  // IPv6 loopback (::1). The IPv4 loopback on this host drops ~7% of new
  // connections, which surfaced as intermittent 502s through the tunnel.
  host: '::' as const,
  allowedHosts: ['jobmanager.dynamicbyte.net', 'job.dynamicbyte.net', 'localhost', '127.0.0.1'],
  proxy: {
    '/api': {
      // With the socket agent, host/port are ignored — it dials API_SOCKET.
      target: useSocket ? 'http://localhost:4000' : API_TARGET,
      changeOrigin: true,
      ...(useSocket ? { agent: socketAgent } : {}),
    },
  },
};

export default defineConfig({
  plugins: [react()],
  // `npm run dev` — dev server with HMR (has the tunnel refresh quirk).
  server: commonServer,
  // `npm run preview` — serves the built static assets from dist/. No HMR client,
  // so no spurious tunnel reloads, and bundled assets are faster than dev. This is
  // the recommended way to run the app through the Cloudflare tunnel. Rebuild
  // (`npm run build`) after code changes, then the preview picks them up.
  preview: commonServer,
});
