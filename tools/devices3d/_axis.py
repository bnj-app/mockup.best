import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
# Blender axes: X right, -Y front (front view), Z up. Markers: 1 unit along +X, 2 along +Z, 3 along -Y.
for name, loc in [('px', (1, 0, 0)), ('pz', (0, 0, 2)), ('my', (0, -3, 0))]:
    bpy.ops.mesh.primitive_cube_add(size=0.2, location=loc)
    bpy.context.object.name = name
bpy.ops.export_scene.gltf(filepath='_axis.glb', export_format='GLB', export_apply=True)
