// Entrada del auto-updater.
//
// El asar del paquete excluye `node_modules` (pesaban ~190 MB de código que
// nunca se cargaba), así que `require('electron-updater')` no puede resolverse
// en la app instalada. Este archivo se bundlea con esbuild a
// `electron/updater.cjs`, que sí viaja dentro del asar, y `main.cjs` lo carga
// desde ahí. En desarrollo, si el bundle no existe todavía, `main.cjs` cae al
// `require('electron-updater')` normal.
module.exports = require('electron-updater');
