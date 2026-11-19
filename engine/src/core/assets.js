// The only place loaders are configured. Paths are relative to the site base (public/).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// ponytail: no KTX2Loader yet; add it here (needs renderer for detectSupport) when Phase 7 ships KTX2 textures.

const url = (p) => (import.meta.env?.BASE_URL ?? '/') + p.replace(/^\//, '');
const gltfLoader = new GLTFLoader()
  .setDRACOLoader(new DRACOLoader().setDecoderPath(url('draco/')))
  .setMeshoptDecoder(MeshoptDecoder);

let pending = 0;
let waiters = [];
function track(p) {
  pending++;
  return p.finally(() => { if (--pending === 0) waiters.splice(0).forEach((f) => f()); });
}

// optional=true: missing file resolves null instead of throwing. Vite answers missing paths with
// index.html (200, text/html), so we check content-type rather than status alone.
async function fetchOk(path, optional) {
  const r = await fetch(url(path));
  if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) return r;
  if (optional) return null;
  throw new Error(`asset missing: ${path}`);
}

export const assets = {
  url,
  json: (path, optional = false) => track(fetchOk(path, optional).then((r) => r && r.json())),
  arrayBuffer: (path, optional = false) => track(fetchOk(path, optional).then((r) => r && r.arrayBuffer())),
  gltf: (path, optional = false) => track(fetchOk(path, optional).then(async (r) =>
    r && gltfLoader.parseAsync(await r.arrayBuffer(), url(path).replace(/[^/]*$/, '')))),
  whenIdle: () => (pending ? new Promise((r) => waiters.push(r)) : Promise.resolve()),
};
