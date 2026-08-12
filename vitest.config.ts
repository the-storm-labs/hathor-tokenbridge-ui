import { defineConfig } from 'vitest/config'

// Deliberately NOT extending vite.config.js. That config sets `root: 'src'` and
// registers a build-only plugin with a closeBundle hook that copies legacy
// assets — both of which confuse test resolution. Tests run from the repo root
// against src/app only.
export default defineConfig({
  root: '.',
  test: {
    environment: 'node',
    include: ['src/app/**/*.test.ts'],
    // Phase 1 ships the toolchain before any test exists; without this, vitest
    // exits 1 on an empty suite and CI is red for a reason that is not a defect.
    // The domain tests land in Phase 2.
    passWithNoTests: true,
    // jsdom arrives later, with the UI component/template tests.
  },
})
