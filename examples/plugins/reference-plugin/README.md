# Plugin de referencia

Demuestra el lifecycle completo sin cambiar la corrida. Cada hook agrega una
línea JSON a `.commander/reference-plugin.log`:

```bash
mkdir -p .commander/plugins/reference-plugin
cp examples/plugins/reference-plugin/index.js .commander/plugins/reference-plugin/index.js
cp examples/plugins/reference-plugin/plugin.json .commander/plugins/reference-plugin/plugin.json
```

Después, ejecuta una sesión del agente. El orden esperado en una corrida normal
es:

1. `sessionStart`
2. `beforeModel` / `afterModel` por cada llamada al modelo
3. `beforeTool` / `afterTool` por cada tool (también las de `loadContext`)
4. `sessionEnd` al cerrar bien

Si la corrida se cancela se registra `stop`; si falla, `error`. Son cierres
alternativos: no se suman a `sessionEnd`.

## Contrato

- `plugin.json` declara `apiVersion: 1` y los permisos `lifecycle` y `tools`. El runtime valida el manifiesto antes de importar el módulo; sin él el plugin se trataría como legado.
- Los plugins corren en orden alfabético por id.
- Cada hook tiene un timeout de 5 s por defecto; un hook colgado no bloquea la
  corrida más allá de ese tope.
- Un hook que lanza se anota en los errores del runtime y no impide que corran
  los demás ni que la sesión continúe.
- Los hooks de sesión y modelo son observacionales. Sólo `beforeTool` y
  `afterTool` pueden reemplazar datos devolviendo `{ input }` / `{ result }`.
- `COMMANDER_REFERENCE_PLUGIN_LOG` permite cambiar el fichero de registro.
