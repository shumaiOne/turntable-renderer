# Supported 3D Formats

turntable-renderer v1 supports 3D formats natively importable by Blender 5.2 LTS (and 4.5+ LTS):

| Extension | Format Name | Blender Importer | Notes |
| :--- | :--- | :--- | :--- |
| `.glb` | glTF 2.0 Binary | `bpy.ops.import_scene.gltf` | Recommended. Self-contained geometry & textures. |
| `.gltf` | glTF 2.0 Text | `bpy.ops.import_scene.gltf` | Must be self-contained; external buffers rejected. |
| `.usd`, `.usda`, `.usdc`, `.usdz` | Universal Scene Description | `bpy.ops.wm.usd_import` | USDZ archives inspected before extraction. |
| `.fbx` | Autodesk Filmbox | `bpy.ops.import_scene.fbx` | Requires embedded textures. |
| `.obj` | Wavefront OBJ | `bpy.ops.wm.obj_import` | Untextured render if `.mtl` is missing. |
| `.stl` | Stereolithography | `bpy.ops.wm.stl_import` | Raw triangular mesh, no materials. |
| `.dae` | Collada DAE | `bpy.ops.wm.collada_import` | Standard Collada scene graph. |
| `.3ds` | 3D Studio | N/A | Removed in Blender 4.x. Returns `unsupported_format`. |

## Rejected Formats
- `.blend`: Strictly forbidden for security (Python script execution vector).
- CAD formats (`.step`, `.stp`, `.iges`, `.x_t`): Unsupported in v1, scheduled for Phase 4 WASM conversion.
