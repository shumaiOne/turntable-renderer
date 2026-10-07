import json
import math
import os
import sys
import bpy
import mathutils

# Add current directory to sys.path so we can import helper modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from importers import clear_scene, import_model
from metadata import extract_metadata


def hex_to_rgb(hex_str: str):
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    r = int(hex_str[0:2], 16) / 255.0
    g = int(hex_str[2:4], 16) / 255.0
    b = int(hex_str[4:6], 16) / 255.0
    return (r, g, b)


def compute_bounds_and_center():
    min_coord = [float("inf"), float("inf"), float("inf")]
    max_coord = [float("-inf"), float("-inf"), float("-inf")]
    mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]

    if not mesh_objects:
        return [0.0, 0.0, 0.0], 1.0

    for obj in mesh_objects:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                min_coord[i] = min(min_coord[i], world_corner[i])
                max_coord[i] = max(max_coord[i], world_corner[i])

    center = [
        (min_coord[0] + max_coord[0]) / 2.0,
        (min_coord[1] + max_coord[1]) / 2.0,
        (min_coord[2] + max_coord[2]) / 2.0,
    ]

    # Calculate bounding radius from center
    max_dist_sq = 0.0
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            dist_sq = (
                (world_corner[0] - center[0]) ** 2
                + (world_corner[1] - center[1]) ** 2
                + (world_corner[2] - center[2]) ** 2
            )
            if dist_sq > max_dist_sq:
                max_dist_sq = dist_sq

    radius = math.sqrt(max_dist_sq) if max_dist_sq > 0 else 1.0
    return center, radius


def setup_world(background_opt):
    scene = bpy.context.scene
    scene.use_nodes = True
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    nodes.clear()

    bg_node = nodes.new(type="ShaderNodeBackground")
    output_node = nodes.new(type="ShaderNodeOutputWorld")

    bg_color = (0.0, 0.0, 0.0, 1.0)
    if isinstance(background_opt, dict) and background_opt.get("type") == "color":
        c = hex_to_rgb(background_opt.get("color", "#000000"))
        bg_color = (c[0], c[1], c[2], 1.0)

    bg_node.inputs["Color"].default_value = bg_color
    bg_node.inputs["Strength"].default_value = 1.0

    world.node_tree.links.new(bg_node.outputs["Background"], output_node.inputs["Surface"])


def setup_lighting(lighting_type: str, radius: float, distance: float, intensity: float):
    # Studio-dark low-key lighting
    # Overhead softbox
    overhead_data = bpy.data.lights.new(name="OverheadSoftbox", type="AREA")
    overhead_data.energy = 100.0 * (radius**2) * intensity
    overhead_data.size = radius * 2.5
    overhead_data.color = (0.95, 0.95, 1.0)

    overhead = bpy.data.objects.new(name="OverheadSoftbox", object_data=overhead_data)
    overhead.location = (0.0, 0.0, radius * 2.5)
    overhead.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.collection.objects.link(overhead)

    # Left strip light
    left_data = bpy.data.lights.new(name="LeftStrip", type="AREA")
    left_data.energy = 80.0 * (radius**2) * intensity
    left_data.size = radius * 0.4
    left_data.size_y = radius * 2.5
    left_data.color = (1.0, 1.0, 1.0)

    left_light = bpy.data.objects.new(name="LeftStrip", object_data=left_data)
    left_light.location = (-radius * 2.0, 0.0, radius * 0.8)
    left_light.rotation_euler = (0.0, math.radians(70), 0.0)
    bpy.context.collection.objects.link(left_light)

    # Right strip light
    right_data = bpy.data.lights.new(name="RightStrip", type="AREA")
    right_data.energy = 80.0 * (radius**2) * intensity
    right_data.size = radius * 0.4
    right_data.size_y = radius * 2.5
    right_data.color = (1.0, 1.0, 1.0)

    right_light = bpy.data.objects.new(name="RightStrip", object_data=right_data)
    right_light.location = (radius * 2.0, 0.0, radius * 0.8)
    right_light.rotation_euler = (0.0, math.radians(-70), 0.0)
    bpy.context.collection.objects.link(right_light)


