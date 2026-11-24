import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const TRANSPARENT_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function devTileProxyPlugin(vworldKey: string): Plugin {
  return {
    name: 'exfish-dev-tile-proxy',
    configureServer(server) {
      server.middlewares.use('/api/haeroad-tile', async (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const z = Number(url.searchParams.get('z'));
          const x = Number(url.searchParams.get('x'));
          const y = Number(url.searchParams.get('y'));
          if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
            res.statusCode = 400;
            res.end('Invalid tile params');
            return;
          }
          const upstream = await fetch(
            `https://haeroadgis.nmpnt.go.kr:39923/gcen/mapset/tile/${z}/${x}/${y}?mapset=vt_maplabel_enc`,
            { signal: AbortSignal.timeout(4000) }
          );
          if (!upstream.ok) {
            res.setHeader('Content-Type', 'image/png');
            res.end(TRANSPARENT_1X1_PNG);
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
          res.end(buf.length > 0 ? buf : TRANSPARENT_1X1_PNG);
        } catch {
          res.setHeader('Content-Type', 'image/png');
          res.end(TRANSPARENT_1X1_PNG);
        }
      });

      server.middlewares.use('/api/vworld-tile', async (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const layer = url.searchParams.get('layer') || 'Base';
          const z = Number(url.searchParams.get('z'));
          const x = Number(url.searchParams.get('x'));
          const y = Number(url.searchParams.get('y'));
          const allowedLayers = new Set(['Base', 'Satellite', 'Hybrid', 'midnight']);
          if (!allowedLayers.has(layer) || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
            res.statusCode = 400;
            res.end('Invalid vworld tile params');
            return;
          }
          const ext = layer === 'Satellite' ? 'jpeg' : 'png';
          const upstreamUrl = vworldKey
            ? `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldKey)}/${layer}/${z}/${y}/${x}.${ext}`
            : `https://xdworld.vworld.kr/2d/${layer}/service/${z}/${x}/${y}.${ext}`;
          const upstream = await fetch(upstreamUrl, {
            headers: vworldKey ? { Referer: 'https://exfish.vercel.app/' } : undefined,
            signal: AbortSignal.timeout(4000),
          });
          if (!upstream.ok) {
            res.setHeader('Content-Type', 'image/png');
            res.end(TRANSPARENT_1X1_PNG);
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('Content-Type', upstream.headers.get('content-type') || `image/${ext}`);
          res.end(buf.length > 0 ? buf : TRANSPARENT_1X1_PNG);
        } catch {
          res.setHeader('Content-Type', 'image/png');
          res.end(TRANSPARENT_1X1_PNG);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const vworldKey = (env.VWORLD_API_KEY || '').trim();
  return {
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    devTileProxyPlugin(vworldKey),
  ],
  server: {
    proxy: {
      '/api-khoa': {
        target: 'https://apis.data.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-khoa/, ''),
      },
      '/api-swtc': {
        target: 'https://www.khoa.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-swtc/, ''),
      },
      '/api-openmeteo/forecast': {
        target: 'https://api.open-meteo.com/v1/forecast',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-openmeteo\/forecast/, ''),
      },
      '/api-openmeteo/marine': {
        target: 'https://marine-api.open-meteo.com/v1/marine',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-openmeteo\/marine/, ''),
      },
    },
  },
};
});
