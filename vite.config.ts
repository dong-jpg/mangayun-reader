import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'MangaYun Reader',
        namespace: 'https://github.com/dong-jpg/mangayun-reader',
        version: '1.0.2',
        description: '云漫增强阅读器：横向/纵向连续、单页模式、进度记忆、章节下载（ZIP）',
        author: 'dong-jpg',
        match: ['https://mangayun.com/*'],
        'run-at': 'document-start',
        noframes: false,
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'GM_listValues',
          'GM_xmlhttpRequest',
          'GM_download',
        ],
        // 实测（docs/specs/site-probe-2026-10-24.md）会直连的图片域名；
        // 未列出的域名由 Tampermonkey 询问用户。
        connect: [
          'hamreus.com',
          'cdndm5.com',
          'ccavbox.com',
          'bgm.tv',
          'tuku.cc',
          'baozimh.com',
          'manhuazhijia.cc',
        ],
        license: 'MIT',
      },
      build: {
        fileName: 'mangayun-reader.user.js',
        externalGlobals: {},
      },
    }),
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
