import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/noop',
    },
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: 'solarized-light',
        dark: 'solarized-dark',
      },
      defaultColor: false,
    },
  },
  integrations: [react(), mdx()],
});
