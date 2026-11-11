import { defineConfig } from 'vite';

// Relative base so the build works both at a domain root and under
// https://<user>.github.io/<repo>/ without configuration.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
});
