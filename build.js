import esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';

mkdirSync('dist', { recursive: true });
// Ensure Node.js treats dist/*.js as CJS (overrides root "type": "module")
writeFileSync('dist/package.json', JSON.stringify({ type: 'commonjs' }));

esbuild.build({
    entryPoints: ['index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist/index.cjs',
    external: ['canvas', 'svgo'],
    define: {
        'import.meta.url': 'globalImportMetaUrl'
    },
    banner: {
        js: `const globalImportMetaUrl = require('url').pathToFileURL(__filename).href;`
    }
}).catch((err) => {
    console.error(err);
    process.exit(1);
});