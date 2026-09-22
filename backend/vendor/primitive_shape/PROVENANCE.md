# Primitive-shape Lua reuse

Source: `D:/Codes/Miliastra-toolbox-primitive-shape`, local working tree, 2026-09-23.
These upstream files were untracked at import time; no commit SHA exists for them.
License: MIT, copyright (c) 2026 LiuL; retained in LICENSE.

`lua_export.py` and `gia_lua.py` are copied byte-for-byte. The application calls
`gia_lua.parse_material_gia` / `build_gia_lua` and uses the upstream ROOT/ELEMENTS
layout. The palette-based `lua_export.py` format is also accepted on import.
Do not introduce runtime dependencies on the original Windows path.

SHA-256:
- `lua_export.py`: `a04000fa64b91eda368dfb8a539ae3449fc5cb30bc188b43a79de93518c422e0`
- `gia_lua.py`: `33206fad07e5c236d0ef6c787a5d9f07fafb743717958626155af1a476b0254c`
