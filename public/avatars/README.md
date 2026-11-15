# Avatares PNG

El selector usa los PNG de esta carpeta cuando `manifest.json` tiene entradas.
Si está vacío, muestra los 12 avatares SVG integrados como respaldo.

## Guardar la captura

1. Guarda la hoja completa como **PNG original**, sin pasar por WhatsApp ni por un editor que la reescale. Por ejemplo, en `design/avatar-sheet.png`, **fuera** de `public/avatars/`.
2. No recortes los círculos: recorta una **celda cuadrada completa** por avatar. Si la hoja tiene separadores, deja fuera la línea.
3. Guarda cada celda como un PNG cuadrado, preferiblemente **256×256** o **512×512**. Si el original es menor, no lo amplíes; si es mayor, reduce con **nearest neighbor** para no emborronar el pixel art.
4. Nombra los archivos en orden: `avatar-01.png`, `avatar-02.png`, etc. El selector los ordena de forma natural por nombre.
5. Coloca sólo los recortes en `public/avatars/`. No pongas aquí la hoja completa.

## Generar el manifiesto

```bash
npm run avatars:sync
```

`npm run dev` y `npm run build` también lo regeneran. El script valida que sean
PNG, avisa si una imagen no es cuadrada y conserva las etiquetas que ya existan
en `manifest.json`.

No edites `manifest.json` a mano: se reconstruye a partir de los archivos.
