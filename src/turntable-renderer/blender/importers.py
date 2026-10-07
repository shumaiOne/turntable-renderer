import json
import os
import zipfile
import bpy


def clear_scene():
    """Removes all objects, meshes, materials, and orphan data from the scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def validate_gltf_self_contained(filepath: str):
    """
    Ensures that a .gltf file is self-contained.
    Rejects external URI references for buffers and images in v1.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise ValueError(f"Invalid .gltf JSON structure: {e}")

    for idx, buf in enumerate(data.get("buffers", [])):
        uri = buf.get("uri")
        if uri and not uri.startswith("data:"):
            raise ValueError(
                f"External reference rejected: buffer[{idx}] references external uri '{uri}'"
            )

    for idx, img in enumerate(data.get("images", [])):
        uri = img.get("uri")
        if uri and not uri.startswith("data:"):
            raise ValueError(
                f"External reference rejected: image[{idx}] references external uri '{uri}'"
            )


def validate_usdz_archive(filepath: str):
    """
    Validates that a .usdz file is a valid zip archive without path traversal attempts.
    """
    if not zipfile.is_zipfile(filepath):
        raise ValueError("Invalid USDZ file: not a valid zip container")

    with zipfile.ZipFile(filepath, "r") as zf:
        for name in zf.namelist():
            if name.startswith("/") or ".." in name:
                raise ValueError(f"Path traversal detected in USDZ archive entry: {name}")


def import_glb(filepath: str):
    bpy.ops.import_scene.gltf(filepath=filepath)


def import_gltf(filepath: str):
    validate_gltf_self_contained(filepath)
    bpy.ops.import_scene.gltf(filepath=filepath)


def import_usd(filepath: str):
    if filepath.lower().endswith(".usdz"):
        validate_usdz_archive(filepath)
    bpy.ops.wm.usd_import(filepath=filepath)


def import_fbx(filepath: str):
    if hasattr(bpy.ops.wm, "fbx_import"):
        bpy.ops.wm.fbx_import(filepath=filepath)
    else:
        bpy.ops.import_scene.fbx(filepath=filepath)


def import_obj(filepath: str):
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=filepath)
    else:
        bpy.ops.import_scene.obj(filepath=filepath)


def import_stl(filepath: str):
    bpy.ops.wm.stl_import(filepath=filepath)


def import_dae(filepath: str):
    bpy.ops.wm.collada_import(filepath=filepath)


def import_3ds(filepath: str):
    raise ValueError(
        "Autodesk 3DS (.3ds) format is not supported in Blender 4.5 LTS build."
    )


IMPORTER_REGISTRY = {
    "glb": import_glb,
    "gltf": import_gltf,
    "usd": import_usd,
    "usda": import_usd,
    "usdc": import_usd,
    "usdz": import_usd,
    "fbx": import_fbx,
    "obj": import_obj,
    "stl": import_stl,
    "dae": import_dae,
    "3ds": import_3ds,
}


def import_model(filepath: str, ext: str) -> None:
    """
    Imports a 3D model into an empty scene using the registered importer for its extension.
    """
    clean_ext = ext.lower().lstrip(".")

    if clean_ext not in IMPORTER_REGISTRY:
        raise ValueError(f"Unsupported file format: .{clean_ext}")

    importer_fn = IMPORTER_REGISTRY[clean_ext]
    importer_fn(filepath)
