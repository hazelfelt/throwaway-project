@vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
    return vec4f(pos, 0.0, 1.0);
}

@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var<uniform> atlas_size: vec2u;
@group(1) @binding(0) var<storage, read> chunk: array<array<u32, 16>, 16>;

@fragment fn main_fragment(
    @builtin(position) pos: vec4f
) -> @location(0) vec4f {

    let id = chunk[u32(pos.y)/8u][u32(pos.x)/8u];
    let atlas_pos = vec2u(id % atlas_size.x, id / atlas_size.x);
    let uv = (vec2f(atlas_pos) + fract(pos.xy/8.0)) / vec2f(atlas_size);

    return textureSample(atlas, atlas_sampler, uv);
}