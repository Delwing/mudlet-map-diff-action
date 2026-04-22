import esbuild from 'esbuild';

esbuild.build({
    entryPoints: ['index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist/index.cjs',
    external: ['canvas', 'svgo'],
    // 1. We define a global variable name that esbuild will accept
    define: {
        'import.meta.url': 'globalImportMetaUrl'
    },
    // 2. We inject the actual logic at the very top of the bundle
    banner: {
        js: `const globalImportMetaUrl = require('url').pathToFileURL(__filename).href;`
    }
}).catch((err) => {
    console.error(err);
    process.exit(1);
});