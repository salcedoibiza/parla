# Parla

Traductor de conversación: cada uno en su móvil, cada uno en su idioma.

- Web: https://salcedoibiza.github.io/parla/
- App Android (versión de prueba): https://salcedoibiza.github.io/parla/parla.apk

## Cómo está hecho
- `web/src`: la app (la misma para la web y para Android).
- `android/`: la parte de Android (voz, lector de texto y traducción sin conexión de Google ML Kit, permisos). Se compila en GitHub Actions (`.github/workflows/android.yml`).
- `tools/`: compilación de la web y pruebas con móviles simulados.
- `docs/`: la web publicada con GitHub Pages.

## Traducción
- Con internet: el traductor web de Google.
- En el propio dispositivo (al momento y sin internet):
  - App Android: ML Kit de Google.
  - Web, y en la app los idiomas que ML Kit no tiene (euskera, serbio): los modelos de
    [Firefox Translations](https://github.com/mozilla/translations) de Mozilla (MPL-2.0),
    con el motor [Bergamot](https://github.com/browsermt/bergamot-translator) (MPL-2.0) en WebAssembly
    (`web/public/mt-worker.js`, `web/src/core/mt.js`). Los modelos se descargan de la copia pública
    `midudev/firefox-translations` en Hugging Face. La lista de modelos (`web/src/core/mtindex-data.js`)
    se genera con `tools/mtindex.mjs` a partir del registro de Mozilla.
