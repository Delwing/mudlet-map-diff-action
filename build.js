import esbuild from 'esbuild';

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