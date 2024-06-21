import { build } from 'esbuild';

build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    outfile: './dist/worker.js',
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    minify: true,
    sourcemap: 'linked',
    external: ['__STATIC_CONTENT_MANIFEST'],
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
