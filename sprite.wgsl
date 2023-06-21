@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var<uniform> atlas_size: vec2u;
@group(0) @binding(3) var<storage, read> loc_map: array<vec2u, 3>;
@group(0) @binding(4) var<storage, read> size_map: array<vec2u, 3>;
@group(0) @binding(5) var<storage, read> corners: array<vec2u, 4>;

@group(0) @binding(6) var<uniform> resolution: vec2f;
@group(0) @binding(7) var<uniform> camera: vec2f;

struct Vertex {
    @builtin(position) clip_pos: vec4f,
    @location(0) uv: vec2f,
}

@vertex fn main_vertex(
    @builtin(vertex_index) vertex_id: u32,
    @location(0) pos: vec2f,
    @location(1) texture: u32,
) -> Vertex {

    let corner = corners[vertex_id];
    let pixel = vec2i(pos - round(camera)) + vec2i(size_map[texture]*corner);
    let clip_pos = vec2f(pixel) * 2.0 / resolution;
    let uv = vec2f(loc_map[texture] + size_map[texture]*vec2u(corner.x, 1-corner.y)) / vec2f(atlas_size);

    return Vertex(vec4f(clip_pos, 0.0, 1.0), uv);
}

@fragment fn main_fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(atlas, atlas_sampler, uv);
}