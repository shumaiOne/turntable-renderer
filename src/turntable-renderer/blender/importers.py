import os
import bpy

def clear_scene():
    """Removes all objects, meshes, materials, and orphan data from the scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_model(filepath: str, ext: str) -> None:
    """
    Imports a 3D model into an empty scene based on its file extension.
    """
    ext = ext.lower().lstrip(".")

    if ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext in ("usd", "usda", "usdc", "usdz"):
        bpy.ops.wm.usd_import(filepath=filepath)
    elif ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=filepath)
    elif ext == "obj":
        # Blender 4.x uses bpy.ops.wm.obj_import
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=filepath)
        else:
            bpy.ops.import_scene.obj(filepath=filepath)
    elif ext == "stl":
        if hasattr(bpy.ops.wm, "stl_import"):
            bpy.ops.wm.stl_import(filepath=filepath)
        else:
            bpy.ops.import_mesh.stl(filepath=filepath)
    elif ext == "dae":
        bpy.ops.wm.collada_import(filepath=filepath)
    elif ext == "3ds":
        if hasattr(bpy.ops.import_scene, "autodesk_3ds"):
            bpy.ops.import_scene.autodesk_3ds(filepath=filepath)
        else:
            raise RuntimeError("3DS importer is not available in this Blender installation.")
    else:
        raise ValueError(f"Unsupported file format: .{ext}")
