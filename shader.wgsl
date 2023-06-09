@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var<uniform> atlas_size: vec2u;
@group(0) @binding(3) var<uniform> resolution: vec2f;
@group(0) @binding(4) var<uniform> camera: vec2f;

@group(1) @binding(0) var<storage, read> chunk: array<array<u32, 16>, 16>;
@group(1) @binding(1) var<uniform> chunk_coords: vec2f;

struct Vertex {
    @builtin(position) pos: vec4f,
    @location(0) pixel: vec2f,
}

@vertex fn main_vertex(@location(0) pixel: vec2f) -> Vertex {
    let offset = chunk_coords * 16*8;
    let pos = (pixel - camera - offset) * 2.0 / resolution;
    return Vertex(vec4f(pos, 0.0, 1.0), pixel);
}

@fragment fn main_fragment(
    @location(0) pos: vec2f
) -> @location(0) vec4f {

    let id = chunk[u32(pos.y)/8u][u32(pos.x)/8u];
    let atlas_pos = vec2u(id % atlas_size.x, id / atlas_size.x);
    let uv = (vec2f(atlas_pos) + fract(pos/8.0)) / vec2f(atlas_size);

    return textureSample(atlas, atlas_sampler, uv);
}