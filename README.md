# Parla

Traductor de conversación: cada uno en su móvil, cada uno en su idioma.

- Web: https://salcedoibiza.github.io/parla/
- App Android (versión de prueba): https://salcedoibiza.github.io/parla/parla.apk

## Cómo está hecho
- `web/src`: la app (la misma para la web y para Android).
- `android/`: la parte de Android (voz, lector de texto de Google ML Kit, permisos). Se compila en GitHub Actions (`.github/workflows/android.yml`).
- `tools/`: compilación de la web y pruebas con móviles simulados.
- `docs/`: la web publicada con GitHub Pages.
