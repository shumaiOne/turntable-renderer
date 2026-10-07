import bpy
import mathutils

def extract_metadata(input_format: str = "unknown") -> dict:
    """
    Extracts scene and geometry metadata from the current Blender scene.
    """
    mesh_count = 0
    polygon_count = 0
    triangle_count = 0
    materials = set()
    textures = set()

    min_coord = [float("inf"), float("inf"), float("inf")]
    max_coord = [float("-inf"), float("-inf"), float("-inf")]
    has_geometry = False

    for obj in bpy.data.objects:
        if obj.type == "MESH":
            mesh_count += 1
            mesh = obj.data

            # Count polygons & triangles
            polygon_count += len(mesh.polygons)
            for poly in mesh.polygons:
                if len(poly.vertices) == 3:
                    triangle_count += 1
                elif len(poly.vertices) == 4:
                    triangle_count += 2
                else:
                    triangle_count += max(1, len(poly.vertices) - 2)

            # Collect materials
            for mat_slot in obj.material_slots:
                if mat_slot.material:
                    materials.add(mat_slot.material.name)

            # Bounding box in world coordinates
            for corner in obj.bound_box:
                world_corner = obj.matrix_world @ mathutils.Vector(corner)
                for i in range(3):
                    min_coord[i] = min(min_coord[i], world_corner[i])
                    max_coord[i] = max(max_coord[i], world_corner[i])
                has_geometry = True

    # Image textures in Blender data
    for img in bpy.data.images:
        if not img.name.startswith("Render Result"):
            textures.add(img.name)

    if has_geometry:
        dimensions = [
            round(max_coord[0] - min_coord[0], 6),
            round(max_coord[1] - min_coord[1], 6),
            round(max_coord[2] - min_coord[2], 6),
        ]
    else:
        dimensions = [0.0, 0.0, 0.0]

    unit_settings = bpy.context.scene.unit_settings
    unit_str = "m"
    if unit_settings.system == "METRIC":
        unit_str = "m"
    elif unit_settings.system == "IMPERIAL":
        unit_str = "ft"
    elif unit_settings.system == "NONE":
        unit_str = "unknown"

    # Default up-axis convention by format
    fmt = input_format.lower().lstrip(".")
    if fmt in ("glb", "gltf", "fbx", "obj", "usd", "usda", "usdc", "usdz", "dae"):
        up_axis = "Y"
    else:
        up_axis = "Z"

    return {
        "format": fmt,
        "upAxis": up_axis,
        "unit": unit_str,
        "dimensions": dimensions,
        "meshCount": mesh_count,
        "materialCount": len(materials),
        "textureCount": len(textures),
        "polygonCount": polygon_count,
        "triangleCount": triangle_count,
    }
