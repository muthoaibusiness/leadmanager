// The app shares the web CRM's domain logic (../src/lib, and the access rules in
// ../supabase/functions/_shared) instead of copying it, so a rule changed for
// the web is changed for the phone too. Metro therefore watches the repo root,
// and falls back to mobile/node_modules for packages the shared files import.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(repoRoot, 'src'), path.resolve(repoRoot, 'supabase', 'functions', '_shared')];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
// A shared file outside mobile/ would find the repo root's node_modules first.
// React must come from here whoever asks, so there is exactly one copy.
const SINGLETONS = /^(react|react-dom|react-native|react-native-web)(\/|$)/;
const anchor = path.join(projectRoot, 'index.js');
// Browser-only libraries a shared file loads lazily, inside a function the phone never calls:
// pdf.js and jsPDF (src/lib/floorPlan.js, shopDocs.js: the web's floor-plan editor and
// "build floor plans from the brochure"). Metro resolves even a lazy import() when it
// bundles, and `?url` is a Vite suffix it cannot read, so they resolve to an empty module.
const WEB_ONLY = /^(pdfjs-dist|jspdf)(\/|$)/;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (WEB_ONLY.test(moduleName)) return { type: 'empty' };
  if (SINGLETONS.test(moduleName) && !context.originModulePath.startsWith(projectRoot)) {
    return context.resolveRequest({ ...context, originModulePath: anchor }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