def setup_camera(radius: float, framing_margin: float, fov_deg: float, elevation_deg: float):
    half_fov = math.radians(fov_deg / 2.0)
    distance = (radius * framing_margin) / math.tan(half_fov)

    cam_data = bpy.data.cameras.new("RenderCamera")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov_deg)

    cam_obj = bpy.data.objects.new("RenderCamera", cam_data)
    elev_rad = math.radians(elevation_deg)

    # Position camera with elevation angle
    cam_obj.location = (
        0.0,
        -distance * math.cos(elev_rad),
        distance * math.sin(elev_rad),
    )

    # Point directly at (0, 0, 0)
    cam_obj.rotation_euler = (
        math.radians(90.0 - elevation_deg),
        0.0,
        0.0,
    )

    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    return cam_obj, distance


def normalize_scene():
    center, radius = compute_bounds_and_center()

    root_empty = bpy.data.objects.new("ModelRoot", None)
    root_empty.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(root_empty)

    # Parent all root objects to ModelRoot
    for obj in list(bpy.data.objects):
        if obj != root_empty and obj.parent is None:
            # Shift translation so bounding box center is at origin
            obj.location.x -= center[0]
            obj.location.y -= center[1]
            obj.location.z -= center[2]
            obj.parent = root_empty

    return root_empty, radius


def get_action_fcurves(action):
    if not action:
        return []
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    fcurves = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    fcurves.extend(cb.fcurves)
    return fcurves


def setup_animation(root_empty, frames: int, total_degrees: float, start_angle: float, direction: str, include_end_frame: bool):
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames

    n_prime = (frames - 1) if include_end_frame else frames
    n_prime = max(1, n_prime)

    root_empty.animation_data_create()
    root_empty.animation_data.action = bpy.data.actions.new(name="TurntableRotation")

    for i in range(frames):
        turn_i = start_angle + (i * total_degrees / n_prime)
        sign = -1.0 if direction == "cw" else 1.0
        z_angle = sign * math.radians(turn_i)

        root_empty.rotation_euler = (0.0, 0.0, z_angle)
        root_empty.keyframe_insert(data_path="rotation_euler", frame=i + 1)

    # Set linear interpolation for rotation
    for fcurve in get_action_fcurves(root_empty.animation_data.action):
        for kf in fcurve.keyframe_points:
            kf.interpolation = "LINEAR"


def configure_render_engine(samples: int = 16):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples


def configure_video_encoding(output_path: str, width: int, height: int, fps: int, format_type: str):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.fps = fps

    scene.render.filepath = output_path
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4" if format_type == "mp4" else "WEBM"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"

    # Mirror Frame.io keyframe GOP parameters: single GOP across animation, no B-frames
    scene.render.ffmpeg.gopsize = scene.frame_end
    scene.render.ffmpeg.max_b_frames = 0
    scene.render.image_settings.color_mode = "RGB"


