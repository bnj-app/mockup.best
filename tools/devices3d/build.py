"""
Device models — procedural generation with headless Blender.

Run without opening a window:
  blender -b --factory-startup -P tools/devices3d/build.py -- phone
Output: tools/devices3d/raw/<device>.glb (raw); publish with `node tools/devices3d/build-all.mjs`.

Rules:
- 1 unit = 1 cm. Center the body. In Blender, the screen faces −Y and up is +Z;
  glTF export maps these to screen +Z and up +Y (measured with tools/devices3d/_axis.py).
- Model hardware only: body, bezel, buttons, camera, keyboard, stand, etc.
  Screen, black bezel band, cover glass, notch, and status bar stay in
  Stage.tsx DeviceMesh; leave the front flat at y = −D/2.
- Materials match by name. Scene code replaces finish_* materials with the
  user's chosen finish; others (lens glass, ports, etc.) remain unchanged.
- No logos or brand names. Dimensions come from publicly available measurements.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# Raw GLBs go here; build-all.mjs compresses with meshopt into public/models.
OUT = os.path.join(ROOT, 'tools', 'devices3d', 'raw')


# ---------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATS = {}


def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, coat=0.0, coat_rough=0.05, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coat_rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = 1.0
    MATS[name] = m
    return m


def srgb(hexstr):
    """#rrggbb → linear RGB; Blender requires linear base colors."""
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def squircle(w, h, r, n=2.6, seg=24, scale=1.22):
    """Smooth rectangle outline with continuous-curvature corners as (u, v) points.

    Circular corners change curvature abruptly at straight edges, producing
    broken reflections. Superellipse corners ease in and out, creating
    continuous edge highlights like those in product photography.
    """
    re = min(r * scale, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    corners = [(w / 2 - re, h / 2 - re, 0), (-w / 2 + re, h / 2 - re, 1),
               (-w / 2 + re, -h / 2 + re, 2), (w / 2 - re, -h / 2 + re, 3)]
    for cx, cy, q in corners:
        for i in range(seg + 1):
            t = (q + i / seg) * math.pi / 2
            c, s = math.cos(t), math.sin(t)
            x = math.copysign(abs(c) ** (2 / n), c) * re
            y = math.copysign(abs(s) ** (2 / n), s) * re
            pts.append((cx + x, cy + y))
    # Remove duplicate endpoints.
    out = []
    for p in pts:
        if not out or (abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6):
            out.append(p)
    if abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


def capsule(length, width, seg=16):
    """Capsule outline with its long axis along v, for buttons and ports."""
    return squircle(width, length, width / 2 - 1e-4, n=2.0, seg=seg, scale=1.0)


def slab(name, outline, depth, center, material, bevel=0.0, bevel_seg=8, profile=0.5,
         axis='Y', harden=True):
    """Extrude a (u, v) outline by depth along axis to create a solid.

    axis='Y': u→X, v→Z (front/back parts)
    axis='X': u→Y, v→Z (side parts, such as buttons)
    axis='Z': u→X, v→Y (top/bottom parts, such as ports)
    """
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()

    def place(u, v, t):
        if axis == 'Y':
            return Vector((u, t, v))
        if axis == 'X':
            return Vector((t, u, v))
        return Vector((u, v, t))

    a = [bm.verts.new(place(u, v, -depth / 2)) for u, v in outline]
    b = [bm.verts.new(place(u, v, depth / 2)) for u, v in outline]
    n = len(outline)
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.location = center
    me.materials.append(material)
    ai = {'Y': 1, 'X': 0, 'Z': 2}[axis]
    for poly in me.polygons:
        # Flat-shade front/back faces on unbeveled parts. Smooth shading
        # averaged their corner normals with side faces, creating wavy
        # blotches on large flat surfaces such as phone back glass. Keep sides smooth.
        poly.use_smooth = bevel > 0 or abs(poly.normal[ai]) < 0.5
    if bevel > 0:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = bevel_seg
        md.profile = profile
        md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(50)
        md.harden_normals = harden
        md.use_clamp_overlap = True
    return ob


def disc(name, r, depth, center, material, axis='Y', bevel=0.0, seg=72):
    """Cylinder for lens rings, flash, and screws; defaults to the rear-facing Y axis."""
    out = [(r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    if axis == 'Y':
        # u→X, v→Z; circle in XZ, thickness along Y.
        return slab(name, out, depth, center, material, bevel=bevel, bevel_seg=6, axis='Y')
    return slab(name, out, depth, center, material, bevel=bevel, bevel_seg=6, axis=axis)


def ring(name, outer, inner, depth, center, material, bevel=0.0, bevel_seg=6):
    """Solid ring between equal-point-count outlines, for watch bezels and screen lips."""
    assert len(outer) == len(inner)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    n = len(outer)
    oa = [bm.verts.new(Vector((u, -depth / 2, v))) for u, v in outer]
    ob_ = [bm.verts.new(Vector((u, depth / 2, v))) for u, v in outer]
    ia = [bm.verts.new(Vector((u, -depth / 2, v))) for u, v in inner]
    ib = [bm.verts.new(Vector((u, depth / 2, v))) for u, v in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([oa[i], oa[j], ia[j], ia[i]])
        bm.faces.new([ob_[i], ib[i], ib[j], ob_[j]])
        bm.faces.new([oa[i], ob_[i], ob_[j], oa[j]])
        bm.faces.new([ia[i], ia[j], ib[j], ib[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.location = center
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = True
    if bevel > 0:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = bevel_seg
        md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(50)
        md.harden_normals = True
        md.use_clamp_overlap = True
    return ob


def strap(name, path, width, thick, material, seg_w=6):
    """Strap: rounded-edge ribbon along a (y, z) path, width along X."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    # Cross-section: width along X, thickness along path normal, semicircular edges.
    prof = []
    for i in range(seg_w + 1):
        a = -math.pi / 2 + math.pi * i / seg_w
        prof.append((width / 2 - thick / 2 + math.cos(a) * thick / 2, math.sin(a) * thick / 2))
    for i in range(seg_w + 1):
        a = math.pi / 2 + math.pi * i / seg_w
        prof.append((-width / 2 + thick / 2 + math.cos(a) * thick / 2, math.sin(a) * thick / 2))
    for k, (y, z) in enumerate(path):
        y0, z0 = path[max(0, k - 1)]
        y1, z1 = path[min(len(path) - 1, k + 1)]
        ty, tz = y1 - y0, z1 - z0
        L = math.hypot(ty, tz) or 1
        ny, nz = -tz / L, ty / L  # yol normali
        rings.append([bm.verts.new(Vector((px, y + ny * pn, z + nz * pn))) for px, pn in prof])
    m = len(prof)
    for k in range(len(rings) - 1):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]])
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = True
    return ob


def join_by_material(part_of=lambda ob: 'main'):
    """Join objects with the same material in each part into one mesh.

    A phone had ~70 objects and draw calls; three phones needed 210.
    One mesh per material reduces this to ~12 calls per phone. Keep laptop
    lid and base separate so the lid can rotate around its hinge.
    """
    for ob in list(bpy.data.objects):
        if ob.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = ob
        for md in list(ob.modifiers):
            ctx = {'object': ob}
            with bpy.context.temp_override(**ctx):
                bpy.ops.object.modifier_apply(modifier=md.name)
    groups = {}
    for ob in list(bpy.data.objects):
        if ob.type != 'MESH':
            continue
        key = (part_of(ob), ob.data.materials[0].name)
        groups.setdefault(key, []).append(ob)
    for (part, mname), obs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        obs[0].name = f'{part}__{mname}'
        obs[0]['part'] = part


def export(name, part_of=lambda ob: 'main'):
    join_by_material(part_of)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_apply=True,
        export_yup=True, export_normals=True, export_materials='EXPORT',
        export_cameras=False, export_lights=False,
    )
    print('YAZILDI', path, os.path.getsize(path))


# ---------------------------------------------------------------- phone

def build_phone(W=7.19, H=15.0, D=0.875, R=1.18, plateau_h=3.75, scale_name='phone'):
    """6.3"/6.9" class Pro phone: aluminum unibody and full-width camera plateau."""
    body_m = mat('finish_body', srgb('#d6d7da'), metal=1.0, rough=0.34)
    frame_m = mat('finish_frame', srgb('#d6d7da'), metal=1.0, rough=0.28)
    back_m = mat('back_glass', srgb('#d6d7da'), metal=0.0, rough=0.42, coat=0.4, coat_rough=0.25)
    ant_m = mat('antenna', srgb('#a9abaf'), metal=0.0, rough=0.5)
    lens_dark = mat('lens_dark', srgb('#0c0d10'), metal=0.2, rough=0.18, coat=1.0)
    lens_glass = mat('lens_glass', srgb('#06070a'), metal=0.0, rough=0.03, coat=1.0, coat_rough=0.01)
    lens_inner = mat('lens_inner', srgb('#1b2140'), metal=0.75, rough=0.18, coat=1.0)
    lens_core = mat('lens_core', srgb('#020203'), metal=0.0, rough=0.08, coat=1.0)
    flash_m = mat('flash', srgb('#efe6cf'), metal=0.0, rough=0.55, coat=0.6)
    port_m = mat('port_dark', srgb('#0b0b0c'), metal=0.1, rough=0.6)
    sapph = mat('control_glass', srgb('#1a1c21'), metal=0.0, rough=0.06, coat=1.0, coat_rough=0.02)
    screw_m = mat('screw', srgb('#8e9095'), metal=1.0, rough=0.3)

    # Body: softly rounded front/back edges for long, narrow product-shot highlights.
    slab('body', squircle(W, H, R), D, (0, 0, 0), body_m, bevel=0.095, bevel_seg=10, profile=0.62)

    back = D / 2  # Back face (Blender +Y).

    # Camera plateau: body-colored aluminum with rounded edges.
    px_in = 0.13
    pw = W - 2 * px_in
    ph = plateau_h
    pd = 0.17
    plateau_outline = squircle(pw, ph, min(R - px_in, ph / 2 - 0.01), seg=20)
    # Use the sandblasted body material for the plateau; polished frame material
    # made this large flat surface look mirror-black under HDR studio lighting.
    slab('plateau', plateau_outline, pd, (0, back + pd / 2 - 0.01, H / 2 - px_in - ph / 2),
         body_m, bevel=0.06, bevel_seg=8, profile=0.6)
    plat_face = back + pd - 0.01

    # Back glass panel: matte glass below the plateau, inset from the edges.
    gy0 = -H / 2 + 0.32
    gy1 = H / 2 - px_in - ph - 0.28
    gh = gy1 - gy0
    # No bevel: a 0.06 mm bevel created degenerate triangles/normals that
    # meshopt compression distorted, making the panel glow white.
    slab('back_glass', squircle(W - 0.62, gh, 0.85, seg=20), 0.03,
         (0, back + 0.004, gy0 + gh / 2), back_m)

    # Lenses: triangular arrangement on the left.
    top = H / 2 - px_in
    # ⚠️ Viewed from behind, +X appears on the left. The real camera is at
    # the rear upper left, hence Blender +X; the first version was mirrored.
    lenses = [(W / 2 - 1.33, top - 0.98), (W / 2 - 1.33, top - 2.77), (W / 2 - 2.82, top - 1.87)]
    for i, (lx, lz) in enumerate(lenses):
        ring_d = 0.16
        disc(f'lens{i}_ring', 0.76, ring_d, (lx, plat_face + ring_d / 2 - 0.01, lz), frame_m, bevel=0.035)
        f = plat_face + ring_d - 0.01
        disc(f'lens{i}_bezel', 0.64, 0.02, (lx, f + 0.004, lz), lens_dark, bevel=0.006)
        disc(f'lens{i}_glass', 0.56, 0.02, (lx, f + 0.008, lz), lens_glass, bevel=0.008)
        disc(f'lens{i}_inner', 0.3, 0.02, (lx, f + 0.012, lz), lens_inner, bevel=0.004)
        disc(f'lens{i}_core', 0.13, 0.02, (lx, f + 0.016, lz), lens_core)

    # Flash, LiDAR, and microphone: vertical array at the right end.
    rx = -W / 2 + 1.0
    disc('flash', 0.34, 0.03, (rx, plat_face + 0.012, top - 1.0), flash_m, bevel=0.01)
    disc('flash_ring', 0.4, 0.02, (rx, plat_face + 0.005, top - 1.0), lens_dark)
    disc('lidar', 0.3, 0.03, (rx, plat_face + 0.012, top - 2.62), lens_glass, bevel=0.01)
    disc('lidar_ring', 0.36, 0.02, (rx, plat_face + 0.005, top - 2.62), lens_dark)
    disc('mic', 0.06, 0.02, (rx, plat_face + 0.006, top - 1.82), port_m)

    # Side buttons: capsules protruding 0.5 mm from the edge.
    tw = 0.34  # Button thickness along the depth axis.
    def side_btn(name, side, from_top, length, material, proud=0.05):
        x = side * (W / 2 + proud / 2 - 0.02)
        slab(name, capsule(length, tw), 0.07 + proud, (x, -0.02, H / 2 - from_top), material,
             bevel=0.025, bevel_seg=5, axis='X')

    side_btn('btn_action', -1, 2.85, 0.82, frame_m)
    side_btn('btn_vol_up', -1, 4.25, 1.32, frame_m)
    side_btn('btn_vol_down', -1, 5.85, 1.32, frame_m)
    side_btn('btn_power', 1, 4.6, 2.05, frame_m)
    # Camera control: sapphire, nearly flush.
    side_btn('btn_camera', 1, 10.3, 1.9, sapph, proud=0.008)

    # Antenna lines: thin plastic bands on the flat sides.
    flat_d = D - 2 * 0.095
    for name, side, z in [('ant_l1', -1, H / 2 - 1.55), ('ant_r1', 1, H / 2 - 1.55),
                          ('ant_l2', -1, -H / 2 + 1.55), ('ant_r2', 1, -H / 2 + 1.55)]:
        slab(name, squircle(flat_d * 0.98, 0.075, 0.01, seg=2), 0.01,
             (side * (W / 2 - 0.004), 0, z), ant_m, axis='X')
    for name, z, x in [('ant_t', H / 2 - 0.004, W / 2 - 1.9), ('ant_b', -H / 2 + 0.004, -W / 2 + 1.9)]:
        slab(name, squircle(0.075, flat_d * 0.98, 0.01, seg=2), 0.01, (x, 0, z), ant_m, axis='Z')

    # Bottom edge: USB-C, speaker/microphone holes, and two screws.
    bz = -H / 2 - 0.003
    # Capsule's long axis is v; swap u/v to run the port across the phone along X.
    slab('port', [(v, u) for u, v in capsule(0.86, 0.27, seg=12)], 0.012, (0, 0, bz), port_m, axis='Z')
    for k in range(6):
        for sgn in (-1, 1):
            disc(f'grill{sgn}_{k}', 0.045, 0.012, (sgn * (1.05 + k * 0.17), 0, bz), port_m, axis='Z', seg=16)
    for sgn in (-1, 1):
        disc(f'screw{sgn}', 0.055, 0.012, (sgn * 0.75, 0, bz), screw_m, axis='Z', seg=16)

    export(scale_name)


# ---------------------------------------------------------------- shared materials

def std_mats():
    return dict(
        body=mat('finish_body', srgb('#d6d7da'), metal=1.0, rough=0.34),
        frame=mat('finish_frame', srgb('#d6d7da'), metal=1.0, rough=0.28),
        lens_dark=mat('lens_dark', srgb('#0c0d10'), metal=0.2, rough=0.18, coat=1.0),
        lens_glass=mat('lens_glass', srgb('#06070a'), metal=0.0, rough=0.03, coat=1.0, coat_rough=0.01),
        lens_inner=mat('lens_inner', srgb('#1b2140'), metal=0.75, rough=0.18, coat=1.0),
        lens_core=mat('lens_core', srgb('#020203'), metal=0.0, rough=0.08, coat=1.0),
        flash=mat('flash', srgb('#efe6cf'), metal=0.0, rough=0.55, coat=0.6),
        port=mat('port_dark', srgb('#0b0b0c'), metal=0.1, rough=0.6),
    )


def lens(prefix, x, z, face_y, r, M, ring_d=0.12):
    """Ring + dark bezel + glass + inner element + core."""
    disc(f'{prefix}_ring', r, ring_d, (x, face_y + ring_d / 2 - 0.01, z), M['frame'], bevel=min(0.035, r * 0.06))
    f = face_y + ring_d - 0.01
    disc(f'{prefix}_bezel', r * 0.84, 0.02, (x, f + 0.004, z), M['lens_dark'], bevel=0.006)
    disc(f'{prefix}_glass', r * 0.73, 0.02, (x, f + 0.008, z), M['lens_glass'], bevel=0.008)
    disc(f'{prefix}_inner', r * 0.4, 0.02, (x, f + 0.012, z), M['lens_inner'], bevel=0.004)
    disc(f'{prefix}_core', r * 0.17, 0.02, (x, f + 0.016, z), M['lens_core'])


def grill(prefix, x0, z, count, step, r, M, axis='Z', y=0.0, horizontal=True):
    for k in range(count):
        x = x0 + k * step
        if axis == 'Z':
            disc(f'{prefix}{k}', r, 0.012, (x, y, z), M['port'], axis='Z', seg=12)
        else:  # Side face (X axis): fixed x, array along z.
            disc(f'{prefix}{k}', r, 0.012, (x0, y, z + k * step), M['port'], axis='X', seg=12)


# ---------------------------------------------------------------- tablet

def build_tablet(W=21.5, H=28.1, D=0.51, R=1.55):
    """Thin 13" class tablet: flat edges, single-lens camera island, four speakers."""
    M = std_mats()
    slab('body', squircle(W, H, R), D, (0, 0, 0), M['body'], bevel=0.07, bevel_seg=10, profile=0.62)
    back = D / 2
    # Camera island: rear upper left is Blender +X.
    iw, ih, idp = 2.05, 2.95, 0.1
    ix, iz = W / 2 - 1.75, H / 2 - 2.05
    slab('island', squircle(iw, ih, 0.95, seg=20), idp, (ix, back + idp / 2 - 0.01, iz), M['body'],
         bevel=0.04, bevel_seg=8)
    face = back + idp - 0.01
    lens('cam', ix, iz + 0.62, face, 0.6, M, ring_d=0.08)
    disc('lidar', 0.3, 0.03, (ix - 0.0, face + 0.01, iz - 0.62), M['lens_glass'], bevel=0.01)
    disc('lidar_ring', 0.36, 0.02, (ix, face + 0.004, iz - 0.62), M['lens_dark'])
    disc('flash', 0.17, 0.03, (ix + 0.62, face + 0.01, iz - 0.02), M['flash'], bevel=0.008)
    disc('mic', 0.05, 0.02, (ix - 0.6, face + 0.006, iz - 0.02), M['port'])
    # Smart connector: three pins at the lower rear center.
    for k in (-1, 0, 1):
        disc(f'pin{k}', 0.11, 0.012, (k * 0.42, back + 0.004, -H / 2 + 1.25), M['frame'], bevel=0.004, seg=24)
    # Buttons: power on top (front-view right = +X), volume on the right edge.
    tw = D * 0.42
    slab('btn_top', [(v, u) for u, v in capsule(2.2, tw)], 0.1, (W / 2 - 3.2, -0.0, H / 2 + 0.02), M['frame'],
         bevel=0.02, bevel_seg=5, axis='Z')
    for i, zc in enumerate((H / 2 - 3.4, H / 2 - 5.2)):
        slab(f'btn_vol{i}', capsule(1.45, tw), 0.1, (W / 2 + 0.02, 0, zc), M['frame'], bevel=0.02, bevel_seg=5, axis='X')
    # Speaker grilles: two groups near the corners on top and bottom edges.
    for z in (H / 2 + 0.003, -H / 2 - 0.003):
        for sx in (-1, 1):
            for k in range(9):
                disc(f'spk{z:.0f}{sx}{k}', 0.035, 0.012, (sx * (W / 2 - 2.6 - k * 0.16), 0, z), M['port'], axis='Z', seg=10)
    # USB-C at the center of the bottom edge.
    slab('port', [(v, u) for u, v in capsule(0.86, 0.24, seg=12)], 0.012, (0, 0, -H / 2 - 0.003), M['port'], axis='Z')
    export('tablet')


# ---------------------------------------------------------------- watch

def build_watch(W=4.4, H=4.9, D=1.2, R=1.0):
    """49 mm class outdoor watch: thick case, raised front lip, guarded crown, and strap."""
    M = std_mats()
    accent = mat('accent', srgb('#ff5a1f'), metal=0.3, rough=0.35, coat=0.6)
    sensor = mat('sensor', srgb('#17181b'), metal=0.0, rough=0.12, coat=1.0)
    band_m = mat('band', srgb('#2b2e34'), metal=0.0, rough=0.72)
    slab('case', squircle(W, H, R), D, (0, 0, 0), M['body'], bevel=0.12, bevel_seg=10, profile=0.6)
    front = -D / 2
    # Front lip: raised titanium bezel surrounding the screen glass.
    seg = 22
    outer = squircle(W - 0.03, H - 0.03, R - 0.02, seg=seg)
    inner = squircle(4.14, 4.64, 0.98, seg=seg)
    ring('lip', outer, inner, 0.14, (0, front - 0.06, 0), M['frame'], bevel=0.035)
    # Right: crown guard, knurled crown, and side button.
    gx = W / 2
    slab('guard', capsule(2.5, D * 0.78, seg=12), 0.36, (gx + 0.1, 0.0, 0.05), M['body'], bevel=0.1, bevel_seg=8, axis='X')
    crown_pts = []
    for i in range(96):
        a = 2 * math.pi * i / 96
        rr = 0.36 if i % 2 == 0 else 0.335  # Knurling.
        crown_pts.append((rr * math.cos(a), rr * math.sin(a)))
    slab('crown', [(u, v) for u, v in crown_pts], 0.3, (gx + 0.38, 0.0, 0.62), M['frame'], bevel=0.03, axis='X')
    slab('side_btn', capsule(1.15, D * 0.42), 0.12, (gx + 0.3, 0.0, -0.62), M['frame'], bevel=0.035, axis='X')
    # Left: colored action button and speaker slots.
    slab('action', capsule(0.95, D * 0.4), 0.12, (-gx - 0.04, 0.0, 1.1), accent, bevel=0.035, axis='X')
    for k in range(5):
        slab(f'spk{k}', capsule(0.42, 0.07, seg=6), 0.012, (-gx - 0.004, 0.0, -0.1 - k * 0.24), M['port'], axis='X')
    # Back: sensor dome.
    back = D / 2
    disc('sensor_ring', 1.62, 0.12, (0, back + 0.05, 0), M['frame'], bevel=0.04)
    disc('sensor', 1.48, 0.12, (0, back + 0.1, 0), sensor, bevel=0.05)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        disc(f'sw{k}', 0.16, 0.02, (0.62 * math.cos(a), back + 0.165, 0.62 * math.sin(a)), M['lens_glass'], seg=24)
    # Strap: exits the top/bottom of the case and curves rearward toward the wrist.
    Rw = 2.3
    for sgn, nm in ((1, 'band_top'), (-1, 'band_bot')):
        z0 = sgn * (H / 2 - 0.35)
        y0 = 0.05
        path = [(y0, z0), (y0, z0 + sgn * 0.45)]
        cz = z0 + sgn * 0.45
        for i in range(1, 15):
            th = math.pi - (math.pi * 0.55) * i / 14
            path.append((y0 + Rw + Rw * math.cos(th), cz + sgn * Rw * math.sin(th)))
        strap(nm, path, 2.45, 0.32, band_m)
    export('watch')


# ---------------------------------------------------------------- laptop

def build_laptop(W=31.26, H=22.12, LD=0.48, BD=22.12, BT=1.07, R=1.05, name='laptop'):
    """14"/16" class laptop with separate lid (L_) and base (B_) parts.

    Neutral pose: upright lid (screen −Y), horizontal base. The hinge empty
    defines the axis used by scene code to rotate the lid (Lid angle).
    Lid center is at the origin; scene code positions the screen stack accordingly.
    """
    M = std_mats()
    key_m = mat('key', srgb('#141416'), metal=0.0, rough=0.62, coat=0.15)
    well_m = mat('keyboard_well', srgb('#0b0b0c'), metal=0.0, rough=0.8)
    pad_m = mat('trackpad', srgb('#c9cacd'), metal=0.0, rough=0.3, coat=0.6)
    hinge_m = mat('hinge', srgb('#1a1b1e'), metal=0.4, rough=0.35)
    foot_m = mat('foot', srgb('#1b1c1f'), metal=0.0, rough=0.85)

    # Lid.
    slab('L_lid', squircle(W, H, R * 0.8), LD, (0, 0, 0), M['body'], bevel=0.11, bevel_seg=10, profile=0.6)

    # Hinge: behind the lid's bottom edge, with its axis along X.
    yh = LD / 2 - 0.05
    zh = -H / 2 - 0.32
    hz = bpy.data.objects.new('hinge', None)
    bpy.context.collection.objects.link(hz)
    hz.location = (0, yh, zh)
    disc('B_hinge', 0.42, W - 8.0, (0, yh, zh), hinge_m, axis='X', bevel=0.05, seg=40)

    # Base: top surface just below the hinge, extending forward (−Y).
    top = zh - 0.12
    yb_back = yh + 0.5
    yc = yb_back - BD / 2
    slab('B_base', squircle(W, BD, R), BT, (0, yc, top - BT / 2), M['body'], bevel=0.18, bevel_seg=10,
         profile=0.62, axis='Z')

    # Keyboard well and keys. Row widths are in key units (u).
    pitch = 1.86
    kw = 15.0 * pitch - 0.1
    k_top = yb_back - 1.55  # Rear edge of the well (Y).
    rows = [
        ([1.5] + [1.0] * 12 + [1.0], 0.62),        # Half-height function row + Touch.
        ([1.0] * 13 + [1.5], 1.0),
        ([1.5] + [1.0] * 12 + [1.0], 1.0),
        ([1.75] + [1.0] * 11 + [1.75], 1.0),
        ([2.25] + [1.0] * 10 + [2.25], 1.0),
        ([1.0, 1.0, 1.0, 1.25, 5.5, 1.25, 1.0, 1.0, 1.0, 1.0], 1.0),
    ]
    row_h = [r[1] * pitch for r in rows]
    well_h = sum(row_h) + 0.4
    slab('B_well', squircle(kw + 0.4, well_h, 0.35, seg=8), 0.02, (0, k_top - well_h / 2, top + 0.002),
         well_m, axis='Z')
    y = k_top - 0.2
    for ri, (units, hscale) in enumerate(rows):
        rh = hscale * pitch
        total = sum(units)
        scale = (kw) / (total * pitch)
        x = -kw / 2
        for ki, u in enumerate(units):
            w = u * pitch * scale
            # Half-size arrow keys in the last row.
            kh = rh - 0.26
            slab(f'B_key{ri}_{ki}', squircle(w - 0.24, kh, 0.14, seg=4), 0.07,
                 (x + w / 2, y - rh / 2, top + 0.045), key_m, bevel=0.018, bevel_seg=3, axis='Z')
            x += w
        y -= rh
    # Trackpad.
    pad_w, pad_h = 15.2, 9.6
    slab('B_pad', squircle(pad_w, pad_h, 0.55, seg=12), 0.02, (0, yb_back - BD + 1.0 + pad_h / 2, top + 0.006),
         pad_m, bevel=0.006, bevel_seg=2, axis='Z')
    # Speaker grilles: dot arrays on both sides of the keyboard.
    gx0 = kw / 2 + 0.85
    for sx in (-1, 1):
        for c in range(4):
            for r in range(34):
                disc(f'B_spk{sx}_{c}_{r}', 0.042, 0.012,
                     (sx * (gx0 + c * 0.2), k_top - 0.1 - r * (well_h - 0.2) / 33, top + 0.003), M['port'],
                     axis='Z', seg=8)
    # Feet.
    for sx in (-1, 1):
        for yy in (yb_back - 1.6, yb_back - BD + 1.6):
            disc(f'B_foot{sx}{yy:.0f}', 0.55, 0.12, (sx * (W / 2 - 2.0), yy, top - BT - 0.04), foot_m,
                 axis='Z', bevel=0.04, seg=32)
    # Ports: left MagSafe, 2× USB-C, headphones; right HDMI, USB-C, SD.
    pz = top - BT * 0.5
    def side_port(nm, sx, yy, length, height):
        slab(nm, capsule(height, length, seg=8), 0.012, (sx * (W / 2 + 0.003), yy, pz), M['port'], axis='X')
    left = [(-3.0, 1.6, 0.32), (-5.6, 0.86, 0.28), (-7.1, 0.86, 0.28), (-BD + 3.2, 0.42, 0.42)]
    right = [(-3.4, 1.5, 0.4), (-5.4, 0.86, 0.28), (-BD + 4.5, 2.4, 0.18)]
    for i, (dy, ln, ht) in enumerate(left):
        side_port(f'B_pl{i}', -1, yb_back + dy, ln, ht)
    for i, (dy, ln, ht) in enumerate(right):
        side_port(f'B_pr{i}', 1, yb_back + dy, ln, ht)

    export(name, part_of=lambda ob: 'lid' if ob.name.startswith('L_') else 'base')


# ---------------------------------------------------------------- monitor

def build_display(W=71.7, H=41.2, D=2.4, R=1.2, neckH=12.0, baseW=22.0, baseD=18.0, baseH=0.9,
                  name='display', vents=70):
    """Monitor: thin aluminum panel (L_) and stand (B_). Panel tilts around
    hinge (Screen tilt = Lid angle in the scene); stand stays fixed on the desk."""
    M = std_mats()
    slab('L_body', squircle(W, H, R, seg=16), D, (0, 0, 0), M['body'], bevel=0.35, bevel_seg=10, profile=0.6)
    back = D / 2
    # Upper/lower rear vents: two rows of holes merged into one mesh.
    for row, z in enumerate((H / 2 - 1.6, H / 2 - 2.1, -H / 2 + 1.6)):
        for k in range(vents):
            x = -W * 0.36 + k * (W * 0.72 / (vents - 1))
            disc(f'L_vent{row}_{k}', 0.12, 0.012, (x, back + 0.004, z), M['port'], seg=12)
    # Mounting block belongs to the panel and tilts with it.
    hinge_z = -2.0
    slab('L_mount', squircle(9.0, 6.0, 1.2), 1.6, (0, back + 0.75, hinge_z), M['body'], bevel=0.3, bevel_seg=8)
    hz = bpy.data.objects.new('hinge', None)
    bpy.context.collection.objects.link(hz)
    hz.location = (0, back + 1.6, hinge_z)
    # Fixed stand: neck, hinge cylinder, and foot.
    neck_top = hinge_z + 1.0
    neck_bot = -H / 2 - neckH + 1.2
    nh = neck_top - neck_bot
    slab('B_neck', squircle(6.4, nh, 0.6), 0.9, (0, back + 2.0, neck_bot + nh / 2), M['body'], bevel=0.25, bevel_seg=8)
    disc('B_pivot', 0.55, 7.2, (0, back + 1.6, hinge_z), M['frame'], axis='X', bevel=0.08, seg=40)
    foot = [(u, v) for u, v in squircle(baseW, baseD, 1.6, seg=16)]
    slab('B_foot', foot, baseH, (0, back + 2.4 - baseD * 0.45, neck_bot - baseH / 2), M['body'],
         bevel=0.3, bevel_seg=8, axis='Z')
    export(name, part_of=lambda ob: 'lid' if ob.name.startswith('L_') else 'base')


# ---------------------------------------------------------------- Android-class phones

def build_android(W=7.2, H=15.28, D=0.86, R=1.25, style='visor', name='android'):
    """Two Android-class bodies without brand names or logos:
    visor — full-width rear camera bar and rounded corners;
    ultra — flat angular body with separate lens rings in a vertical column."""
    M = std_mats()
    back_m = mat('back_glass', srgb('#d6d7da'), metal=0.0, rough=0.42, coat=0.4, coat_rough=0.25)
    visor_m = mat('visor_glass', srgb('#0d0e12'), metal=0.0, rough=0.05, coat=1.0, coat_rough=0.02)
    ant_m = mat('antenna', srgb('#a9abaf'), metal=0.0, rough=0.5)
    slab('body', squircle(W, H, R), D, (0, 0, 0), M['body'], bevel=0.09 if style == 'visor' else 0.05,
         bevel_seg=10, profile=0.62)
    back = D / 2
    slab('back_panel', squircle(W - 0.3, H - 0.3, max(0.3, R - 0.12), seg=20), 0.03, (0, back + 0.004, 0), back_m)
    top = H / 2
    if style == 'visor':
        # Visor: edge-to-edge capsule bar with dark glass, three lenses, and flash.
        vh, vd = 2.35, 0.24
        vz = top - 2.45
        slab('visor', [(v, u) for u, v in capsule(W + 0.02, vh, seg=20)], vd, (0, back + vd / 2, vz),
             M['body'], bevel=0.08, bevel_seg=8)
        slab('visor_glass', [(v, u) for u, v in capsule(W * 0.62, vh * 0.72, seg=20)], 0.03,
             (W * 0.08, back + vd + 0.004, vz), visor_m)
        face = back + vd + 0.02
        # Rear-view left is +X.
        for k, lx in enumerate((W * 0.31, W * 0.13, -W * 0.05)):
            lens(f'lens{k}', lx, vz, face - 0.04, 0.5 if k < 2 else 0.42, M, ring_d=0.06)
        disc('flash', 0.16, 0.03, (-W * 0.25, face - 0.01, vz + 0.3), M['flash'], bevel=0.008)
        disc('sensor', 0.12, 0.03, (-W * 0.25, face - 0.01, vz - 0.3), M['lens_glass'], bevel=0.008)
    else:
        # Ultra: 3 large + 2 small lenses in a vertical column, no island; rear upper left = +X.
        lx = W / 2 - 1.35
        for k, lz in enumerate((top - 1.45, top - 3.05, top - 4.65)):
            lens(f'lens{k}', lx, lz, back, 0.62, M, ring_d=0.16)
        lens('lens3', lx - 1.25, top - 1.2, back, 0.33, M, ring_d=0.1)
        lens('lens4', lx - 1.25, top - 2.15, back, 0.33, M, ring_d=0.1)
        disc('flash', 0.2, 0.03, (lx - 1.25, back + 0.02, top - 3.2), M['flash'], bevel=0.008)
        # Stylus slot on the bottom edge.
        slab('pen', [(v, u) for u, v in capsule(0.9, 0.42, seg=10)], 0.012, (W / 2 - 1.6, 0, -H / 2 - 0.006),
             M['port'], axis='Z')
    # Buttons on the front-view right edge (+X): power and one long volume button.
    tw = D * 0.4
    sx = W / 2 + 0.02
    slab('btn_power', capsule(1.15, tw), 0.1, (sx, 0, top - 4.2), M['frame'], bevel=0.025, bevel_seg=5, axis='X')
    slab('btn_vol', capsule(2.6, tw), 0.1, (sx, 0, top - 6.4), M['frame'], bevel=0.025, bevel_seg=5, axis='X')
    bz = -H / 2 - 0.003
    slab('port', [(v, u) for u, v in capsule(0.86, 0.27, seg=12)], 0.012, (0, 0, bz), M['port'], axis='Z')
    for k in range(7):
        disc(f'grill{k}', 0.05, 0.012, (-1.1 - k * 0.17, 0, bz), M['port'], axis='Z', seg=12)
    disc('mic', 0.05, 0.012, (1.1, 0, bz), M['port'], axis='Z', seg=12)
    flat_d = D - 2 * 0.09
    for nm, sgn, z in [('ant_l', -1, top - 1.6), ('ant_r', 1, top - 1.6), ('ant_l2', -1, -top + 1.6),
                       ('ant_r2', 1, -top + 1.6)]:
        slab(nm, squircle(flat_d * 0.98, 0.07, 0.01, seg=2), 0.01, (sgn * (W / 2 - 0.004), 0, z), ant_m, axis='X')
    export(name)


# ---------------------------------------------------------------- thin phone

def build_phone_slim(W=7.47, H=15.62, D=0.564, R=1.22, name='phone-slim'):
    """Very thin phone: 5.6 mm body, slim full-width camera bar at the top,
    and one lens with flash/microphone."""
    M = std_mats()
    back_m = mat('back_glass', srgb('#d6d7da'), metal=0.0, rough=0.42, coat=0.4, coat_rough=0.25)
    ant_m = mat('antenna', srgb('#a9abaf'), metal=0.0, rough=0.5)
    sapph = mat('control_glass', srgb('#1a1c21'), metal=0.0, rough=0.06, coat=1.0, coat_rough=0.02)
    slab('body', squircle(W, H, R), D, (0, 0, 0), M['body'], bevel=0.07, bevel_seg=10, profile=0.62)
    back = D / 2
    bh, bd = 2.3, 0.22
    bz = H / 2 - 0.25 - bh / 2
    slab('bar', [(v, u) for u, v in capsule(W - 0.36, bh, seg=20)], bd, (0, back + bd / 2 - 0.01, bz), M['body'],
         bevel=0.07, bevel_seg=8)
    slab('back_glass', squircle(W - 0.5, H - bh - 0.9, 0.9, seg=20), 0.03, (0, back + 0.004, -bh / 2 - 0.2), back_m)
    face = back + bd - 0.01
    lens('lens0', W / 2 - 1.35, bz, face, 0.62, M, ring_d=0.08)
    disc('flash', 0.17, 0.03, (-W / 2 + 1.55, face + 0.01, bz), M['flash'], bevel=0.008)
    disc('mic', 0.05, 0.02, (-W / 2 + 2.3, face + 0.006, bz), M['port'])
    tw = D * 0.5

    def side_btn(nm, side, from_top, length, m, proud=0.045):
        slab(nm, capsule(length, tw), 0.07 + proud, (side * (W / 2 + proud / 2 - 0.02), 0, H / 2 - from_top), m,
             bevel=0.02, bevel_seg=5, axis='X')

    side_btn('btn_action', -1, 3.0, 0.8, M['frame'])
    side_btn('btn_vol_up', -1, 4.35, 1.25, M['frame'])
    side_btn('btn_vol_down', -1, 5.9, 1.25, M['frame'])
    side_btn('btn_power', 1, 4.7, 1.95, M['frame'])
    side_btn('btn_camera', 1, 10.6, 1.8, sapph, proud=0.006)
    bzz = -H / 2 - 0.003
    slab('port', [(v, u) for u, v in capsule(0.86, 0.24, seg=12)], 0.012, (0, 0, bzz), M['port'], axis='Z')
    flat_d = D - 2 * 0.07
    for nm, sgn, z in [('ant_l', -1, H / 2 - 1.5), ('ant_r', 1, H / 2 - 1.5)]:
        slab(nm, squircle(flat_d * 0.98, 0.07, 0.01, seg=2), 0.01, (sgn * (W / 2 - 0.004), 0, z), ant_m, axis='X')
    export(name)


DEVICES = {
    'phone': lambda: build_phone(),
    'phone-max': lambda: build_phone(W=7.8, H=16.3, D=0.875, R=1.25, plateau_h=4.0, scale_name='phone-max'),
    'tablet': lambda: build_tablet(),
    'watch': lambda: build_watch(),
    'display': lambda: build_display(),
    'laptop': lambda: build_laptop(),
    'laptop-16': lambda: build_laptop(W=35.57, H=24.81, LD=0.5, BD=24.81, BT=1.17, R=1.1, name='laptop-16'),
    # Thin 13" laptop: 0.4 cm lid, 0.73 cm base, ~1.13 cm total.
    'laptop-slim': lambda: build_laptop(W=30.41, H=21.5, LD=0.4, BD=21.5, BT=0.73, R=1.0, name='laptop-slim'),
    'display-27': lambda: build_display(W=62.3, H=36.2, D=2.2, R=1.0, neckH=11.0, baseW=18.0, baseD=16.0,
                                       name='display-27', vents=60),
    'android': lambda: build_android(),
    'android-ultra': lambda: build_android(W=7.81, H=16.28, D=0.82, R=0.72, style='ultra', name='android-ultra'),
    'phone-slim': lambda: build_phone_slim(),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(DEVICES)
    for d in argv:
        reset()
        MATS.clear()
        DEVICES[d]()
