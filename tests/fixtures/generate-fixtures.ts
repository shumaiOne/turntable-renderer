import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dir, 'models');

if (!existsSync(FIXTURES_DIR)) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
}

// 1. Minimal OBJ
export function generateObj(): string {
  return `# Minimal 3D Cube OBJ
v -1.0 -1.0 -1.0
v  1.0 -1.0 -1.0
v  1.0  1.0 -1.0
v -1.0  1.0 -1.0
v -1.0 -1.0  1.0
v  1.0 -1.0  1.0
v  1.0  1.0  1.0
v -1.0  1.0  1.0

f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
`;
}

// 2. Minimal ASCII STL
export function generateStl(): string {
  return `solid cube
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 1 1 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 1 0
      vertex 0 1 0
    endloop
  endfacet
endsolid cube
`;
}

// 3. Minimal COLLADA (.dae)
export function generateDae(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><author>Test</author></contributor>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_geometries>
    <geometry id="cube-geom" name="cube">
      <mesh>
        <source id="cube-pos">
          <float_array id="cube-pos-array" count="24">
            -1 -1 -1   1 -1 -1   1 1 -1  -1 1 -1
            -1 -1  1   1 -1  1   1 1  1  -1 1  1
          </float_array>
          <technique_common>
            <accessor source="#cube-pos-array" count="8" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="cube-vertices">
          <input semantic="POSITION" source="#cube-pos"/>
        </vertices>
        <polylist count="6">
          <input semantic="VERTEX" source="#cube-vertices" offset="0"/>
          <vcount>4 4 4 4 4 4</vcount>
          <p>
            0 1 2 3
            4 7 6 5
            0 4 5 1
            1 5 6 2
            2 6 7 3
            4 0 3 7
          </p>
        </polylist>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="Cube" name="Cube">
        <instance_geometry url="#cube-geom"/>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>
`;
}

// 4. Minimal Self-Contained glTF
export function generateSelfContainedGltf(): string {
  // Simple triangle: 3 vertices [0,0,0], [1,0,0], [0,1,0]
  // Positions: 3 * 3 floats = 9 floats = 36 bytes
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);

  const bufferBytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bufferBytes.set(new Uint8Array(positions.buffer), 0);
  bufferBytes.set(new Uint8Array(indices.buffer), positions.byteLength);

  const base64Buffer = Buffer.from(bufferBytes).toString('base64');
  const uri = `data:application/octet-stream;base64,${base64Buffer}`;

  const gltf = {
    asset: { version: '2.0', generator: 'TestFixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bufferBytes.byteLength, uri }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: 3,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: 3,
        type: 'SCALAR',
        max: [2],
        min: [0],
      },
    ],
  };

  return JSON.stringify(gltf, null, 2);
}

// 5. glTF with External Buffer (to test rejection)
export function generateExternalRefGltf(): string {
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 36, uri: 'external_buffer.bin' }],
  };
  return JSON.stringify(gltf, null, 2);
}

// 6. Minimal USDA (USD ASCII)
export function generateUsda(): string {
  return `#usda 1.0
(
    defaultPrim = "Cube"
    metersPerUnit = 1
    upAxis = "Y"
)

def Mesh "Cube"
{
    int[] faceVertexCounts = [4]
    int[] faceVertexIndices = [0, 1, 2, 3]
    point3f[] points = [(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1)]
}
`;
}

export function writeAllFixtures(): void {
  writeFileSync(join(FIXTURES_DIR, 'cube.obj'), generateObj());
  writeFileSync(join(FIXTURES_DIR, 'cube.stl'), generateStl());
  writeFileSync(join(FIXTURES_DIR, 'cube.dae'), generateDae());
  writeFileSync(join(FIXTURES_DIR, 'cube.gltf'), generateSelfContainedGltf());
  writeFileSync(join(FIXTURES_DIR, 'external_ref.gltf'), generateExternalRefGltf());
  writeFileSync(join(FIXTURES_DIR, 'cube.usda'), generateUsda());
  console.log(`Generated all test fixtures in ${FIXTURES_DIR}`);
}

if (import.meta.main) {
  writeAllFixtures();
}