def main():
    argv = sys.argv
    if "--" not in argv:
        print("Usage: blender -b -P render.py -- <task.json>")
        sys.exit(1)

    task_file = argv[argv.index("--") + 1]
    with open(task_file, "r") as f:
        task = json.load(f)

    input_file = task["inputFile"]
    format_type = task.get("format", os.path.splitext(input_file)[1].lstrip("."))
    output_dir = task["outputDir"]
    outputs = task.get("outputs", ["video"])
    options = task.get("options", {})

    os.makedirs(output_dir, exist_ok=True)

    # 1. Clear scene & Import model
    clear_scene()
    import_model(input_file, format_type)

    # 2. Extract and save metadata
    metadata = extract_metadata(format_type)
    metadata_path = os.path.join(output_dir, "metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    needs_render = "video" in outputs or "poster" in outputs
    artifacts = []

    if needs_render:
        root_empty, radius = normalize_scene()

        # Options with defaults
        width = options.get("width", 1080)
        height = options.get("height", 1080)
        frames = options.get("frames", 24)
        fps = options.get("fps", 6)
        total_degrees = options.get("totalDegrees", 360.0)
        start_angle = options.get("startAngle", 0.0)
        direction = options.get("direction", "cw")
        include_end_frame = options.get("includeEndFrame", False)
        framing_margin = options.get("framingMargin", 1.35)
        fov_deg = options.get("fovDegrees", 35.0)
        elevation_deg = options.get("elevationDegrees", 10.0)
        lighting_type = options.get("lighting", "studio-dark")
        lighting_intensity = options.get("lightingIntensity", 1.0)
        samples = options.get("samples", 16)
        video_format = options.get("format", "mp4")

        setup_world(options.get("background", {"type": "color", "color": "#000000"}))
        cam_obj, distance = setup_camera(radius, framing_margin, fov_deg, elevation_deg)
        setup_lighting(lighting_type, radius, distance, lighting_intensity)
        setup_animation(root_empty, frames, total_degrees, start_angle, direction, include_end_frame)
        configure_render_engine(samples)

        if "video" in outputs:
            if video_format == "png-sequence":
                frames_dir = os.path.join(output_dir, "frames")
                os.makedirs(frames_dir, exist_ok=True)
                scene.render.resolution_x = width
                scene.render.resolution_y = height
                scene.render.fps = fps
                scene.render.filepath = os.path.join(frames_dir, "frame_")
                if hasattr(scene.render.image_settings, "media_type"):
                    scene.render.image_settings.media_type = "IMAGE"
                scene.render.image_settings.file_format = "PNG"
                bpy.ops.render.render(animation=True)

                import zipfile
                zip_path = os.path.join(output_dir, "turntable_frames.zip")
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                    for root, _, files in os.walk(frames_dir):
                        for f in sorted(files):
                            abs_p = os.path.join(root, f)
                            rel_p = os.path.relpath(abs_p, frames_dir)
                            zf.write(abs_p, rel_p)

                artifacts.append({
                    "name": "video",
                    "filename": "turntable_frames.zip",
                    "contentType": "application/zip",
                    "width": width,
                    "height": height,
                })
            else:
                video_output_path = os.path.join(output_dir, f"turntable.{video_format}")
                configure_video_encoding(video_output_path, width, height, fps, video_format)
                bpy.ops.render.render(animation=True)
                artifacts.append({
                    "name": "video",
                    "filename": f"turntable.{video_format}",
                    "contentType": f"video/{video_format}",
                    "width": width,
                    "height": height,
                })

        if "poster" in outputs:
            poster_opt = options.get("poster", {})
            poster_angle = poster_opt.get("angle", 0.0) if isinstance(poster_opt, dict) else 0.0
            sign = -1.0 if direction == "cw" else 1.0
            root_empty.rotation_euler = (0.0, 0.0, sign * math.radians(poster_angle))

            poster_path = os.path.join(output_dir, "poster.png")
            bpy.context.scene.render.filepath = poster_path
            if hasattr(bpy.context.scene.render.image_settings, "media_type"):
                bpy.context.scene.render.image_settings.media_type = "IMAGE"
            bpy.context.scene.render.image_settings.file_format = "PNG"
            bpy.ops.render.render(write_still=True)
            artifacts.append({
                "name": "poster",
                "filename": "poster.png",
                "contentType": "image/png",
                "width": width,
                "height": height,
            })

    if "glb" in outputs:
        glb_path = os.path.join(output_dir, "model.glb")
        bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB")
        artifacts.append({
            "name": "glb",
            "filename": "model.glb",
            "contentType": "model/gltf-binary",
        })

    if "usdz" in outputs:
        usdz_path = os.path.join(output_dir, "model.usdz")
        bpy.ops.wm.usd_export(filepath=usdz_path)
        artifacts.append({
            "name": "usdz",
            "filename": "model.usdz",
            "contentType": "model/vnd.usdz+zip",
        })

    result_path = os.path.join(output_dir, "render_result.json")
    with open(result_path, "w") as f:
        json.dump({
            "status": "success",
            "metadata": metadata,
            "artifacts": artifacts,
        }, f, indent=2)

    print("Render task completed successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
