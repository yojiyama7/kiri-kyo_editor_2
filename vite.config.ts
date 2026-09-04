import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/kiri-kyo_editor_2/',
  plugins: [svelte()]
});
