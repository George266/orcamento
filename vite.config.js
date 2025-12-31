import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        acompanhamento_instituto: resolve(__dirname, 'acompanhamento_instituto.html'),
        acompanhamento_orcamento: resolve(__dirname, 'acompanhamento_orcamento.html'),
        configuracao: resolve(__dirname, 'configuracao.html'),
        dashboard_instituto: resolve(__dirname, 'dashboard_instituto.html'),
        dashboard_orcamento: resolve(__dirname, 'dashboard_orcamento.html'),
        lancamento: resolve(__dirname, 'lancamento.html'),
        login: resolve(__dirname, 'login.html'),
      },
    },
  },
});
