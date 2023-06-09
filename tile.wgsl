@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var<uniform> atlas_size: vec2u;
@group(0) @binding(3) var<uniform> resolution: vec2f;
@group(0) @binding(4) var<uniform> camera: vec2f;

@group(1) @binding(0) var<storage, read> chunk: array<array<u32, 16>, 16>;
@group(1) @binding(1) var<uniform> chunk_coords: vec2i;

struct Vertex {
    @builtin(position) clip_pos: vec4f,
    @location(0) chunk_pixel: vec2f,
}

@vertex fn main_vertex(@location(0) chunk_pixel: vec2f) -> Vertex {
    let pixel = vec2i(chunk_pixel) - vec2i(round(camera)) + chunk_coords * 16 * 8; // pixel space
    let clip_pos = vec2f(pixel) * 2.0 / resolution; // clip space

    return Vertex(
        vec4f(clip_pos, 0.0, 1.0),
        chunk_pixel
    );
}

@fragment fn main_fragment(
    @location(0) chunk_pos: vec2f
) -> @location(0) vec4f {

    let chunk_pixel = vec2i(chunk_pos);
    let chunk_tile = chunk_pixel / 8;
    let id = chunk[chunk_tile.y][chunk_tile.x]; // texture id
    let atlas_loc = vec2u(id % atlas_size.x, id / atlas_size.x);
    let uv = (vec2f(atlas_loc) + (1.0 - fract(chunk_pos/8.0))) / vec2f(atlas_size);

    return textureSample(atlas, atlas_sampler, uv);
}