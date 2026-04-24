import esbuild from 'esbuild';

Promise.all([
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
    }),
    // render-worker.js must exist as a separate file at dist/render-worker.js because
    // exporter.js spawns it via worker_threads using new URL("./render-worker.js", import.meta.url),
    // which resolves relative to the bundled index.cjs at /app/dist/render-worker.js.
    esbuild.build({
        entryPoints: ['node_modules/mudlet-map-diff/dist/render-worker.js'],
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'esm',
        outfile: 'dist/render-worker.js',
        external: ['canvas', 'svgo'],
    }),
]).catch((err) => {
    console.error(err);
    process.exit(1);
});