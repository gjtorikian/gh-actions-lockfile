import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
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
  integrations: [
    react(),
    tailwind({
      applyBaseStyles: false,
    }),
  ],
});
